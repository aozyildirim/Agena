"""Flow run endpoints."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.dependencies import CurrentTenant, get_current_tenant
from core.database import get_db_session
from models.flow_run import FlowRun, FlowRunStep
from models.user_preference import UserPreference
from services.flow_executor import run_flow

router = APIRouter(prefix='/flows', tags=['flows'])


class RunFlowRequest(BaseModel):
    flow_id: str
    task: dict[str, Any]  # {id, title, state, description, ...}


class StepOut(BaseModel):
    id: int
    node_id: str
    node_type: str
    node_label: str | None
    status: str
    output: Any
    error_msg: str | None
    started_at: str | None
    finished_at: str | None


class RunOut(BaseModel):
    id: int
    flow_id: str
    flow_name: str
    task_id: str | None
    task_title: str | None
    status: str
    started_at: str
    finished_at: str | None
    steps: list[StepOut]


def _step_out(s: FlowRunStep) -> StepOut:
    output = None
    if s.output_json:
        try:
            output = json.loads(s.output_json)
        except Exception:
            output = s.output_json
    return StepOut(
        id=s.id,
        node_id=s.node_id,
        node_type=s.node_type,
        node_label=s.node_label,
        status=s.status,
        output=output,
        error_msg=s.error_msg,
        started_at=s.started_at.isoformat() if s.started_at else None,
        finished_at=s.finished_at.isoformat() if s.finished_at else None,
    )


def _run_out(r: FlowRun) -> RunOut:
    return RunOut(
        id=r.id,
        flow_id=r.flow_id,
        flow_name=r.flow_name,
        task_id=r.task_id,
        task_title=r.task_title,
        status=r.status,
        started_at=r.started_at.isoformat(),
        finished_at=r.finished_at.isoformat() if r.finished_at else None,
        steps=[_step_out(s) for s in (r.steps or [])],
    )


@router.post('/run', response_model=RunOut)
async def run_flow_endpoint(
    body: RunFlowRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> RunOut:
    """Flow'u çalıştır."""
    # Kullanıcının kayıtlı flow'larından bul
    result = await db.execute(
        select(UserPreference).where(UserPreference.user_id == tenant.user_id)
    )
    pref = result.scalar_one_or_none()
    if not pref or not pref.flows_json:
        raise HTTPException(status_code=404, detail='Flow bulunamadı')

    flows: list[dict[str, Any]] = json.loads(pref.flows_json)
    flow = next((f for f in flows if f['id'] == body.flow_id), None)
    if not flow:
        raise HTTPException(status_code=404, detail=f'Flow {body.flow_id} bulunamadı')

    flow_run = await run_flow(
        flow=flow,
        task=body.task,
        user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        db=db,
    )
    return _run_out(flow_run)


@router.get('/runs', response_model=list[RunOut])
async def list_runs(
    limit: int = 20,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[RunOut]:
    """Son flow run'larını listele."""
    result = await db.execute(
        select(FlowRun)
        .where(FlowRun.user_id == tenant.user_id)
        .options(selectinload(FlowRun.steps))
        .order_by(FlowRun.started_at.desc())
        .limit(limit)
    )
    runs = result.scalars().all()
    return [_run_out(r) for r in runs]


@router.get('/runs/{run_id}', response_model=RunOut)
async def get_run(
    run_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> RunOut:
    result = await db.execute(
        select(FlowRun)
        .where(FlowRun.id == run_id, FlowRun.user_id == tenant.user_id)
        .options(selectinload(FlowRun.steps))
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail='Run bulunamadı')
    return _run_out(run)
