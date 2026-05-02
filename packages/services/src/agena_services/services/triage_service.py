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


# Per-org scan task tracker. asyncio.create_task only weak-refs Tasks,
# so without this set GC could cancel a long scan mid-flight (the
# "asyncio.create_task: hold a strong reference" pitfall). Each task
# pops itself in done_callback so we never grow unbounded.
_SCAN_BG_TASKS: dict[int, "asyncio.Task"] = {}
# Lightweight progress dict so the UI can poll "Taranıyor…" status.
_SCAN_PROGRESS: dict[int, dict] = {}


import asyncio  # noqa: E402 — module-level import below the docstring


def get_scan_progress(org_id: int) -> dict:
    """Returns the current/last scan state for one org.
    Shape: {status: idle|running|done|failed, considered, decided,
    started_at, finished_at, error}."""
    p = _SCAN_PROGRESS.get(int(org_id))
    if not p:
        return {'status': 'idle'}
    return dict(p)


async def start_scan_for_org(db: AsyncSession, org_id: int) -> dict:
    """Schedule scan_for_org() as a background asyncio task and return
    immediately. Idempotent: a second call while a scan is in flight
    returns status='already_running' instead of spawning a duplicate."""
    settings = await _settings_for(db, org_id)
    if not settings.triage_enabled:
        return {'status': 'disabled', 'reason': 'triage_disabled'}
    if not (settings.triage_sources or '').strip():
        return {'status': 'no_sources', 'reason': 'no_sources_configured'}

    if org_id in _SCAN_BG_TASKS and not _SCAN_BG_TASKS[org_id].done():
        return {'status': 'already_running', **_SCAN_PROGRESS.get(org_id, {})}

    _SCAN_PROGRESS[org_id] = {
        'status': 'running',
        'considered': 0,
        'decided': 0,
        'started_at': datetime.utcnow().isoformat(),
        'finished_at': None,
        'error': None,
        'threshold_days': settings.triage_idle_days,
    }

    async def _run() -> None:
        from agena_core.database import SessionLocal
        try:
            async with SessionLocal() as bg_db:
                result = await scan_for_org(bg_db, org_id)
            prev = _SCAN_PROGRESS.get(org_id, {})
            _SCAN_PROGRESS[org_id] = {
                **prev,
                'status': 'done',
                'considered': result.get('considered', 0),
                'decided': result.get('new_or_refreshed', 0),
                'reason': result.get('reason', ''),
                'finished_at': datetime.utcnow().isoformat(),
            }
        except Exception as exc:
            logger.exception('Background triage scan failed for org=%s', org_id)
            prev = _SCAN_PROGRESS.get(org_id, {})
            _SCAN_PROGRESS[org_id] = {
                **prev,
                'status': 'failed',
                'error': str(exc)[:300],
                'finished_at': datetime.utcnow().isoformat(),
            }

    task = asyncio.create_task(_run())
    _SCAN_BG_TASKS[org_id] = task
    task.add_done_callback(lambda _t: _SCAN_BG_TASKS.pop(org_id, None))
    return {'status': 'running', **_SCAN_PROGRESS[org_id]}


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


def _make_stub_task(payload: dict):
    """Build a TaskRecord-shaped stub for _evaluate(). Source-side scans
    don't have a real DB row to feed in — _evaluate only reads attributes
    so a SimpleNamespace clone works without polluting task_records."""
    from types import SimpleNamespace
    return SimpleNamespace(
        id=None,
        organization_id=payload.get('organization_id'),
        source=payload.get('source', ''),
        external_id=payload.get('external_id', ''),
        title=payload.get('title', '') or '',
        description=payload.get('description', '') or '',
        status=payload.get('status', '') or 'open',
        priority=payload.get('priority'),
        assigned_to=payload.get('assigned_to'),
        pr_url=payload.get('pr_url'),
        branch_name=payload.get('branch_name'),
        repo_mapping_id=None,
    )


