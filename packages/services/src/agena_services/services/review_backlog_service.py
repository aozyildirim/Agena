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

    open_pr_ids = set()
    for pr in rows:
        if pr.repo_mapping_id in exempt_repos:
            continue
        # Drop abandoned / declined / closed PRs even when they slipped
        # past the merged_at/closed_at filter (Azure's abandoned PRs may
        # leave closed_at NULL while flipping status='abandoned' — the
        # SQL filter above misses those).
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
    body = (
        f"⏱️ **AGENA Review Backlog**\n\n"
        f"This PR has been waiting for review for **{n.age_hours} hours** "
        f"(severity: {n.severity or 'info'}). Nudge #{(n.nudge_count or 0) + 1}.\n"
    )
    if activity:
        body += f'\n{activity}\n'
    body += '\nConfigure thresholds at `/dashboard/review-backlog`.'

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
) -> ReviewBacklogNudge:
    """Mark that a nudge was sent via the given channel. For
    channel='pr_comment' we also try to post a comment on the PR
    via the configured git provider. Slack/email delivery is wired
    elsewhere; this function records the timestamp + counter no
    matter which channel succeeds."""
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

    if channel == 'pr_comment':
        await _post_pr_comment(db, n)

    n.last_nudged_at = datetime.utcnow()
    n.nudge_count = (n.nudge_count or 0) + 1
    n.last_nudge_channel = channel
    if n.severity == 'critical' and n.escalated_at is None:
        n.escalated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(n)
    return n
