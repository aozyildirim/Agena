"""Stale Ticket Auto-Triage.

Once per cycle (default Sunday 18:00 UTC), scan every imported Jira /
Azure DevOps ticket whose `updated_at` is older than the org's
`triage_idle_days` threshold and that is still in an active status. For
each, ask the LLM to recommend one of: close / snooze / keep — with a
short reasoning paragraph. Persist the recommendation as a
TriageDecision so a human can bulk-approve from the UI.

The poller is idempotent: if a TriageDecision already exists for a
(org, task) and is still pending, we skip — the user hasn't acted on it
yet and re-running would just churn LLM cost. If the user has applied
or skipped the previous decision, we re-evaluate (the ticket may have
gone stale again).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.org_workflow_settings import OrgWorkflowSettings
from agena_models.models.organization import Organization
from agena_models.models.task_record import TaskRecord
from agena_models.models.triage_decision import TriageDecision
from agena_services.services.llm.provider import LLMProvider

logger = logging.getLogger(__name__)


# TaskRecord.status values that count as "still open and worth triaging".
# Anything completed / failed / cancelled stays out of the triage queue.
# 'new' is what create_task_from_external() writes for imported Jira /
# Azure work items that haven't been Run yet — leaving it out of this
# set was the reason scan reported 0 candidates against fresh imports.
ACTIVE_STATUSES = {
    'new', 'queued', 'pending', 'open', 'in_progress', 'running', 'paused',
}


SYSTEM_PROMPT = (
    "You are a senior project triage assistant. Given a stale ticket "
    "(no activity for many days), decide one of three verdicts and write "
    "a single short sentence explaining why.\n\n"
    "Verdicts:\n"
    "  close   — looks resolved, abandoned, or obviously irrelevant now\n"
    "  snooze  — still potentially valid but no urgency; defer 30+ days\n"
    "  keep    — should stay open and active; do not snooze\n\n"
    "Be conservative on 'close' — only pick it when the evidence in the "
    "ticket itself suggests resolution (e.g. references a merged PR or a "
    "follow-up ticket). When unsure, prefer 'snooze' over 'close'.\n\n"
    "Reply with exactly two lines:\n"
    "VERDICT: close|snooze|keep\n"
    "REASON: <one sentence, ≤180 chars>"
)


async def _settings_for(db: AsyncSession, org_id: int) -> OrgWorkflowSettings:
    """Read or lazily create the org's workflow settings row."""
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


def _parse_verdict(output: str) -> tuple[str, str]:
    """Parse the two-line response from the LLM into (verdict, reason).
    Falls back to ('keep', '...') if parsing fails so we never silently
    apply a destructive close."""
    verdict = 'keep'
    reason = ''
    for raw in (output or '').splitlines():
        line = raw.strip()
        if line.lower().startswith('verdict:'):
            v = line.split(':', 1)[1].strip().lower()
            if v in {'close', 'snooze', 'keep'}:
                verdict = v
        elif line.lower().startswith('reason:'):
            reason = line.split(':', 1)[1].strip()[:180]
    if not reason:
        reason = 'No reasoning emitted; defaulting to keep'
    return verdict, reason


async def _resolve_org_agent(db: AsyncSession, organization_id: int) -> tuple[str, str]:
    """Pick an agent from the org's user prefs. Returns (provider, model).
    Prefers claude_cli, then codex_cli (no API key required), then any
    configured API agent. Returns ('', '') when nothing is configured."""
    import json as _json
    from agena_models.models.organization_member import OrganizationMember
    from agena_models.models.user_preference import UserPreference
    pref = (await db.execute(
        select(UserPreference)
        .join(OrganizationMember, OrganizationMember.user_id == UserPreference.user_id)
        .where(OrganizationMember.organization_id == organization_id)
        .where(UserPreference.agents_json.is_not(None))
        .limit(1)
    )).scalars().first()
    if pref is None or not pref.agents_json:
        return '', ''
    try:
        agents = _json.loads(pref.agents_json) or []
    except (ValueError, TypeError):
        return '', ''
    if not isinstance(agents, list):
        return '', ''
    cli_match: tuple[str, str] | None = None
    api_match: tuple[str, str] | None = None
    for preferred in ('claude_cli', 'codex_cli'):
        for a in agents:
            if not isinstance(a, dict) or a.get('enabled') is False:
                continue
            p = str(a.get('provider') or '').strip().lower()
            if p == preferred and cli_match is None:
                m = str(a.get('custom_model') or a.get('model') or '').strip()
                cli_match = (preferred, m)
                break
        if cli_match:
            break
    if cli_match is None:
        for a in agents:
            if not isinstance(a, dict) or a.get('enabled') is False:
                continue
            p = str(a.get('provider') or '').strip().lower()
            if p in ('openai', 'gemini', 'anthropic'):
                m = str(a.get('custom_model') or a.get('model') or '').strip()
                api_match = (p, m)
                break
    return cli_match or api_match or ('', '')


