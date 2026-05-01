"""TaskReview engine — runs a reviewer agent prompt against a task's
description / diff / PR context and stores the verdict + findings as a
TaskReview record. No code is mutated and no PR is opened."""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from agena_core.settings import get_settings
from agena_models.models.integration_config import IntegrationConfig
from agena_models.models.prompt_override import PromptOverride
from agena_models.models.task_record import TaskRecord
from agena_models.models.task_review import TaskReview
from agena_models.models.user_preference import UserPreference
from agena_services.services.llm.provider import LLMProvider
from agena_services.services.prompt_service import PromptService

logger = logging.getLogger(__name__)

# Cap diff size to keep prompts under control. 6000 chars ≈ 1500 tokens —
# leaves enough headroom for the system prompt + description + verdict.
_MAX_DIFF_CHARS = 6000


_ROLE_TO_SLUG = {
    'reviewer': 'reviewer_system_prompt',
    'security_developer': 'security_dev_system_prompt',
    'qa': 'reviewer_system_prompt',  # falls back to general reviewer prompt
    'lead_developer': 'reviewer_system_prompt',
}


async def _fetch_pr_diff_for_review(
    db: AsyncSession,
    *,
    organization_id: int,
    pr_url: str,
) -> tuple[str, str]:
    """Fetch a textual representation of a PR's changes for the reviewer.

    Returns (diff_text, source_label). diff_text is empty on failure or
    when the URL doesn't match a supported provider — callers should
    gate the prompt section on emptiness.

    GitHub: returns the unified diff (Accept: application/vnd.github.v3.diff).
    Azure DevOps: returns a structured "file change list" (paths + change
    type), since Azure's REST API doesn't expose a single unified-diff
    endpoint and stitching one would require N extra calls per PR.
    """
    if not pr_url:
        return '', ''
    settings = get_settings()
    pr_url = pr_url.strip()

    # ── GitHub ─────────────────────────────────────────────────────────
    gh_match = re.match(
        r'^https?://(?:www\.)?github\.com/([^/]+)/([^/]+)/pull/(\d+)',
        pr_url, re.IGNORECASE,
    )
    if gh_match:
        owner, repo, pr_n = gh_match.group(1), gh_match.group(2), gh_match.group(3)
        from sqlalchemy import select
        cfg = (await db.execute(
            select(IntegrationConfig).where(
                IntegrationConfig.organization_id == organization_id,
                IntegrationConfig.provider == 'github',
            )
        )).scalar_one_or_none()
        token = (cfg.secret if cfg else '') or settings.github_token or ''
        headers = {'Accept': 'application/vnd.github.v3.diff'}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.get(
                    f'https://api.github.com/repos/{owner}/{repo}/pulls/{pr_n}',
                    headers=headers,
                )
                if resp.status_code == 200 and resp.text:
                    diff = resp.text
                    if len(diff) > _MAX_DIFF_CHARS:
                        diff = diff[:_MAX_DIFF_CHARS] + '\n\n[... diff truncated ...]\n'
                    return diff, f'github:{owner}/{repo}#{pr_n}'
        except Exception as exc:
            logger.info('github diff fetch failed for %s: %s', pr_url, exc)
        return '', ''

    # ── Azure DevOps ──────────────────────────────────────────────────
    # URL shapes:
    #   https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{prId}
    #   https://{org}.visualstudio.com/{project}/_git/{repo}/pullrequest/{prId}
    az_match = re.search(
        r'_git/([^/]+)/pullrequest/(\d+)', pr_url, re.IGNORECASE,
    )
    if az_match:
        from sqlalchemy import select
        cfg = (await db.execute(
            select(IntegrationConfig).where(
                IntegrationConfig.organization_id == organization_id,
                IntegrationConfig.provider == 'azure',
            )
        )).scalar_one_or_none()
        if not cfg or not cfg.secret:
            return '', ''
        repo_id = az_match.group(1)
        pr_id = az_match.group(2)
        org_url = (cfg.base_url or '').rstrip('/')
        if not org_url:
            return '', ''
        import base64 as _b64
        auth = _b64.b64encode(f':{cfg.secret}'.encode()).decode()
        headers = {'Authorization': f'Basic {auth}', 'Accept': 'application/json'}
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                # 1) Resolve PR to get latest iteration
                pr_resp = await client.get(
                    f'{org_url}/_apis/git/repositories/{repo_id}/pullrequests/{pr_id}'
                    f'?api-version=7.1-preview.1',
                    headers=headers,
                )
                if pr_resp.status_code != 200:
                    return '', ''
                pr_meta = pr_resp.json() if pr_resp.content else {}
                pr_title = str(pr_meta.get('title') or '').strip()
                # 2) List iterations, pick the highest id
                iters_resp = await client.get(
                    f'{org_url}/_apis/git/repositories/{repo_id}/pullrequests/{pr_id}/iterations'
                    f'?api-version=7.1-preview.1',
                    headers=headers,
                )
                if iters_resp.status_code != 200:
                    return '', ''
                iters = (iters_resp.json() if iters_resp.content else {}).get('value') or []
                if not iters:
                    return '', ''
                iter_id = max(int(i.get('id', 0) or 0) for i in iters if isinstance(i, dict))
                # 3) Fetch changes for that iteration
                ch_resp = await client.get(
                    f'{org_url}/_apis/git/repositories/{repo_id}/pullrequests/{pr_id}'
                    f'/iterations/{iter_id}/changes?api-version=7.1-preview.1',
                    headers=headers,
                )
                if ch_resp.status_code != 200:
                    return '', ''
                changes = (ch_resp.json() if ch_resp.content else {}).get('changeEntries') or []
                lines: list[str] = []
                if pr_title:
                    lines.append(f'PR title: {pr_title}')
                lines.append(f'Files changed: {len(changes)}')
                for c in changes[:80]:
                    if not isinstance(c, dict):
                        continue
                    item = c.get('item') or {}
                    path = str(item.get('path') or '').strip()
                    ctype = str(c.get('changeType') or '').strip()
                    if path:
                        lines.append(f'  [{ctype}] {path}')
                if len(changes) > 80:
                    lines.append(f'  ... +{len(changes) - 80} more files')
                text = '\n'.join(lines)
                if len(text) > _MAX_DIFF_CHARS:
                    text = text[:_MAX_DIFF_CHARS] + '\n\n[... change list truncated ...]\n'
                return text, f'azure:repo={repo_id} pr={pr_id}'
        except Exception as exc:
            logger.info('azure diff fetch failed for %s: %s', pr_url, exc)
        return '', ''

    return '', ''


