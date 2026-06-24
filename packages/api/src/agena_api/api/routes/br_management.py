"""BR Management — settings + business-request evaluation.

The frontend fetches the work items assigned to BR people via the
existing /tasks/{provider}/member/workitems endpoints and merges them
with the saved evaluations returned by GET /evals here. Evaluation is
synchronous in v1 (one LLM call per item).
"""
import base64
from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_models.models.business_request import (
    BusinessRequestEval,
    BusinessRequestSettings,
)
from agena_services.services.br_management_service import BRManagementService
from agena_services.services.integration_config_service import IntegrationConfigService

router = APIRouter(prefix='/br-management', tags=['br-management'])

VALID_STATUSES = {'pending', 'evaluated', 'accepted', 'rejected'}
# Sentinel: PUT keeps the stored PAT unchanged unless a real value is sent.
PAT_KEEP = '__keep__'


def _azure_headers(pat: str) -> dict[str, str]:
    token = base64.b64encode(f':{pat}'.encode()).decode()
    return {'Authorization': f'Basic {token}', 'Content-Type': 'application/json'}


async def _azure_creds(
    db: AsyncSession, organization_id: int,
    settings: BusinessRequestSettings | None,
) -> tuple[str, str]:
    """Resolve (base_url, pat) for BR Azure calls — the BR-scoped PAT first
    (the org's main PAT often can't see the BR team's project), then the
    main Azure integration. Raises 400 when nothing is configured."""
    base_url = (settings.azure_base_url if settings else '') or ''
    pat = (settings.azure_pat if settings else '') or ''
    if not pat or not base_url:
        cfg = await IntegrationConfigService(db).get_config(organization_id, 'azure')
        if not base_url:
            base_url = (cfg.base_url if cfg else '') or ''
        if not pat:
            pat = (cfg.secret if cfg else '') or ''
    base_url = base_url.rstrip('/')
    if not base_url or not pat:
        raise HTTPException(
            status_code=400,
            detail='No Azure access — set a BR PAT in settings or configure the Azure integration.',
        )
    return base_url, pat


# Closed-ish states excluded when listing BR work without a sprint filter,
# so the queue shows live requests rather than the whole archive.
_CLOSED_STATES = ('Done', 'Closed', 'Removed', 'Resolved', 'Completed')


# ── Settings ─────────────────────────────────────────────────────────

class SettingsBody(BaseModel):
    br_emails: list[str] = []
    rubric: str | None = None
    epic_rule: str | None = None
    auto_eval: bool = False
    provider: str | None = None
    model: str | None = None
    # Send a real PAT to set it, '' to clear, or PAT_KEEP / omit to leave as-is.
    azure_pat: str = PAT_KEEP
    azure_base_url: str | None = None


class SettingsResponse(BaseModel):
    br_emails: list[str] = []
    rubric: str | None = None
    epic_rule: str | None = None
    auto_eval: bool = False
    provider: str | None = None
    model: str | None = None
    azure_pat_set: bool = False  # never leak the token itself
    azure_base_url: str | None = None


def _settings_response(row: BusinessRequestSettings | None) -> 'SettingsResponse':
    if row is None:
        return SettingsResponse()
    return SettingsResponse(
        br_emails=row.br_emails or [],
        rubric=row.rubric,
        epic_rule=row.epic_rule,
        auto_eval=row.auto_eval,
        provider=row.provider,
        model=row.model,
        azure_pat_set=bool((row.azure_pat or '').strip()),
        azure_base_url=row.azure_base_url,
    )