async def _evaluate(
    task: TaskRecord,
    idle_days: int,
    *,
    db: AsyncSession,
    organization_id: int,
) -> tuple[str, int, str]:
    """Run a single LLM call to classify one stale ticket.
    Returns (verdict, confidence_0_100, reasoning).

    Routing mirrors review_service: claude_cli / codex_cli agents go
    through the local bridge (host's CLI auth, no API key needed).
    openai / gemini / anthropic agents pull credentials from the org's
    integration_configs row — env-level OPENAI_API_KEY is intentionally
    NOT consulted. When no agent is configured at all, raises so the
    scan loop can mark the row as failed instead of silently mocking."""
    user_prompt = (
        f'Source: {task.source}\n'
        f'External ID: {task.external_id}\n'
        f'Title: {task.title or ""}\n'
        f'Status: {task.status}\n'
        f'Priority: {task.priority or "—"}\n'
        f'Assigned to: {task.assigned_to or "—"}\n'
        f'Idle for: {idle_days} days\n'
        f'Has linked PR: {"yes" if task.pr_url else "no"}\n'
        f'Has branch: {"yes" if task.branch_name else "no"}\n\n'
        f'## Description\n{(task.description or "")[:3000]}\n'
    )

    provider, model = await _resolve_org_agent(db, organization_id)
    if not provider:
        raise RuntimeError(
            'No agent configured for this organization. Add a claude_cli / '
            'codex_cli / openai / gemini / anthropic agent under '
            '/dashboard/agents to enable triage.'
        )

    output = ''
    if provider in ('claude_cli', 'codex_cli'):
        # CLI bridge — read-only, /tmp working dir (no repo access needed
        # for triage; the verdict is description-driven).
        import os as _os
        import httpx as _httpx
        bridge_url = _os.getenv('CLI_BRIDGE_URL', 'http://cli-bridge:9876')
        cli = 'claude' if provider == 'claude_cli' else 'codex'
        full_prompt = f'{SYSTEM_PROMPT}\n\n---\n\n{user_prompt}'
        async with _httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f'{bridge_url}/{cli}',
                json={
                    'repo_path': '/tmp',
                    'prompt': full_prompt,
                    'model': model or '',
                    'timeout': 90,
                    'read_only': True,
                },
            )
            data = resp.json() if resp.content else {}
        if data.get('status') == 'ok':
            output = (data.get('stdout') or '').strip()
        else:
            raise RuntimeError(
                f'{cli} bridge error: {data.get("message", data.get("stderr", "unknown"))}'
            )
    else:
        # API provider via the same org-scoped helper review_service uses.
        from agena_services.services.review_service import _build_llm_for_org
        llm = await _build_llm_for_org(
            db, organization_id=organization_id,
            provider=provider, model=model or None,
        )
        output, _usage, _model, _cached = await llm.generate(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=user_prompt,
            complexity_hint='light',
            max_output_tokens=200,
        )

    verdict, reason = _parse_verdict(output or '')
    # Confidence: a coarse mapping. We don't ask the LLM for a number
    # explicitly because that adds tokens for marginal value; instead
    # idle_days drives the floor and the user's manual override teaches
    # us over time (acked verdicts vs overridden ones).
    if idle_days >= 90:
        confidence = 75
    elif idle_days >= 60:
        confidence = 65
    else:
        confidence = 55
    if verdict == 'keep':
        # When the model picks "keep", the action is non-destructive,
        # so we publish higher confidence — it's fine.
        confidence = max(confidence, 70)
    return verdict, confidence, reason


_SOURCE_ALIASES = {
    # The seeded default settings row uses 'azure_devops' but the import
    # path writes TaskRecord.source = 'azure'. Treat both as equivalent
    # so an admin doesn't have to know which spelling matches the DB.
    'azure_devops': ['azure', 'azure_devops'],
    'azure': ['azure', 'azure_devops'],
    'jira': ['jira'],
}


def _expand_sources(sources: list[str]) -> list[str]:
    out: list[str] = []
    for s in sources:
        for expanded in _SOURCE_ALIASES.get(s, [s]):
            if expanded not in out:
                out.append(expanded)
    return out