_KNOWN_SLUGS = {
    'reviewer_system_prompt', 'security_dev_system_prompt',
    'pm_system_prompt', 'dev_system_prompt', 'ai_code_system_prompt',
    'finalize_system_prompt', 'fetch_context_system_prompt',
    'sentry_fix_prompt', 'newrelic_fix_prompt',
}


async def _resolve_reviewer_prompt(db: AsyncSession, role: str, user_id: int) -> str:
    """Pick the right prompt for the reviewer role.

    Resolution order:
      1. User-defined agent in their saved prefs with matching role → use
         that agent's `system_prompt`. If the value is a known slug, fetch
         it from the prompts DB; otherwise treat it as inline custom text
         and return it directly. This is what makes user-created reviewer
         agents work without a code change.
      2. Built-in role → slug map (_ROLE_TO_SLUG).
      3. Fallback: the generic reviewer_system_prompt.
    """
    role_norm = (role or '').strip().lower()

    # 1) Look up the user's agent for this role.
    from sqlalchemy import select
    from agena_models.models.user_preference import UserPreference
    pref = (await db.execute(
        select(UserPreference).where(UserPreference.user_id == user_id)
    )).scalar_one_or_none()
    if pref and pref.agents_json:
        try:
            agents = json.loads(pref.agents_json)
        except (ValueError, TypeError):
            agents = []
        if isinstance(agents, list):
            for a in agents:
                if not isinstance(a, dict):
                    continue
                if str(a.get('role') or '').strip().lower() != role_norm:
                    continue
                sp = str(a.get('system_prompt') or '').strip()
                if not sp:
                    break
                # If the saved value matches a known slug, load via PromptService
                # (so a user editing the prompt in Prompt Studio is reflected).
                if sp.lower() in _KNOWN_SLUGS or sp in _KNOWN_SLUGS:
                    try:
                        return await PromptService.get(db, sp.lower())
                    except ValueError:
                        pass
                # Otherwise treat as inline custom prompt text.
                return sp

    # 2) Built-in mapping.
    slug = _ROLE_TO_SLUG.get(role_norm, 'reviewer_system_prompt')
    try:
        return await PromptService.get(db, slug)
    except ValueError:
        # 3) Final fallback.
        return await PromptService.get(db, 'reviewer_system_prompt')


