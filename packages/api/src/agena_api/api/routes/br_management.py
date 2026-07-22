"""BR Management — settings + business-request evaluation.

The frontend fetches the work items assigned to BR people via the
existing /tasks/{provider}/member/workitems endpoints and merges them
with the saved evaluations returned by GET /evals here. Evaluation is
synchronous in v1 (one LLM call per item).
"""
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
    BusinessRequestIntake,
    BusinessRequestSettings,
)
from agena_services.services.br_management_service import (
    INTAKE_SUBMIT_THRESHOLD,
    BRManagementService,
    _azure_headers,
    fetch_azure_items,
    resolve_azure_creds,
)

router = APIRouter(prefix='/br-management', tags=['br-management'])

VALID_STATUSES = {'pending', 'evaluated', 'accepted', 'rejected'}
# Sentinel: PUT keeps the stored PAT unchanged unless a real value is sent.
PAT_KEEP = '__keep__'


async def _azure_creds(
    db: AsyncSession, organization_id: int,
    settings: BusinessRequestSettings | None,
) -> tuple[str, str]:
    """Service-level cred resolution, mapped to a 400 for the API."""
    try:
        return await resolve_azure_creds(db, organization_id, settings)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ── Settings ─────────────────────────────────────────────────────────

class SettingsBody(BaseModel):
    br_emails: list[str] = []
    rubric: str | None = None
    epic_rule: str | None = None
    auto_eval: bool = False
    # Azure project the auto-eval poller scans (required for auto_eval to run).
    azure_project: str | None = None
    auto_eval_interval_minutes: int = 5
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
    azure_project: str | None = None
    auto_eval_interval_minutes: int = 5
    last_auto_eval_at: datetime | None = None
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
        azure_project=row.azure_project,
        auto_eval_interval_minutes=row.auto_eval_interval_minutes or 5,
        last_auto_eval_at=row.last_auto_eval_at,
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
    row.azure_project = (body.azure_project or '').strip() or None
    row.auto_eval_interval_minutes = max(1, min(1440, int(body.auto_eval_interval_minutes or 5)))
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
    evaluated_at: datetime | None = None

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

    items = await fetch_azure_items(
        base_url=base_url, pat=pat, project=project,
        emails=emails, sprint_path=sprint_path,
    )
    for item in items:
        ev = eval_map.get((item['source'], item['external_id']))
        item['eval'] = (
            EvalResponse.model_validate(ev).model_dump() if ev is not None else None
        )
    return items


# ── Conversational intake (chat) ─────────────────────────────────────

class IntakeResponse(BaseModel):
    id: int
    title: str | None = None
    status: str
    messages: list[dict[str, Any]] = []
    checklist: list[dict[str, Any]] | None = None
    pack_markdown: str | None = None
    br_type: str | None = None
    readiness_score: int | None = None
    azure_work_item_id: str | None = None
    azure_url: str | None = None
    submit_threshold: int = INTAKE_SUBMIT_THRESHOLD
    updated_at: datetime | None = None

    @classmethod
    def from_row(cls, row: BusinessRequestIntake) -> 'IntakeResponse':
        return cls(
            id=row.id,
            title=row.title,
            status=row.status,
            messages=row.messages or [],
            checklist=row.checklist,
            pack_markdown=row.pack_markdown,
            br_type=row.br_type,
            readiness_score=row.readiness_score,
            azure_work_item_id=row.azure_work_item_id,
            azure_url=row.azure_url,
            updated_at=row.updated_at,
        )


class IntakeMessageBody(BaseModel):
    text: str


class IntakeSubmitBody(BaseModel):
    project: str
    work_item_type: str = 'Product Backlog Item'
    assignee_email: str | None = None
    # Optional last-mile edits made in the submit panel.
    title: str | None = None
    pack_markdown: str | None = None


async def _get_intake(
    db: AsyncSession, tenant: CurrentTenant, intake_id: int,
) -> BusinessRequestIntake:
    row = (
        await db.execute(
            select(BusinessRequestIntake).where(
                BusinessRequestIntake.id == intake_id,
                BusinessRequestIntake.organization_id == tenant.organization_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail='intake not found')
    return row


@router.get('/intakes', response_model=list[IntakeResponse])
async def list_intakes(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[IntakeResponse]:
    rows = (
        await db.execute(
            select(BusinessRequestIntake).where(
                BusinessRequestIntake.organization_id == tenant.organization_id
            ).order_by(BusinessRequestIntake.updated_at.desc()).limit(100)
        )
    ).scalars().all()
    return [IntakeResponse.from_row(r) for r in rows]


@router.post('/intakes', response_model=IntakeResponse)
async def create_intake(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> IntakeResponse:
    row = BusinessRequestIntake(
        organization_id=tenant.organization_id,
        created_by_user_id=tenant.user_id,
        status='draft',
        messages=[],
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return IntakeResponse.from_row(row)


@router.get('/intakes/{intake_id}', response_model=IntakeResponse)
async def get_intake(
    intake_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> IntakeResponse:
    return IntakeResponse.from_row(await _get_intake(db, tenant, intake_id))


@router.post('/intakes/{intake_id}/message', response_model=IntakeResponse)
async def intake_message(
    intake_id: int,
    body: IntakeMessageBody,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> IntakeResponse:
    text = (body.text or '').strip()
    if not text:
        raise HTTPException(status_code=400, detail='text is required')
    row = await _get_intake(db, tenant, intake_id)
    if row.status == 'submitted':
        raise HTTPException(status_code=400, detail='intake already submitted')
    try:
        row = await BRManagementService(db).intake_turn(intake=row, user_text=text)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return IntakeResponse.from_row(row)


@router.post('/intakes/{intake_id}/submit', response_model=IntakeResponse)
async def intake_submit(
    intake_id: int,
    body: IntakeSubmitBody,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> IntakeResponse:
    if not (body.project or '').strip():
        raise HTTPException(status_code=400, detail='project is required')
    row = await _get_intake(db, tenant, intake_id)
    try:
        row = await BRManagementService(db).submit_intake(
            intake=row,
            project=body.project.strip(),
            work_item_type=body.work_item_type,
            assignee_email=(body.assignee_email or '').strip().lower() or None,
            title_override=(body.title or '').strip() or None,
            pack_override=(body.pack_markdown or '').strip() or None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return IntakeResponse.from_row(row)


@router.delete('/intakes/{intake_id}')
async def delete_intake(
    intake_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    row = await _get_intake(db, tenant, intake_id)
    await db.delete(row)
    await db.commit()
    return {'ok': True}


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