async def scan_for_org(
    db: AsyncSession,
    org_id: int,
    *,
    now: datetime | None = None,
) -> dict:
    """Run a triage pass for one org. Returns a diagnostic dict so the
    caller (UI / cron) can explain why nothing was created when scan
    looks like a no-op:

        {
          'new_or_refreshed': N,
          'considered': total candidate task rows in the cutoff,
          'threshold_days': configured idle threshold,
          'sources': normalised source list,
          'reason': human string when N == 0,
        }
    """
    settings = await _settings_for(db, org_id)
    if not settings.triage_enabled:
        return {
            'new_or_refreshed': 0, 'considered': 0,
            'threshold_days': settings.triage_idle_days,
            'sources': [], 'reason': 'triage_disabled',
        }

    raw_sources = [s.strip() for s in (settings.triage_sources or '').split(',') if s.strip()]
    sources = _expand_sources(raw_sources)
    if not sources:
        return {
            'new_or_refreshed': 0, 'considered': 0,
            'threshold_days': settings.triage_idle_days,
            'sources': [], 'reason': 'no_sources_configured',
        }

    now = now or datetime.utcnow()
    cutoff = now - timedelta(days=settings.triage_idle_days)

    rows = (
        await db.execute(
            select(TaskRecord).where(
                TaskRecord.organization_id == org_id,
                TaskRecord.source.in_(sources),
                TaskRecord.status.in_(list(ACTIVE_STATUSES)),
                TaskRecord.updated_at <= cutoff,
            )
        )
    ).scalars().all()

    new_decisions = 0
    for task in rows:
        existing = (
            await db.execute(
                select(TriageDecision).where(
                    TriageDecision.organization_id == org_id,
                    TriageDecision.task_id == task.id,
                )
            )
        ).scalar_one_or_none()
        # Skip if a pending decision already exists — user hasn't acted.
        # Re-evaluate once a decision has been applied / skipped so we can
        # surface a fresh recommendation if the ticket goes stale again.
        if existing and existing.status == 'pending':
            continue

        idle_days = max(1, (now - task.updated_at).days)
        try:
            verdict, confidence, reasoning = await _evaluate(
                task, idle_days, db=db, organization_id=org_id,
            )
        except Exception:
            logger.exception('Triage LLM call failed for task=%s', task.id)
            continue

        if existing is not None:
            existing.idle_days = idle_days
            existing.ai_verdict = verdict
            existing.ai_confidence = confidence
            existing.ai_reasoning = reasoning
            existing.status = 'pending'
            existing.applied_verdict = None
            existing.applied_at = None
            existing.applied_by_user_id = None
        else:
            db.add(TriageDecision(
                organization_id=org_id,
                task_id=task.id,
                source=task.source,
                external_id=task.external_id,
                ticket_title=task.title,
                idle_days=idle_days,
                ai_verdict=verdict,
                ai_confidence=confidence,
                ai_reasoning=reasoning,
                status='pending',
            ))
        new_decisions += 1

    if new_decisions:
        await db.commit()
        logger.info('Triage scan: org=%s new/refreshed decisions=%s', org_id, new_decisions)

    reason = ''
    if new_decisions == 0:
        if not rows:
            reason = (
                f'no_stale_candidates'  # nothing met the {idle_days}-day cutoff
            )
        else:
            reason = 'all_candidates_have_pending_decisions'
    return {
        'new_or_refreshed': new_decisions,
        'considered': len(rows),
        'threshold_days': settings.triage_idle_days,
        'sources': sources,
        'reason': reason,
    }


async def scan_all_orgs(db: AsyncSession) -> int:
    org_ids: Iterable[int] = (
        await db.execute(select(Organization.id))
    ).scalars().all()
    total = 0
    for oid in org_ids:
        try:
            r = await scan_for_org(db, oid)
            total += int(r.get('new_or_refreshed', 0)) if isinstance(r, dict) else 0
        except Exception:
            logger.exception('Triage scan failed for org=%s', oid)
    return total


async def apply_decision(
    db: AsyncSession,
    decision_id: int,
    *,
    organization_id: int,
    user_id: int,
    verdict: str,
) -> TriageDecision:
    """User-driven action on a decision. Updates the linked TaskRecord's
    status and posts a comment to the source system if a writeback
    integration is wired up.

    For now we only update the AGENA-side TaskRecord — full writeback
    (Jira transition, Azure work-item state change) is opt-in and lives
    behind separate integration plumbing. The decision row itself
    carries the audit trail regardless."""
    if verdict not in {'close', 'snooze', 'keep'}:
        raise ValueError('invalid verdict')

    decision = (
        await db.execute(
            select(TriageDecision).where(
                TriageDecision.id == decision_id,
                TriageDecision.organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()
    if decision is None:
        raise ValueError('decision not found')

    task = (
        await db.execute(select(TaskRecord).where(TaskRecord.id == decision.task_id))
    ).scalar_one_or_none()

    if task is not None:
        if verdict == 'close':
            task.status = 'completed'
        elif verdict == 'snooze':
            task.status = 'paused'
        # 'keep' = no change

    decision.status = 'applied'
    decision.applied_verdict = verdict
    decision.applied_at = datetime.utcnow()
    decision.applied_by_user_id = user_id
    await db.commit()
    await db.refresh(decision)
    return decision


async def skip_decision(
    db: AsyncSession,
    decision_id: int,
    *,
    organization_id: int,
    user_id: int,
) -> TriageDecision:
    decision = (
        await db.execute(
            select(TriageDecision).where(
                TriageDecision.id == decision_id,
                TriageDecision.organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()
    if decision is None:
        raise ValueError('decision not found')
    decision.status = 'skipped'
    decision.applied_at = datetime.utcnow()
    decision.applied_by_user_id = user_id
    await db.commit()
    await db.refresh(decision)
    return decision