async def _resolve_reviewer_model(db: AsyncSession, user_id: int, role: str) -> tuple[str | None, str | None]:
    """Look up the user's saved agent for this role and return (provider,
    model). Falls back to (None, None) so the LLMProvider uses defaults."""
    from sqlalchemy import select
    pref = (await db.execute(
        select(UserPreference).where(UserPreference.user_id == user_id)
    )).scalar_one_or_none()
    if pref is None or not pref.agents_json:
        return None, None
    try:
        agents = json.loads(pref.agents_json)
    except (ValueError, TypeError):
        return None, None
    if not isinstance(agents, list):
        return None, None
    for a in agents:
        if not isinstance(a, dict):
            continue
        if str(a.get('role') or '').strip().lower() == role.strip().lower():
            provider = str(a.get('provider') or '').strip() or None
            model = str(a.get('custom_model') or a.get('model') or '').strip() or None
            return provider, model
    return None, None


def _parse_findings(output: str) -> tuple[int, int | None, str | None]:
    """Extract (findings_count, score, severity) from the markdown output.
    The reviewer prompt asks for headings like '### Findings' or numbered
    lists; we count them as a rough signal. Score and severity are extracted
    from explicit lines if present.

    Returns (count, score, severity)."""
    if not output:
        return 0, None, None

    # Count bullet / numbered findings
    bullets = re.findall(r'^\s*[-*]\s+\S', output, re.MULTILINE)
    numbered = re.findall(r'^\s*\d+\.\s+\S', output, re.MULTILINE)
    count = len(bullets) + len(numbered)

    score: int | None = None
    score_match = re.search(r'(?:score|verdict|confidence)[:=]?\s*(\d{1,3})', output, re.IGNORECASE)
    if score_match:
        try:
            v = int(score_match.group(1))
            if 0 <= v <= 100:
                score = v
        except ValueError:
            pass

    severity: str | None = None
    sev_match = re.search(r'severity[:=]?\s*(critical|high|medium|low|clean)', output, re.IGNORECASE)
    if sev_match:
        severity = sev_match.group(1).lower()
    elif count == 0:
        severity = 'clean'
    elif re.search(r'\b(critical|cve|rce|sql\s*injection|sqli|xss|ssrf|auth\s*bypass)\b', output, re.IGNORECASE):
        severity = 'critical'
    elif re.search(r'\b(high|severe)\b', output, re.IGNORECASE):
        severity = 'high'
    else:
        severity = 'medium'
    return count, score, severity


def _resolve_reviewer_role_from_task(task: TaskRecord, requested: str | None) -> str:
    """Decide which reviewer persona handles this task.

    Priority:
      1. Caller's explicit role (anything other than empty / 'auto').
      2. Task's stamped 'Preferred Agent Role' from description metadata
         (set by an IntegrationRule on import — e.g. security_developer for
         tickets reported by the security team).
      3. Generic 'reviewer'.

    No tag-based if/else: the routing is entirely declarative — the caller
    or the rule engine decided which persona; we just honour it."""
    requested_norm = (requested or '').strip().lower()
    if requested_norm and requested_norm != 'auto':
        return requested_norm

    desc = task.description or ''
    for line in desc.splitlines():
        if line.strip().lower().startswith('preferred agent role:'):
            value = line.split(':', 1)[1].strip().lower()
            if value:
                return value
    return 'reviewer'


