"""/triage — stale Jira / Azure ticket auto-triage."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_models.models.triage_decision import TriageDecision
from agena_services.services import triage_service

router = APIRouter(prefix='/triage', tags=['triage'])


class DecisionResponse(BaseModel):
    id: int
    task_id: int | None = None  # nullable for source-side decisions (no local TaskRecord)
    source: str
    external_id: str
    project_key: str | None = None
    ticket_state: str | None = None
    ticket_title: str | None = None
    ticket_url: str | None = None
    idle_days: int
    ai_verdict: str | None = None
    ai_confidence: int
    ai_reasoning: str | None = None
    status: str
    applied_verdict: str | None = None
    applied_at: datetime | None = None
    created_at: datetime


class ApplyRequest(BaseModel):
    verdict: str  # close | snooze | keep


class ApplyAllRequest(BaseModel):
    decision_ids: list[int]


@router.get('/decisions', response_model=list[DecisionResponse])
async def list_decisions(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
    status: str = 'pending',
    source: str | None = None,
    project: str | None = None,
    limit: int = 100,
) -> list[DecisionResponse]:
    stmt = (
        select(TriageDecision)
        .where(TriageDecision.organization_id == tenant.organization_id)
        .where(TriageDecision.status == status)
    )
    if source and source not in ('all', ''):
        if source.lower() in ('azure', 'azure_devops'):
            stmt = stmt.where(TriageDecision.source.in_(['azure', 'azure_devops']))
        else:
            stmt = stmt.where(TriageDecision.source == source.lower())
    if project and project not in ('all', ''):
        stmt = stmt.where(TriageDecision.project_key == project)
    stmt = stmt.order_by(desc(TriageDecision.idle_days)).limit(min(limit, 500))
    rows = (await db.execute(stmt)).scalars().all()
    # Defensive filter: drop rows whose source ticket is now in a
    # dead state (Cancelled / Rejected / Won't Fix / etc.) so older
    # decisions left over from before the scan-time filter don't keep
    # showing up. Source state shifts after the row was created get
    # caught here too — the next scan will mark them resolved.
    DEAD = {
        'done', 'closed', 'removed', 'resolved',
        'cancelled', 'canceled', 'rejected', 'withdrawn',
        'abandoned', 'wont fix', "won't fix", 'wontfix', 'duplicate',
    }
    rows = [
        r for r in rows
        if (r.ticket_state or '').strip().lower() not in DEAD
    ]
    return [DecisionResponse.model_validate(r, from_attributes=True) for r in rows]


@router.get('/projects')
async def list_projects(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    """Distinct (source, project_key) pairs across the org's triage
    decisions, with a count. Drives the project dropdown / chip group
    on /dashboard/triage so the user can scope the queue to one
    Jira project key (SCRUM) or one Azure project (EcomBackend)."""
    from sqlalchemy import func
    rows = (await db.execute(
        select(
            TriageDecision.source,
            TriageDecision.project_key,
            func.count(TriageDecision.id).label('n'),
        )
        .where(TriageDecision.organization_id == tenant.organization_id)
        .where(TriageDecision.project_key.is_not(None))
        .group_by(TriageDecision.source, TriageDecision.project_key)
        .order_by(TriageDecision.source, TriageDecision.project_key)
    )).all()
    return [
        {'source': r[0], 'project_key': r[1], 'count': int(r[2] or 0)}
        for r in rows
    ]


@router.post('/scan')
async def scan_now(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Kick off the source-side scan as a background task and return
    immediately so the UI doesn't lock up while we walk every stale
    Jira / Azure ticket through the LLM. The scan's progress is
    visible to the user as new TriageDecision rows land — the page
    already polls /triage/decisions, so they appear gradually.

    Returns:
      status='running'     — a fresh background task was scheduled
      status='already_running' — a previous scan for this org is still
                                 in flight; the second click is a no-op
      status='disabled' / 'no_sources' — same diagnostic semantics as
                                         before, surfaced before we
                                         spawn anything.
    """
    return await triage_service.start_scan_for_org(db, tenant.organization_id)


@router.get('/scan/status')
async def scan_status(
    tenant: CurrentTenant = Depends(get_current_tenant),
) -> dict[str, Any]:
    """Polled by the UI to show 'Taranıyor…' progress while the
    background scan is in flight. Returns idle/running + a rough
    counter so we can render 'Taranıyor… 47 değerlendirildi'."""
    return triage_service.get_scan_progress(tenant.organization_id)


@router.post('/decisions/{decision_id}/apply')
async def apply(
    decision_id: int,
    body: ApplyRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    try:
        d = await triage_service.apply_decision(
            db, decision_id,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            verdict=body.verdict,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {'ok': True, 'applied_verdict': d.applied_verdict}


@router.post('/decisions/{decision_id}/skip')
async def skip(
    decision_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    try:
        await triage_service.skip_decision(
            db, decision_id,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {'ok': True}


@router.post('/apply-all-ai-suggestions')
async def apply_all_ai(
    body: ApplyAllRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Apply each decision's AI-recommended verdict in one shot. Used by
    the "Hepsini onayla" button in the Triage UI."""
    rows = (
        await db.execute(
            select(TriageDecision).where(
                TriageDecision.organization_id == tenant.organization_id,
                TriageDecision.id.in_(body.decision_ids),
                TriageDecision.status == 'pending',
            )
        )
    ).scalars().all()
    applied = 0
    for d in rows:
        try:
            await triage_service.apply_decision(
                db, d.id,
                organization_id=tenant.organization_id,
                user_id=tenant.user_id,
                verdict=d.ai_verdict or 'keep',
            )
            applied += 1
        except Exception:
            pass
    return {'applied': applied, 'requested': len(body.decision_ids)}
