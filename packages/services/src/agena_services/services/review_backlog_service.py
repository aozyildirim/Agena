"""Review-backlog killer.

Periodically scan the org's open PRs and surface those that have been
sitting unreviewed past a configurable threshold. We compute an age-
weighted severity (info / warning / critical) and bump a per-PR nudge
counter so reviewers and team leads can see the backlog at a glance.

A separate notification path (Slack / email) is opt-in — the row in
`review_backlog_nudges` is the source of truth even if no message is
delivered.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.git_pull_request import GitPullRequest
from agena_models.models.org_workflow_settings import OrgWorkflowSettings
from agena_models.models.organization import Organization
from agena_models.models.review_backlog_nudge import ReviewBacklogNudge

logger = logging.getLogger(__name__)


# PR statuses that count as "still waiting for review". Anything merged
# / closed should drop off the backlog.
OPEN_STATUSES = {'open', 'opened', 'pending', 'review_required', 'in_review', 'active'}

# Anything in this set is dead — the PR was abandoned or closed without
# merge. We filter these out at scan time so we don't nudge reviewers on
# work that's already off the table. Lower-cased compare.
DEAD_STATUSES = {'abandoned', 'declined', 'closed', 'rejected'}


async def _settings_for(db: AsyncSession, org_id: int) -> OrgWorkflowSettings:
    row = (
        await db.execute(select(OrgWorkflowSettings).where(OrgWorkflowSettings.organization_id == org_id))
    ).scalar_one_or_none()
    if row is not None:
        return row
    row = OrgWorkflowSettings(organization_id=org_id)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


def _severity_for_age(age_hours: int, warn: int, crit: int) -> str:
    if age_hours >= crit:
        return 'critical'
    if age_hours >= warn:
        return 'warning'
    return 'info'


async def scan_for_org(
    db: AsyncSession,
    org_id: int,
    *,
    now: datetime | None = None,
) -> dict[str, int]:
    """Update the backlog rows for one org. Returns a small status dict
    describing what happened so the API/poller can log it."""
    settings = await _settings_for(db, org_id)
    if not settings.backlog_enabled:
        return {'open_prs': 0, 'tracked': 0, 'resolved': 0}

    now = now or datetime.utcnow()
    warn = max(1, settings.backlog_warn_hours)
    crit = max(warn + 1, settings.backlog_critical_hours)

    exempt_repos = {
        r.strip() for r in (settings.backlog_exempt_repos or '').split(',') if r.strip()
    }

    rows = (
        await db.execute(
            select(GitPullRequest).where(
                GitPullRequest.organization_id == org_id,
                GitPullRequest.merged_at.is_(None),
                GitPullRequest.closed_at.is_(None),
            )
        )
    ).scalars().all()

    tracked = 0
    resolved = 0

    # Resolve repo mappings up front so we can refresh Azure status per
    # row without N+1 queries.
    from agena_models.models.repo_mapping import RepoMapping
    mapping_ids: set[int] = set()
    for pr in rows:
        rid = (pr.repo_mapping_id or '').strip()
        if rid.isdigit():
            mapping_ids.add(int(rid))
    mappings_by_id: dict[int, RepoMapping] = {}
    if mapping_ids:
        mrows = (await db.execute(
            select(RepoMapping).where(
                RepoMapping.id.in_(list(mapping_ids)),
                RepoMapping.organization_id == org_id,
            )
        )).scalars().all()
        mappings_by_id = {m.id: m for m in mrows}

    open_pr_ids = set()
    for pr in rows:
        if pr.repo_mapping_id in exempt_repos:
            continue
        # Refresh status from the source of truth — our local copy can
        # be hours stale (abandoned in Azure but still 'active' in DB).
        rid = (pr.repo_mapping_id or '').strip()
        m = mappings_by_id.get(int(rid)) if rid.isdigit() else None
        if m is not None:
            await _refresh_azure_pr_status(
                db, organization_id=org_id, pr=pr, mapping=m,
            )
        # Drop abandoned / declined / closed PRs even when they slipped
        # past the merged_at/closed_at filter (Azure's abandoned PRs may
        # leave closed_at NULL while flipping status='abandoned' — the
        # SQL filter above misses those, and the refresh above may have
        # just flipped us into this branch).
        if (pr.status or '').strip().lower() in DEAD_STATUSES:
            continue
        # Treat any non-merged, non-closed PR as still open. The provider's
        # status string is too noisy to rely on across GitHub/Azure both.
        opened_at = pr.created_at_ext or pr.created_at
        if opened_at is None:
            continue
        age = now - opened_at
        age_hours = max(0, int(age.total_seconds() // 3600))
        if age_hours < warn:
            continue
        open_pr_ids.add(pr.id)
        severity = _severity_for_age(age_hours, warn, crit)

        existing = (
            await db.execute(
                select(ReviewBacklogNudge).where(
                    ReviewBacklogNudge.organization_id == org_id,
                    ReviewBacklogNudge.pr_id == pr.id,
                )
            )
        ).scalar_one_or_none()

        if existing is None:
            db.add(ReviewBacklogNudge(
                organization_id=org_id,
                pr_id=pr.id,
                repo_mapping_id=pr.repo_mapping_id,
                age_hours=age_hours,
                severity=severity,
                nudge_count=0,
                resolved_at=None,
            ))
            tracked += 1
        else:
            existing.age_hours = age_hours
            existing.severity = severity
            existing.repo_mapping_id = pr.repo_mapping_id
            if existing.resolved_at is not None:
                existing.resolved_at = None  # reopened? — keep tracking
            # If we previously posted a PR comment but the user removed
            # it on Azure/GitHub, treat the row as un-nudged so the UI
            # offers the button again — and so the next scheduled run
            # is allowed to re-post. Without this we never re-nudge a
            # PR whose AGENA comment was wiped.
            if (
                existing.last_nudged_at is not None
                and (existing.last_nudge_channel or '') == 'pr_comment'
            ):
                m_id = (existing.repo_mapping_id or '').strip()
                if m_id.isdigit():
                    from agena_models.models.repo_mapping import RepoMapping
                    mapping = (await db.execute(
                        select(RepoMapping).where(
                            RepoMapping.id == int(m_id),
                            RepoMapping.organization_id == org_id,
                        )
                    )).scalar_one_or_none()
                    if mapping is not None:
                        still_there = await _verify_existing_agena_comment(
                            db, organization_id=org_id, pr=pr, mapping=mapping,
                        )
                        if not still_there:
                            existing.last_nudged_at = None
                            existing.last_nudge_channel = None
                            logger.info(
                                'AGENA comment vanished from PR %s — clearing last_nudged_at',
                                pr.external_id,
                            )
            tracked += 1

    # Resolve nudges whose PRs are no longer in the open list (got
    # merged or closed since last scan).
    stale_nudges = (
        await db.execute(
            select(ReviewBacklogNudge).where(
                ReviewBacklogNudge.organization_id == org_id,
                ReviewBacklogNudge.resolved_at.is_(None),
            )
        )
    ).scalars().all()
    for n in stale_nudges:
        if n.pr_id not in open_pr_ids:
            n.resolved_at = now
            resolved += 1

    if tracked or resolved:
        await db.commit()
        logger.info('Review backlog: org=%s tracked=%s resolved=%s', org_id, tracked, resolved)
    return {'open_prs': len(open_pr_ids), 'tracked': tracked, 'resolved': resolved}


async def scan_all_orgs(db: AsyncSession) -> int:
    org_ids: Iterable[int] = (
        await db.execute(select(Organization.id))
    ).scalars().all()
    total = 0
    for oid in org_ids:
        try:
            r = await scan_for_org(db, oid)
            total += r.get('tracked', 0)
        except Exception:
            logger.exception('Review-backlog scan failed for org=%s', oid)
    return total


_AGENA_SIGNATURE = 'AGENA Review Backlog'


async def _refresh_azure_pr_status(
    db: AsyncSession,
    *,
    organization_id: int,
    pr,
    mapping,
) -> None:
    """Hit Azure REST and copy the live status / closed_at back onto our
    GitPullRequest row. Without this, a PR abandoned on Azure shows up
    as 'active' in the backlog list because we only refresh status during
    git_sync, which is on a separate cadence.

    Best-effort: any error leaves the row untouched. Caller should run
    the DEAD_STATUSES filter AFTER this so freshly-abandoned PRs drop out
    of the same scan."""
    if (pr.provider or '').strip().lower() != 'azure':
        return
    if not pr.external_id or mapping is None:
        return
    from agena_models.models.integration_config import IntegrationConfig
    import base64 as _b64
    import httpx as _httpx
    from urllib.parse import quote as _q
    cfg = (await db.execute(
        select(IntegrationConfig).where(
            IntegrationConfig.organization_id == organization_id,
            IntegrationConfig.provider == 'azure',
        )
    )).scalar_one_or_none()
    if not cfg or not cfg.secret:
        return
    org_url = (cfg.base_url or '').rstrip('/')
    if not org_url:
        return
    auth = _b64.b64encode(f':{cfg.secret}'.encode()).decode()
    headers = {'Authorization': f'Basic {auth}', 'Accept': 'application/json'}
    project = _q(mapping.owner or '', safe='')
    repo = _q(mapping.repo_name or '', safe='')
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f'{org_url}/{project}/_apis/git/repositories/{repo}/pullRequests/{pr.external_id}'
                f'?api-version=7.1-preview.1',
                headers=headers,
            )
            if resp.status_code != 200:
                return
            data = resp.json() if resp.content else {}
        new_status = str(data.get('status') or '').strip().lower() or pr.status
        new_closed = data.get('closedDate')
        from datetime import datetime as _dt
        # Status mapping: Azure 'completed' → merged, 'abandoned' → closed.
        if new_status and new_status != (pr.status or '').strip().lower():
            pr.status = new_status
        if new_status == 'completed' and pr.merged_at is None:
            pr.merged_at = _dt.utcnow()
        if new_status == 'abandoned' and pr.closed_at is None:
            pr.closed_at = _dt.utcnow()
        if new_closed and pr.closed_at is None:
            try:
                pr.closed_at = _dt.fromisoformat(str(new_closed).replace('Z', '+00:00'))
            except Exception:
                pass
    except Exception as exc:
        logger.info('Azure PR status refresh failed (pr=%s): %s', pr.external_id, exc)


# Static template per language. Used as fallback when use_ai=False or
# when the LLM call fails. Placeholders: {hours} {severity} {n}
# {activity_block}. activity_block is already formatted by the caller.
_TEMPLATES: dict[str, str] = {
    'en': (
        '⏱️ **{sig}**\n\n'
        'This PR has been waiting for review for **{hours} hours** '
        '(severity: {severity}). Nudge #{n}.\n'
        '{activity_block}'
    ),
    'tr': (
        '⏱️ **{sig}**\n\n'
        'Bu PR **{hours} saattir** review bekliyor '
        '(önem: {severity}). Dürtü #{n}.\n'
        '{activity_block}'
    ),
    'de': (
        '⏱️ **{sig}**\n\n'
        'Dieser PR wartet seit **{hours} Stunden** auf Review '
        '(Schweregrad: {severity}). Anstoß #{n}.\n'
        '{activity_block}'
    ),
    'es': (
        '⏱️ **{sig}**\n\n'
        'Este PR lleva **{hours} horas** esperando review '
        '(severidad: {severity}). Recordatorio #{n}.\n'
        '{activity_block}'
    ),
    'it': (
        '⏱️ **{sig}**\n\n'
        'Questo PR aspetta review da **{hours} ore** '
        '(severità: {severity}). Sollecito #{n}.\n'
        '{activity_block}'
    ),
    'ja': (
        '⏱️ **{sig}**\n\n'
        'この PR は **{hours} 時間** レビュー待ちです '
        '(深刻度: {severity})。通知 #{n}。\n'
        '{activity_block}'
    ),
    'zh': (
        '⏱️ **{sig}**\n\n'
        '该 PR 已等待评审 **{hours} 小时** '
        '(严重性: {severity})。提醒 #{n}。\n'
        '{activity_block}'
    ),
}


async def _compose_nudge_body(
    db: AsyncSession,
    *,
    organization_id: int,
    pr,
    nudge,
    activity: str,
    language: str,
    use_ai: bool,
) -> str:
    """Build the nudge body. When use_ai=True we route the prompt through
    the org's first claude_cli/codex_cli agent (or LLMProvider as fallback)
    so the comment references the actual recent activity. When use_ai is
    off (or the LLM call fails) we fall back to the per-language static
    template — keeps the feature usable without API keys configured."""
    lang = (language or 'en').strip().lower()
    if lang not in _TEMPLATES:
        lang = 'en'
    activity_block = f'\n{activity}\n' if activity else ''
    fallback = _TEMPLATES[lang].format(
        sig=_AGENA_SIGNATURE,
        hours=nudge.age_hours,
        severity=nudge.severity or 'info',
        n=(nudge.nudge_count or 0) + 1,
        activity_block=activity_block,
    )
    if not use_ai:
        return fallback
    try:
        ai = await _generate_ai_nudge_body(
            db,
            organization_id=organization_id,
            pr=pr,
            nudge=nudge,
            activity=activity,
            language=lang,
        )
        if ai:
            # Always keep the AGENA signature visible so reviewers know
            # it's an automated nudge — and so the deletion-detector
            # below can still match.
            return f'⏱️ **{_AGENA_SIGNATURE}**\n\n{ai.strip()}'
    except Exception as exc:
        logger.info('AI nudge body generation failed, falling back to template: %s', exc)
    return fallback


async def _generate_ai_nudge_body(
    db: AsyncSession,
    *,
    organization_id: int,
    pr,
    nudge,
    activity: str,
    language: str,
) -> str:
    """Call the org's reviewer agent to write a contextual nudge.
    Returns the model's prose (no AGENA signature — caller adds it).

    Routing mirrors review_service: prefer claude_cli / codex_cli through
    the local bridge (no API key needed), fall back to LLMProvider with
    the org's integration_configs credentials when the user has API
    agents instead. Tight 60s timeout keeps the button click responsive."""
    from sqlalchemy import select as _sel
    from agena_models.models.organization_member import OrganizationMember
    from agena_models.models.user_preference import UserPreference

    # Pick any user-pref row attached to a member of this org that has
    # at least one agent configured. The agent config drives provider,
    # not the user identity — so first match is fine.
    pref = (await db.execute(
        _sel(UserPreference)
        .join(OrganizationMember, OrganizationMember.user_id == UserPreference.user_id)
        .where(OrganizationMember.organization_id == organization_id)
        .where(UserPreference.agents_json.is_not(None))
        .limit(1)
    )).scalars().first()
    cli_provider = ''
    cli_model = ''
    api_provider = ''
    api_model = ''
    if pref and pref.agents_json:
        import json as _json
        try:
            agents = _json.loads(pref.agents_json) or []
        except (ValueError, TypeError):
            agents = []
        for a in agents if isinstance(agents, list) else []:
            if not isinstance(a, dict) or a.get('enabled') is False:
                continue
            p = str(a.get('provider') or '').strip().lower()
            m = str(a.get('custom_model') or a.get('model') or '').strip()
            if p in ('claude_cli', 'codex_cli') and not cli_provider:
                cli_provider, cli_model = p, m
            elif p in ('openai', 'gemini', 'anthropic') and not api_provider:
                api_provider, api_model = p, m

    lang_label = {
        'en': 'English', 'tr': 'Türkçe', 'de': 'Deutsch',
        'es': 'Español', 'it': 'Italiano', 'ja': '日本語', 'zh': '中文',
    }.get(language, 'English')

    system_prompt = (
        'You write polite, contextual nudge comments for stale pull requests. '
        f'Reply ONLY in {lang_label}. Keep it under 80 words, one paragraph, '
        'no markdown headings. If the recent activity mentions a specific '
        'reviewer or technical question, reference it naturally — do NOT '
        'just repeat the hours-since-open. Do not include greetings like '
        '"Hi team", get straight to the point. Do not add a closing signature.'
    )
    user_prompt = (
        f'PR title: {(pr.title or "(no title)")}\n'
        f'Author: {(pr.author or "unknown")}\n'
        f'Hours waiting: {nudge.age_hours}\n'
        f'Severity: {nudge.severity or "info"}\n'
        f'Nudge number: {(nudge.nudge_count or 0) + 1}\n\n'
        f'Recent activity (most recent last):\n{activity or "(no comments yet)"}\n\n'
        'Write a short nudge comment for the reviewer.'
    )

    if cli_provider:
        # Light CLI call — no Read/Bash needed, prompt is self-contained.
        # Bridge timeout 60s; if it overruns we fall back to template.
        import os as _os, httpx as _httpx
        bridge_url = _os.getenv('CLI_BRIDGE_URL', 'http://cli-bridge:9876')
        cli = 'claude' if cli_provider == 'claude_cli' else 'codex'
        full_prompt = f'{system_prompt}\n\n---\n\n{user_prompt}'
        try:
            async with _httpx.AsyncClient(timeout=90) as client:
                resp = await client.post(
                    f'{bridge_url}/{cli}',
                    json={
                        'repo_path': '/tmp',  # no repo access needed
                        'prompt': full_prompt,
                        'model': cli_model or '',
                        'timeout': 60,
                        'read_only': True,
                    },
                )
                data = resp.json() if resp.content else {}
            if data.get('status') == 'ok':
                return (data.get('stdout') or '').strip()
        except Exception as exc:
            logger.info('CLI nudge generation failed: %s', exc)
        return ''

    if api_provider:
        from agena_services.services.review_service import _build_llm_for_org
        try:
            llm = await _build_llm_for_org(
                db, organization_id=organization_id,
                provider=api_provider, model=api_model or None,
            )
            output, _u, _m, _c = await llm.generate(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                complexity_hint='light',
                max_output_tokens=300,
            )
            return (output or '').strip()
        except Exception as exc:
            logger.info('LLM nudge generation failed: %s', exc)
    return ''


async def _verify_existing_agena_comment(
    db: AsyncSession,
    *,
    organization_id: int,
    pr,
    mapping,
) -> bool:
    """Returns True when a comment carrying the AGENA signature is still
    present on the PR thread. Used by scan_for_org to detect when a user
    deleted our last nudge from the source platform — in that case the
    UI's "Ready to nudge again" should flip back to true so the next
    scan cycle is allowed to post again."""
    activity_text = await _fetch_existing_pr_activity(
        db, organization_id=organization_id, pr=pr, mapping=mapping,
    )
    # _fetch returns a markdown summary; signature lives in the body
    # we POST so we have to look it up the same way. Pull the threads
    # one more time looking specifically for our signature.
    import base64 as _b64
    import httpx as _httpx
    from urllib.parse import quote as _q
    from agena_models.models.integration_config import IntegrationConfig
    provider = (pr.provider or '').strip().lower()
    if not pr.external_id:
        return False
    try:
        if provider == 'github':
            cfg = (await db.execute(
                select(IntegrationConfig).where(
                    IntegrationConfig.organization_id == organization_id,
                    IntegrationConfig.provider == 'github',
                )
            )).scalar_one_or_none()
            from agena_core.settings import get_settings
            token = ((cfg.secret if cfg else '') or get_settings().github_token or '').strip()
            headers = {'Accept': 'application/vnd.github.v3+json'}
            if token:
                headers['Authorization'] = f'Bearer {token}'
            async with _httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f'https://api.github.com/repos/{mapping.owner}/{mapping.repo_name}'
                    f'/issues/{pr.external_id}/comments?per_page=100',
                    headers=headers,
                )
                if resp.status_code != 200:
                    return False
                for c in resp.json() or []:
                    if _AGENA_SIGNATURE in (c.get('body') or ''):
                        return True
            return False
        if provider == 'azure':
            cfg = (await db.execute(
                select(IntegrationConfig).where(
                    IntegrationConfig.organization_id == organization_id,
                    IntegrationConfig.provider == 'azure',
                )
            )).scalar_one_or_none()
            if not cfg or not cfg.secret:
                return False
            org_url = (cfg.base_url or '').rstrip('/')
            if not org_url:
                return False
            project = _q(mapping.owner or '', safe='')
            repo = _q(mapping.repo_name or '', safe='')
            auth = _b64.b64encode(f':{cfg.secret}'.encode()).decode()
            headers = {'Authorization': f'Basic {auth}', 'Accept': 'application/json'}
            async with _httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f'{org_url}/{project}/_apis/git/repositories/{repo}/pullRequests/{pr.external_id}'
                    f'/threads?api-version=7.1-preview.1',
                    headers=headers,
                )
                if resp.status_code != 200:
                    return False
                threads = (resp.json() or {}).get('value') or []
                for t in threads:
                    if not isinstance(t, dict):
                        continue
                    if t.get('isDeleted'):
                        continue
                    for c in t.get('comments') or []:
                        if not isinstance(c, dict):
                            continue
                        if c.get('isDeleted'):
                            continue
                        if _AGENA_SIGNATURE in (c.get('content') or ''):
                            return True
            return False
    except Exception as exc:
        logger.info('AGENA signature check failed (provider=%s pr=%s): %s', provider, pr.external_id, exc)
    return False


async def _fetch_existing_pr_activity(
    db: AsyncSession,
    *,
    organization_id: int,
    pr,
    mapping,
) -> str:
    """Pull recent comments from the PR so the nudge body can summarise
    "what's been said" instead of just yelling about hours-since-open.
    Returns a short markdown block (≤ ~600 chars) or '' on failure.

    GitHub: /repos/{o}/{r}/issues/{n}/comments (PR review comments use a
        different endpoint but issue-thread comments are the high-signal
        ones for "is anyone reviewing").
    Azure : /repositories/{repoId}/pullRequests/{prId}/threads — each
        thread has a list of comments; we flatten + sort by lastUpdated.
    """
    from agena_models.models.integration_config import IntegrationConfig
    import base64 as _b64
    import httpx as _httpx
    provider = (pr.provider or '').strip().lower()
    if not pr.external_id:
        return ''
    try:
        if provider == 'github':
            cfg = (await db.execute(
                select(IntegrationConfig).where(
                    IntegrationConfig.organization_id == organization_id,
                    IntegrationConfig.provider == 'github',
                )
            )).scalar_one_or_none()
            from agena_core.settings import get_settings
            token = ((cfg.secret if cfg else '') or get_settings().github_token or '').strip()
            headers = {'Accept': 'application/vnd.github.v3+json'}
            if token:
                headers['Authorization'] = f'Bearer {token}'
            async with _httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f'https://api.github.com/repos/{mapping.owner}/{mapping.repo_name}'
                    f'/issues/{pr.external_id}/comments?per_page=10',
                    headers=headers,
                )
                if resp.status_code != 200:
                    return ''
                items = resp.json() or []
                if not items:
                    return ''
                lines = []
                for c in items[-3:]:  # last 3
                    user = ((c.get('user') or {}).get('login')) or 'unknown'
                    body = (c.get('body') or '').strip().replace('\n', ' ')[:120]
                    when = c.get('updated_at') or c.get('created_at') or ''
                    lines.append(f'- @{user} ({when[:10]}): {body}')
                return 'Recent activity:\n' + '\n'.join(lines)
        if provider == 'azure':
            cfg = (await db.execute(
                select(IntegrationConfig).where(
                    IntegrationConfig.organization_id == organization_id,
                    IntegrationConfig.provider == 'azure',
                )
            )).scalar_one_or_none()
            if not cfg or not cfg.secret:
                return ''
            org_url = (cfg.base_url or '').rstrip('/')
            if not org_url:
                return ''
            # Azure REST resolves a repo by name only when the URL also
            # carries the project. owner here = mapping.owner = the Azure
            # project name (set by sprints page when we synced repos).
            from urllib.parse import quote as _q
            project = _q(mapping.owner or '', safe='')
            repo = _q(mapping.repo_name or '', safe='')
            auth = _b64.b64encode(f':{cfg.secret}'.encode()).decode()
            headers = {'Authorization': f'Basic {auth}', 'Accept': 'application/json'}
            async with _httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f'{org_url}/{project}/_apis/git/repositories/{repo}/pullRequests/{pr.external_id}'
                    f'/threads?api-version=7.1-preview.1',
                    headers=headers,
                )
                if resp.status_code != 200:
                    return ''
                threads = (resp.json() or {}).get('value') or []
                # Flatten thread → comments, drop system threads, keep
                # text-typed comments by humans.
                flat: list[tuple[str, str, str]] = []
                for t in threads:
                    if not isinstance(t, dict):
                        continue
                    for c in t.get('comments') or []:
                        if not isinstance(c, dict):
                            continue
                        if (c.get('commentType') or '').lower() != 'text':
                            continue
                        author = ((c.get('author') or {}).get('displayName')) or 'unknown'
                        content = (c.get('content') or '').strip().replace('\n', ' ')[:120]
                        when = c.get('lastUpdatedDate') or c.get('publishedDate') or ''
                        if content:
                            flat.append((when, author, content))
                if not flat:
                    return ''
                flat.sort(key=lambda x: x[0])
                last3 = flat[-3:]
                lines = [f'- @{a} ({w[:10]}): {c}' for (w, a, c) in last3]
                return 'Recent activity:\n' + '\n'.join(lines)
    except Exception as exc:
        logger.info('PR activity fetch failed (provider=%s pr=%s): %s', provider, pr.external_id, exc)
    return ''


async def _post_pr_comment(db: AsyncSession, n: ReviewBacklogNudge) -> bool:
    """When channel='pr_comment', surface the nudge as an actual comment
    on the PR via the matching git provider. Returns True on success.

    Smart body: before posting, fetch the last few existing comments so
    the nudge can reference "the thread looks idle since @x said …" —
    less spammy than a context-free "review this please".

    Best-effort: a missing integration / unsupported provider just falls
    through to "marked as nudged" without raising — the row still
    captures intent, ops can wire the integration later.
    """
    pr = (
        await db.execute(select(GitPullRequest).where(GitPullRequest.id == n.pr_id))
    ).scalar_one_or_none()
    if pr is None or not pr.external_id:
        return False
    # Don't nudge dead PRs even when the row somehow survived a cleanup.
    if (pr.status or '').strip().lower() in DEAD_STATUSES:
        return False

    if not (pr.repo_mapping_id and pr.repo_mapping_id.isdigit()):
        return False
    from agena_models.models.repo_mapping import RepoMapping
    mapping = (
        await db.execute(
            select(RepoMapping).where(
                RepoMapping.id == int(pr.repo_mapping_id),
                RepoMapping.organization_id == n.organization_id,
            )
        )
    ).scalar_one_or_none()
    if mapping is None:
        return False

    activity = await _fetch_existing_pr_activity(
        db, organization_id=n.organization_id, pr=pr, mapping=mapping,
    )
    settings = await _settings_for(db, n.organization_id)
    body = await _compose_nudge_body(
        db,
        organization_id=n.organization_id,
        pr=pr,
        nudge=n,
        activity=activity,
        language=(settings.nudge_comment_language or 'en'),
        use_ai=bool(settings.nudge_use_ai),
    )

    provider = (pr.provider or '').lower()
    try:
        if provider == 'github':
            from agena_services.integrations.github_client import GitHubClient
            client = GitHubClient()
            await client.post_pr_issue_comment(
                mapping.owner, mapping.repo_name, int(pr.external_id), body,
            )
            return True
        if provider == 'azure':
            from agena_models.models.integration_config import IntegrationConfig
            cfg = (await db.execute(
                select(IntegrationConfig).where(
                    IntegrationConfig.organization_id == n.organization_id,
                    IntegrationConfig.provider == 'azure',
                )
            )).scalar_one_or_none()
            if not cfg or not cfg.secret:
                return False
            import base64 as _b64
            import httpx as _httpx
            from urllib.parse import quote as _q
            org_url = (cfg.base_url or '').rstrip('/')
            if not org_url:
                return False
            auth = _b64.b64encode(f':{cfg.secret}'.encode()).decode()
            headers = {
                'Authorization': f'Basic {auth}',
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            }
            # Azure REST refuses to resolve a repo by name unless the
            # project segment is in the URL. mapping.owner holds the
            # Azure project for repos imported via the sprints sync.
            project = _q(mapping.owner or '', safe='')
            repo = _q(mapping.repo_name or '', safe='')
            url = (
                f'{org_url}/{project}/_apis/git/repositories/{repo}/pullRequests/'
                f'{pr.external_id}/threads?api-version=7.1-preview.1'
            )
            payload = {
                'comments': [{
                    'parentCommentId': 0,
                    'content': body,
                    'commentType': 1,  # 1 = text comment in Azure REST
                }],
                'status': 'active',
            }
            async with _httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code in (200, 201):
                return True
            logger.info('Azure PR comment failed (status=%s body=%s)', resp.status_code, resp.text[:200])
            return False
        # GitLab / Bitbucket: not yet wired.
        return False
    except Exception:
        logger.exception('PR comment nudge failed for nudge=%s', n.id)
        return False


async def record_nudge(
    db: AsyncSession,
    nudge_id: int,
    *,
    organization_id: int,
    channel: str,
) -> tuple[ReviewBacklogNudge, str]:
    """Mark that a nudge was sent via the given channel. Returns
    (nudge_row, status) where status is one of:
      'sent'         — comment posted (or non-pr_comment channel logged)
      'rate_limited' — interval hasn't elapsed since the previous nudge
      'comment_failed' — pr_comment channel failed but row was bumped
                         anyway (best-effort — Slack/email may still go)
    The interval check stops fast double-clicks from posting two PR
    comments back-to-back (UI sometimes fires two requests when the
    user mashes the button)."""
    n = (
        await db.execute(
            select(ReviewBacklogNudge).where(
                ReviewBacklogNudge.id == nudge_id,
                ReviewBacklogNudge.organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()
    if n is None:
        raise ValueError('nudge not found')

    # Rate-limit: only block when we'd be posting on the same channel
    # within the configured interval. Switching channels (e.g. pr_comment
    # → slack) still goes through because that's a different intent.
    settings = await _settings_for(db, organization_id)
    interval_hours = max(1, int(settings.backlog_nudge_interval_hours or 6))
    if (
        n.last_nudged_at is not None
        and (n.last_nudge_channel or '') == channel
        and (datetime.utcnow() - n.last_nudged_at) < timedelta(hours=interval_hours)
    ):
        logger.info(
            'Nudge rate-limited: id=%s channel=%s interval=%sh last=%s',
            n.id, channel, interval_hours, n.last_nudged_at,
        )
        return n, 'rate_limited'

    # Channel can be a single value ('pr_comment') or a comma-separated
    # list ('pr_comment,slack_dm,whatsapp'). We dispatch each, collect
    # per-channel results, and report 'comment_failed' if at least one
    # actually-deliverable channel (pr_comment for now) couldn't post.
    channels = [c.strip() for c in (channel or '').split(',') if c.strip()]
    if not channels:
        channels = ['manual']

    delivered: list[str] = []
    failed: list[str] = []
    for ch in channels:
        if ch == 'pr_comment':
            ok = await _post_pr_comment(db, n)
            (delivered if ok else failed).append(ch)
        else:
            # Slack / email / WhatsApp / Telegram / manual all just
            # record intent for now — actual delivery is opt-in and
            # lives behind separate notification plumbing.
            delivered.append(ch)

    # Only stamp last_nudged_at when at least one channel actually
    # delivered. Without this, a failed PR-comment post (Azure 400, no
    # repo mapping, etc.) would still flip the row to "nudged Xh ago"
    # even though nothing landed anywhere — exactly the "Azure'da
    # yorum yok ama 21 saat sonra dürt diyor" bug.
    if not delivered:
        return n, 'comment_failed'
    n.last_nudged_at = datetime.utcnow()
    n.nudge_count = (n.nudge_count or 0) + 1
    n.last_nudge_channel = ','.join(delivered)
    if n.severity == 'critical' and n.escalated_at is None:
        n.escalated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(n)
    return n, ('comment_failed' if failed else 'sent')