async def trigger_review(
    db: AsyncSession,
    *,
    organization_id: int,
    task_id: int,
    requested_by_user_id: int,
    reviewer_agent_role: str,
) -> TaskReview:
    """Create a TaskReview row in 'pending' state, run the reviewer prompt
    inline, write the output back. Returns the persisted TaskReview row.

    NOTE: review runs synchronously (single LLM call, no code execution).
    For now we don't queue it through Redis — keeps this surface simple."""
    task = await db.get(TaskRecord, task_id)
    if task is None or task.organization_id != organization_id:
        raise ValueError('Task not found')

    # Refuse to review tasks with no actual code to inspect — a
    # repo_mapping_id alone just says "this task is associated with a
    # repo", not "there's a PR/branch/checkout we can read". Reviewing
    # blind on the description produces generic boilerplate that looks
    # authoritative but evaluates nothing.
    desc_lower = (task.description or '').lower()
    has_code_anchor = bool(
        (task.pr_url or '').strip()
        or (task.branch_name or '').strip()
        or 'local repo path:' in desc_lower
    )
    if not has_code_anchor:
        raise ValueError(
            'No code to review on this task. Open a PR via Run, or attach a '
            'local repo path, then re-run the review.'
        )

    role_norm = _resolve_reviewer_role_from_task(task, reviewer_agent_role)

    # Snapshot what the reviewer is looking at.
    snapshot_lines = [
        f'Task: #{task.id} {task.title or ""}',
        f'Source: {task.source}',
    ]
    if task.pr_url:
        snapshot_lines.append(f'PR: {task.pr_url}')
    if task.branch_name:
        snapshot_lines.append(f'Branch: {task.branch_name}')
    if task.repo_mapping_id:
        snapshot_lines.append(f'Repo mapping: #{task.repo_mapping_id}')

    review = TaskReview(
        organization_id=organization_id,
        task_id=task.id,
        requested_by_user_id=requested_by_user_id,
        reviewer_agent_role=role_norm,
        input_snapshot='\n'.join(snapshot_lines),
        status='running',
    )
    db.add(review)
    await db.commit()
    await db.refresh(review)

    try:
        system_prompt = await _resolve_reviewer_prompt(db, role_norm, requested_by_user_id)
        provider, model = await _resolve_reviewer_model(db, requested_by_user_id, role_norm)

        # Pull the actual diff (or change list for Azure) so the reviewer
        # has something concrete to evaluate. Empty when fetch fails or
        # the URL doesn't match a known provider — prompt section is
        # then omitted entirely instead of saying "(no diff)".
        diff_text, diff_source = '', ''
        if task.pr_url:
            diff_text, diff_source = await _fetch_pr_diff_for_review(
                db, organization_id=organization_id, pr_url=task.pr_url,
            )

        diff_section = ''
        if diff_text:
            diff_section = (
                f'## Diff ({diff_source})\n'
                f'```\n{diff_text}\n```\n\n'
            )
            # Stamp the snapshot too so the UI can show what was looked at.
            review.input_snapshot = (review.input_snapshot or '') + (
                f'\nDiff source: {diff_source} ({len(diff_text)} chars)'
            )
            await db.commit()

        user_prompt = (
            f'You are reviewing the following task. Produce a structured code-review report. '
            f'Do NOT write code, do NOT propose patches — only review.\n\n'
            f'Task ID: #{task.id}\n'
            f'Title: {task.title or ""}\n'
            f'Source: {task.source}\n'
            f'PR URL: {task.pr_url or "(no PR yet)"}\n'
            f'Branch: {task.branch_name or "(no branch)"}\n\n'
            f'## Description\n{(task.description or "")[:6000]}\n\n'
            f'{diff_section}'
            f'## Output format (REQUIRED)\n'
            f'### Summary\n(1-2 sentence overall verdict — anchor it on what you saw in the diff above when present)\n\n'
            f'### Findings\n(numbered list — each finding has: file/area, what is wrong, severity, suggested fix; reference specific lines from the diff)\n\n'
            f'### Severity\n(one of: critical / high / medium / low / clean)\n\n'
            f'### Score\n(0-100 integer — your confidence that this task / PR is ready to merge)'
        )

        llm = LLMProvider(provider=provider or 'openai')
        if model:
            # We don't override the model selection on LLMProvider directly,
            # but we can stamp it through complexity hints + record what we used.
            pass
        output, _usage, used_model, _cached = await llm.generate(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            complexity_hint='normal',
            max_output_tokens=2500,
        )

        count, score, severity = _parse_findings(output or '')
        review.output = output
        review.score = score
        review.findings_count = count
        review.severity = severity
        review.reviewer_provider = provider
        review.reviewer_model = used_model or model
        review.status = 'completed'
        review.completed_at = datetime.utcnow()
        await db.commit()
        await db.refresh(review)
        logger.info('Review #%s completed task=%s role=%s findings=%s severity=%s', review.id, task.id, role_norm, count, severity)
    except Exception as exc:
        review.status = 'failed'
        review.error_message = str(exc)[:500]
        review.completed_at = datetime.utcnow()
        await db.commit()
        await db.refresh(review)
        logger.exception('Review #%s failed: %s', review.id, exc)

    return review
