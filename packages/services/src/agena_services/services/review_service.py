"""TaskReview engine — runs a reviewer agent prompt against a task's
description / diff / PR context and stores the verdict + findings as a
TaskReview record. No code is mutated and no PR is opened."""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.prompt_override import PromptOverride
from agena_models.models.task_record import TaskRecord
from agena_models.models.task_review import TaskReview
from agena_models.models.user_preference import UserPreference
from agena_services.services.llm.provider import LLMProvider
from agena_services.services.prompt_service import PromptService

logger = logging.getLogger(__name__)


_ROLE_TO_SLUG = {
    'reviewer': 'reviewer_system_prompt',
    'security_developer': 'security_dev_system_prompt',
    'qa': 'reviewer_system_prompt',  # falls back to general reviewer prompt
    'lead_developer': 'reviewer_system_prompt',
}


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

        user_prompt = (
            f'You are reviewing the following task. Produce a structured code-review report. '
            f'Do NOT write code, do NOT propose patches — only review.\n\n'
            f'Task ID: #{task.id}\n'
            f'Title: {task.title or ""}\n'
            f'Source: {task.source}\n'
            f'PR URL: {task.pr_url or "(no PR yet)"}\n'
            f'Branch: {task.branch_name or "(no branch)"}\n\n'
            f'## Description\n{(task.description or "")[:6000]}\n\n'
            f'## Output format (REQUIRED)\n'
            f'### Summary\n(1-2 sentence overall verdict)\n\n'
            f'### Findings\n(numbered list — each finding has: file/area, what is wrong, severity, suggested fix)\n\n'
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