@router.get('/settings', response_model=SettingsResponse)
async def get_settings(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> SettingsResponse:
    row = await BRManagementService(db).get_settings(tenant.organization_id)
    return _settings_response(row)


@router.put('/settings', response_model=SettingsResponse)
async def put_settings(
    body: SettingsBody,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> SettingsResponse:
    emails = [e.strip().lower() for e in (body.br_emails or []) if e and e.strip()]
    # de-dupe, preserve order
    emails = list(dict.fromkeys(emails))

    row = (
        await db.execute(
            select(BusinessRequestSettings).where(
                BusinessRequestSettings.organization_id == tenant.organization_id
            )
        )
    ).scalar_one_or_none()

    if row is None:
        row = BusinessRequestSettings(organization_id=tenant.organization_id)
        db.add(row)

    row.br_emails = emails
    row.rubric = (body.rubric or '').strip() or None
    row.epic_rule = (body.epic_rule or '').strip() or None
    row.auto_eval = bool(body.auto_eval)
    row.provider = (body.provider or '').strip() or None
    row.model = (body.model or '').strip() or None
    row.azure_base_url = (body.azure_base_url or '').strip() or None
    # PAT: leave untouched on sentinel/None, clear on '', else set.
    if body.azure_pat != PAT_KEEP and body.azure_pat is not None:
        row.azure_pat = body.azure_pat.strip() or None

    await db.commit()
    await db.refresh(row)
    return _settings_response(row)


# ── Evaluations ──────────────────────────────────────────────────────

class EvalResponse(BaseModel):
    id: int
    source: str
    external_id: str
    assignee_email: str | None = None
    title: str | None = None
    br_type: str | None = None
    readiness_score: int | None = None
    verdict: str | None = None
    reasoning: str | None = None
    checklist: list[dict[str, Any]] | None = None
    questions: list[dict[str, Any]] | None = None
    answers: dict[str, Any] | None = None
    status: str
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class EvaluateBody(BaseModel):
    source: str
    external_id: str
    title: str = ''
    description: str = ''
    assignee_email: str | None = None
    answers: dict[str, Any] | None = None


class StatusBody(BaseModel):
    status: str


@router.get('/evals', response_model=list[EvalResponse])
async def list_evals(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[BusinessRequestEval]:
    rows = await db.execute(
        select(BusinessRequestEval).where(
            BusinessRequestEval.organization_id == tenant.organization_id
        )
    )
    return list(rows.scalars().all())


# ── Azure selectors (BR-PAT aware) ──────────────────────────────────
# The org's main /tasks/azure/* endpoints use the main PAT, which often
# can't see the BR team's project. These mirror them with the BR PAT.

@router.get('/azure/projects')
async def br_azure_projects(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    settings = await BRManagementService(db).get_settings(tenant.organization_id)
    base_url, pat = await _azure_creds(db, tenant.organization_id, settings)
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f'{base_url}/_apis/projects?api-version=7.1-preview.4',
            headers=_azure_headers(pat),
        )
        r.raise_for_status()
    return [{'id': p['id'], 'name': p['name']} for p in r.json().get('value', [])]


@router.get('/azure/teams')
async def br_azure_teams(
    project: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    settings = await BRManagementService(db).get_settings(tenant.organization_id)
    base_url, pat = await _azure_creds(db, tenant.organization_id, settings)
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f'{base_url}/_apis/projects/{project}/teams?api-version=7.1-preview.3',
            headers=_azure_headers(pat),
        )
        r.raise_for_status()
    return [{'id': t['id'], 'name': t['name']} for t in r.json().get('value', [])]


@router.get('/azure/sprints')
async def br_azure_sprints(
    project: str = Query(...),
    team: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    settings = await BRManagementService(db).get_settings(tenant.organization_id)
    base_url, pat = await _azure_creds(db, tenant.organization_id, settings)
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f'{base_url}/{project}/{team}/_apis/work/teamsettings/iterations'
            '?api-version=7.1-preview.1',
            headers=_azure_headers(pat),
        )
        r.raise_for_status()
    rows: list[dict[str, Any]] = []
    for s in r.json().get('value', []):
        attrs = s.get('attributes') or {}
        rows.append({
            'id': s.get('id'),
            'name': s.get('name'),
            'path': s.get('path', s.get('name')),
            'is_current': str(attrs.get('timeFrame') or '').lower() == 'current',
        })
    return rows


@router.get('/azure/comments')
async def br_azure_comments(
    work_item_id: str = Query(...),
    project: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    """Discussion comments for one work item, via the BR PAT (read-only)."""
    settings = await BRManagementService(db).get_settings(tenant.organization_id)
    base_url, pat = await _azure_creds(db, tenant.organization_id, settings)
    from agena_services.integrations.azure_client import AzureDevOpsClient
    client = AzureDevOpsClient()
    try:
        return await client.fetch_work_item_comments(
            cfg={'org_url': base_url, 'pat': pat}, project=project, work_item_id=work_item_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'Azure comments fetch failed: {exc}') from exc


@router.get('/items')
async def list_items(
    provider: str = Query('azure'),
    project: str = Query(''),
    sprint_path: str = Query(''),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    """Work items assigned to the BR people, merged with saved evaluations.

    A project is required. sprint_path is optional: when set, items are
    scoped to that iteration; when empty, ALL open (non-closed) work
    assigned to the BR people in the project is returned — BRs are often
    pre-sprint. Uses the BR-scoped PAT (falls back to the main Azure
    integration).
    """
    svc = BRManagementService(db)
    settings = await svc.get_settings(tenant.organization_id)
    emails = [e for e in ((settings.br_emails if settings else None) or []) if e]
    if not emails:
        return []

    eval_rows = (
        await db.execute(
            select(BusinessRequestEval).where(
                BusinessRequestEval.organization_id == tenant.organization_id
            )
        )
    ).scalars().all()
    eval_map = {(e.source, e.external_id): e for e in eval_rows}

    if provider != 'azure':
        raise HTTPException(
            status_code=400,
            detail='BR items currently support Azure only. Jira/YouTrack coming next.',
        )
    if not project:
        raise HTTPException(status_code=400, detail='project is required')

    base_url, pat = await _azure_creds(db, tenant.organization_id, settings)

    sprint_path = (sprint_path or '').strip()
    out: list[dict[str, Any]] = []
    headers = _azure_headers(pat)
    async with httpx.AsyncClient(timeout=30) as client:
        for email in emails:
            if sprint_path:
                where = (
                    f"[System.IterationPath] UNDER '{sprint_path}' "
                    f"And [System.AssignedTo] = '{email}'"
                )
                order = 'Order By [System.State] Asc'
            else:
                closed = ', '.join(f"'{s}'" for s in _CLOSED_STATES)
                where = (
                    f"[System.TeamProject] = '{project}' "
                    f"And [System.AssignedTo] = '{email}' "
                    f"And [System.State] NOT IN ({closed})"
                )
                order = 'Order By [System.ChangedDate] Desc'
            wiql_payload = {'query': f'Select [System.Id] From WorkItems Where {where} {order}'}
            try:
                r = await client.post(
                    f'{base_url}/{project}/_apis/wit/wiql?api-version=7.1-preview.2',
                    headers=headers, json=wiql_payload,
                )
                r.raise_for_status()
                refs = r.json().get('workItems', [])
                if not refs:
                    continue
                ids = ','.join(str(i['id']) for i in refs[:100])
                dr = await client.get(
                    f'{base_url}/_apis/wit/workitems?ids={ids}&fields='
                    'System.Id,System.Title,System.State,System.WorkItemType,System.Description,'
                    'System.CreatedDate,System.ChangedDate'
                    '&api-version=7.1-preview.3',
                    headers=headers,
                )
                dr.raise_for_status()
            except (httpx.HTTPError, KeyError):
                # Skip a member whose query/PAT fails; surface the rest.
                continue
            for item in dr.json().get('value', []):
                f = item.get('fields', {})
                ext_id = str(f.get('System.Id', ''))
                ev = eval_map.get(('azure', ext_id))
                out.append({
                    'source': 'azure',
                    'external_id': ext_id,
                    'title': f.get('System.Title', ''),
                    'state': f.get('System.State', ''),
                    'work_item_type': f.get('System.WorkItemType', '') or '',
                    'description': f.get('System.Description', '') or '',
                    'created_date': f.get('System.CreatedDate', '') or '',
                    'changed_date': f.get('System.ChangedDate', '') or '',
                    'assignee_email': email,
                    # Deep link to the original Azure work item (read-only;
                    # we never write back). Lets the user open the real item.
                    'url': f'{base_url}/{project}/_workitems/edit/{ext_id}',
                    'eval': EvalResponse.model_validate(ev).model_dump() if ev is not None else None,
                })
    return out


@router.post('/evaluate', response_model=EvalResponse)
async def evaluate(
    body: EvaluateBody,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> BusinessRequestEval:
    if not body.source or not body.external_id:
        raise HTTPException(status_code=400, detail='source and external_id are required')
    try:
        return await BRManagementService(db).evaluate_item(
            organization_id=tenant.organization_id,
            source=body.source.strip().lower(),
            external_id=str(body.external_id).strip(),
            title=body.title,
            description=body.description,
            assignee_email=(body.assignee_email or '').strip().lower() or None,
            answers=body.answers,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put('/evals/{eval_id}/status', response_model=EvalResponse)
async def set_status(
    eval_id: int,
    body: StatusBody,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> BusinessRequestEval:
    status = (body.status or '').strip().lower()
    if status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail='invalid status')
    row = (
        await db.execute(
            select(BusinessRequestEval).where(
                BusinessRequestEval.id == eval_id,
                BusinessRequestEval.organization_id == tenant.organization_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail='evaluation not found')
    row.status = status
    await db.commit()
    await db.refresh(row)
    return row