async def _scan_jira_source(
    db: AsyncSession,
    org_id: int,
    *,
    idle_days: int,
    max_results: int = 200,
) -> list[dict]:
    """Pull stale Jira issues directly via JQL — no AGENA import needed.
    Filters on (statusCategory != Done) and (updated <= -Ndays). Returns
    a list of normalised dicts the scan loop turns into TriageDecisions.
    Empty list when Jira isn't configured."""
    from agena_models.models.integration_config import IntegrationConfig
    import base64 as _b64
    import httpx as _httpx
    cfg = (await db.execute(
        select(IntegrationConfig).where(
            IntegrationConfig.organization_id == org_id,
            IntegrationConfig.provider == 'jira',
        )
    )).scalar_one_or_none()
    if cfg is None or not cfg.secret:
        return []
    base_url = (cfg.base_url or '').rstrip('/')
    if not base_url:
        return []
    email = (cfg.username or '').strip()
    auth = _b64.b64encode(f'{email}:{cfg.secret}'.encode()).decode()
    headers = {'Authorization': f'Basic {auth}', 'Accept': 'application/json'}
    jql = f'statusCategory != Done AND updated <= -{int(idle_days)}d ORDER BY updated ASC'
    # Atlassian deprecated /rest/api/3/search in 2024 — the new endpoint
    # is /rest/api/3/search/jql (POST). Old endpoint returns 410 on
    # cloud instances now. Switch to the new one.
    out: list[dict] = []
    next_token: str | None = None
    page = 50
    async with _httpx.AsyncClient(timeout=20) as client:
        while len(out) < max_results:
            payload: dict = {
                'jql': jql,
                'maxResults': page,
                'fields': ['summary', 'status', 'priority', 'assignee', 'updated', 'reporter'],
            }
            if next_token:
                payload['nextPageToken'] = next_token
            resp = await client.post(
                f'{base_url}/rest/api/3/search/jql',
                json=payload,
                headers={**headers, 'Content-Type': 'application/json'},
            )
            if resp.status_code != 200:
                logger.info(
                    'Jira JQL scan failed: status=%s body=%s',
                    resp.status_code, resp.text[:200],
                )
                break
            data = resp.json() if resp.content else {}
            issues = data.get('issues') or []
            for it in issues:
                if not isinstance(it, dict):
                    continue
                key = str(it.get('key') or '').strip()
                fields = it.get('fields') or {}
                if not key:
                    continue
                from datetime import datetime as _dt
                updated = str(fields.get('updated') or '').strip()
                idle = idle_days
                try:
                    if updated:
                        dt = _dt.fromisoformat(updated.replace('Z', '+00:00'))
                        idle = max(1, (datetime.utcnow() - dt.replace(tzinfo=None)).days)
                except Exception:
                    pass
                priority = ((fields.get('priority') or {}).get('name')) if isinstance(fields.get('priority'), dict) else None
                assignee = ((fields.get('assignee') or {}).get('displayName')) if isinstance(fields.get('assignee'), dict) else None
                status_name = ((fields.get('status') or {}).get('name')) if isinstance(fields.get('status'), dict) else ''
                # Jira project key is the prefix before '-' (SCRUM-6 → SCRUM).
                project_key = key.split('-', 1)[0] if '-' in key else ''
                out.append({
                    'organization_id': org_id,
                    'source': 'jira',
                    'external_id': key,
                    'project_key': project_key,
                    'title': str(fields.get('summary') or '')[:512],
                    'description': '',
                    'status': str(status_name) or 'open',
                    'priority': priority,
                    'assigned_to': assignee,
                    'idle_days': idle,
                    'url': f'{base_url}/browse/{key}',
                    'source_updated_at': updated,
                })
                if len(out) >= max_results:
                    break
            if len(out) >= max_results:
                break
            # New endpoint paginates with `nextPageToken` (cursor) +
            # `isLast`. Break when either signals no more results.
            next_token = data.get('nextPageToken')
            if data.get('isLast') or not next_token or not issues:
                break
    return out


async def _scan_azure_source(
    db: AsyncSession,
    org_id: int,
    *,
    idle_days: int,
    max_results: int = 200,
) -> list[dict]:
    """Pull stale Azure DevOps work items via WIQL — query against the
    user's preferred azure_project (from user_preferences). Skips when
    the org has no Azure integration or no project picked."""
    from agena_models.models.integration_config import IntegrationConfig
    from agena_models.models.organization_member import OrganizationMember
    from agena_models.models.user_preference import UserPreference
    import base64 as _b64
    import httpx as _httpx
    from urllib.parse import quote as _q

    cfg = (await db.execute(
        select(IntegrationConfig).where(
            IntegrationConfig.organization_id == org_id,
            IntegrationConfig.provider == 'azure',
        )
    )).scalar_one_or_none()
    if cfg is None or not cfg.secret:
        return []
    org_url = (cfg.base_url or '').rstrip('/')
    if not org_url:
        return []
    # Scan EVERY Azure project the PAT can see, not just the user's
    # currently-saved azure_project. Triage is for "everything stale",
    # so capping it to one project would miss most of the org.
    auth = _b64.b64encode(f':{cfg.secret}'.encode()).decode()
    list_headers = {'Authorization': f'Basic {auth}', 'Accept': 'application/json'}
    projects: list[str] = []
    try:
        async with _httpx.AsyncClient(timeout=20) as client:
            continuation: str | None = None
            while True:
                url = f'{org_url}/_apis/projects?api-version=7.1&$top=200'
                if continuation:
                    url += f'&continuationToken={_q(continuation)}'
                resp = await client.get(url, headers=list_headers)
                if resp.status_code != 200:
                    break
                data = resp.json() if resp.content else {}
                for p in data.get('value', []):
                    name = str((p or {}).get('name') or '').strip()
                    if name and name not in projects:
                        projects.append(name)
                continuation = resp.headers.get('x-ms-continuationtoken') or ''
                if not continuation:
                    break
    except Exception as exc:
        logger.info('Azure project listing failed: %s', exc)
    if not projects:
        # Fall back to the saved preference if the project list call
        # failed (limited PAT scope, network blip).
        pref = (await db.execute(
            select(UserPreference)
            .join(OrganizationMember, OrganizationMember.user_id == UserPreference.user_id)
            .where(OrganizationMember.organization_id == org_id)
            .limit(1)
        )).scalars().first()
        fallback = (pref.azure_project if pref else '') or ''
        if not fallback:
            logger.info(
                'Azure source-side triage skipped: no projects discovered for org=%s', org_id,
            )
            return []
        projects = [fallback]

    headers = {
        'Authorization': f'Basic {auth}',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }
    # Exclude every "ticket is over" state we've seen across Agile /
    # Scrum / CMMI / common custom process templates. Both US and UK
    # spellings of cancelled because Azure lets either be configured.
    dead_states = (
        "'Done','Closed','Removed','Resolved',"
        "'Cancelled','Canceled','Rejected','Withdrawn','Abandoned',"
        "'Wont Fix','Won''t Fix','WontFix','Duplicate'"
    )
    wiql = (
        "SELECT [System.Id] FROM WorkItems "
        "WHERE [System.TeamProject] = @project "
        f"AND [System.State] NOT IN ({dead_states}) "
        f"AND [System.ChangedDate] <= @today - {int(idle_days)} "
        "ORDER BY [System.ChangedDate] ASC"
    )
    out: list[dict] = []
    async with _httpx.AsyncClient(timeout=20) as client:
      for project in projects:
        if len(out) >= max_results:
            break
        wiql_resp = await client.post(
            f'{org_url}/{_q(project)}/_apis/wit/wiql?api-version=7.1-preview.2',
            json={'query': wiql},
            headers=headers,
        )
        if wiql_resp.status_code != 200:
            logger.info('Azure WIQL scan failed for project=%s status=%s body=%s',
                        project, wiql_resp.status_code, wiql_resp.text[:200])
            continue
        ids = [int(w.get('id', 0)) for w in (wiql_resp.json() or {}).get('workItems') or [] if isinstance(w, dict)]
        ids = [i for i in ids if i][:max_results - len(out)]
        if not ids:
            continue
        # Hydrate in chunks (Azure's "ids" param caps around 200)
        chunk = 100
        from datetime import datetime as _dt
        for i in range(0, len(ids), chunk):
            batch = ids[i:i + chunk]
            ids_str = ','.join(str(x) for x in batch)
            hyd = await client.get(
                f'{org_url}/_apis/wit/workitems?ids={ids_str}'
                f'&fields=System.Id,System.Title,System.State,System.ChangedDate,'
                f'System.AssignedTo,Microsoft.VSTS.Common.Priority,System.TeamProject'
                f'&api-version=7.1-preview.3',
                headers=headers,
            )
            if hyd.status_code != 200:
                continue
            _DEAD_STATES_LOWER = {
                'done', 'closed', 'removed', 'resolved',
                'cancelled', 'canceled', 'rejected', 'withdrawn',
                'abandoned', 'wont fix', "won't fix", 'wontfix',
                'duplicate',
            }
            for w in (hyd.json() or {}).get('value') or []:
                if not isinstance(w, dict):
                    continue
                fields = w.get('fields') or {}
                wid = fields.get('System.Id') or w.get('id')
                if not wid:
                    continue
                state_val = str(fields.get('System.State') or '').strip().lower()
                if state_val in _DEAD_STATES_LOWER:
                    # WIQL should've filtered this, but cached / custom
                    # states sometimes slip through. Belt-and-braces.
                    continue
                changed = str(fields.get('System.ChangedDate') or '').strip()
                idle = idle_days
                try:
                    if changed:
                        dt = _dt.fromisoformat(changed.replace('Z', '+00:00'))
                        idle = max(1, (datetime.utcnow() - dt.replace(tzinfo=None)).days)
                except Exception:
                    pass
                assigned_raw = fields.get('System.AssignedTo')
                if isinstance(assigned_raw, dict):
                    assignee = assigned_raw.get('displayName') or assigned_raw.get('uniqueName')
                else:
                    assignee = assigned_raw
                proj = fields.get('System.TeamProject') or project
                out.append({
                    'organization_id': org_id,
                    'source': 'azure',
                    'external_id': str(wid),
                    'project_key': proj,
                    'title': str(fields.get('System.Title') or '')[:512],
                    'description': '',
                    'status': str(fields.get('System.State') or 'open'),
                    'priority': str(fields.get('Microsoft.VSTS.Common.Priority') or ''),
                    'assigned_to': assignee,
                    'idle_days': idle,
                    'url': f'{org_url}/{_q(proj)}/_workitems/edit/{wid}',
                    'source_updated_at': changed,
                })
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
    idle_days = settings.triage_idle_days

    # Source-side scan: hit Jira / Azure REST directly so we triage the
    # whole project, not just the slice that's been imported into AGENA.
    candidates: list[dict] = []
    if any(s in {'jira'} for s in sources):
        candidates.extend(await _scan_jira_source(db, org_id, idle_days=idle_days))
    if any(s in {'azure', 'azure_devops'} for s in sources):
        candidates.extend(await _scan_azure_source(db, org_id, idle_days=idle_days))

    # Resolve any candidate that's already been imported into task_records,
    # so the apply path can flip the local task.status when the user
    # confirms the AI verdict.
    by_external = {(c['source'], c['external_id']): c for c in candidates}
    if candidates:
        existing_tasks = (await db.execute(
            select(TaskRecord).where(
                TaskRecord.organization_id == org_id,
                TaskRecord.external_id.in_([c['external_id'] for c in candidates]),
            )
        )).scalars().all()
        for t in existing_tasks:
            key = (t.source, t.external_id)
            if key in by_external:
                by_external[key]['_local_task_id'] = t.id

    # Seed progress dict so the UI polling endpoint shows 'considered'
    # right away instead of jumping from 0 to total at the end.
    if org_id in _SCAN_PROGRESS:
        _SCAN_PROGRESS[org_id] = {
            **_SCAN_PROGRESS[org_id],
            'considered': len(candidates),
            'decided': 0,
        }

    new_decisions = 0
    for cand in candidates:
        existing = (await db.execute(
            select(TriageDecision).where(
                TriageDecision.organization_id == org_id,
                TriageDecision.source == cand['source'],
                TriageDecision.external_id == cand['external_id'],
            )
        )).scalar_one_or_none()
        # Don't churn LLM cost on rows the user hasn't actioned yet.
        if existing and existing.status == 'pending':
            continue
        # Cache: skip the LLM call entirely when the source ticket
        # hasn't moved since our last verdict. The user already saw
        # whatever recommendation we'd produce — repeating the call
        # would just burn tokens. Only re-evaluate when source updated.
        cand_updated_at = (cand.get('source_updated_at') or '').strip()
        if (
            existing is not None
            and existing.ai_verdict
            and (existing.source_updated_at or '').strip() == cand_updated_at
            and cand_updated_at
        ):
            # Even on cache hit, backfill meta we may have learned later
            # (project_key + ticket_state were added in newer migrations
            # so older rows have NULL until the user reruns scan). LLM
            # call still skipped — only the metadata gets refreshed.
            meta_changed = False
            if not existing.project_key and cand.get('project_key'):
                existing.project_key = cand['project_key']
                meta_changed = True
            if cand.get('status') and existing.ticket_state != cand['status']:
                existing.ticket_state = cand['status']
                meta_changed = True
            if cand.get('url') and existing.ticket_url != cand['url']:
                existing.ticket_url = cand['url']
                meta_changed = True
            if meta_changed:
                try:
                    await db.commit()
                except Exception:
                    pass
            continue

        try:
            stub = _make_stub_task(cand)
            verdict, confidence, reasoning = await _evaluate(
                stub, cand['idle_days'], db=db, organization_id=org_id,
            )
        except Exception:
            logger.exception(
                'Triage LLM call failed for source=%s external_id=%s',
                cand['source'], cand['external_id'],
            )
            continue

        if existing is not None:
            existing.task_id = cand.get('_local_task_id')
            existing.idle_days = cand['idle_days']
            existing.ai_verdict = verdict
            existing.ai_confidence = confidence
            existing.ai_reasoning = reasoning
            existing.ticket_title = cand['title']
            existing.ticket_url = cand.get('url')
            existing.ticket_state = cand.get('status') or None
            existing.project_key = cand.get('project_key') or None
            existing.source_updated_at = cand_updated_at or None
            existing.status = 'pending'
            existing.applied_verdict = None
            existing.applied_at = None
            existing.applied_by_user_id = None
        else:
            db.add(TriageDecision(
                organization_id=org_id,
                task_id=cand.get('_local_task_id'),
                source=cand['source'],
                external_id=cand['external_id'],
                project_key=cand.get('project_key') or None,
                ticket_title=cand['title'],
                ticket_url=cand.get('url'),
                ticket_state=cand.get('status') or None,
                source_updated_at=cand_updated_at or None,
                idle_days=cand['idle_days'],
                ai_verdict=verdict,
                ai_confidence=confidence,
                ai_reasoning=reasoning,
                status='pending',
            ))
        new_decisions += 1
        # Commit per-row so the UI sees decisions trickle in and the
        # /triage/decisions poll picks them up while the scan keeps
        # running. Without this users wait for the entire batch.
        try:
            await db.commit()
        except Exception:
            pass
        if org_id in _SCAN_PROGRESS:
            _SCAN_PROGRESS[org_id] = {
                **_SCAN_PROGRESS[org_id],
                'decided': new_decisions,
            }

    # Per-row commits already happened; flush any trailing state.
    try:
        await db.commit()
    except Exception:
        pass
    if new_decisions:
        logger.info('Triage source-side scan: org=%s decisions=%s candidates=%s',
                    org_id, new_decisions, len(candidates))

    reason = ''
    if new_decisions == 0:
        if not candidates:
            reason = 'no_stale_candidates'
        else:
            reason = 'all_candidates_have_pending_decisions'
    return {
        'new_or_refreshed': new_decisions,
        'considered': len(candidates),
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
