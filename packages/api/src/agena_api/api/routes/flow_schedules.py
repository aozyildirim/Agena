"""Cron schedules for a user's flows."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_services.services.flow_cron import CronError
from agena_services.services.flow_schedule_service import FlowScheduleService, preview

router = APIRouter(prefix='/flows/schedules', tags=['flow-schedules'])


class ScheduleIn(BaseModel):
    flow_id: str = Field(min_length=1, max_length=64)
    flow_name: str = Field(default='', max_length=255)
    cron: str = Field(min_length=1, max_length=120)
    timezone: str = Field(default='UTC', max_length=64)
    enabled: bool = True
    task: dict[str, Any] | None = None


class ScheduleUpdate(BaseModel):
    cron: str | None = Field(default=None, max_length=120)
    timezone: str | None = Field(default=None, max_length=64)
    enabled: bool | None = None
    task: dict[str, Any] | None = None
    flow_name: str | None = Field(default=None, max_length=255)


class ScheduleOut(BaseModel):
    id: int
    flow_id: str
    flow_name: str
    cron: str
    timezone: str
    enabled: bool
    task_json: dict[str, Any] | None = None
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None
    last_run_id: int | None = None
    last_status: str | None = None
    last_error: str | None = None
    run_count: int
    created_at: datetime


class PreviewOut(BaseModel):
    cron: str
    timezone: str
    next_runs: list[datetime]


def _out(row) -> ScheduleOut:
    return ScheduleOut.model_validate(row, from_attributes=True)


@router.get('/preview', response_model=PreviewOut)
async def preview_schedule(
    cron: str = Query(min_length=1, max_length=120),
    timezone: str = Query(default='UTC', max_length=64),
    tenant: CurrentTenant = Depends(get_current_tenant),
) -> PreviewOut:
    try:
        return PreviewOut(cron=cron, timezone=timezone, next_runs=preview(cron, timezone))
    except (CronError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get('', response_model=list[ScheduleOut])
async def list_schedules(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[ScheduleOut]:
    rows = await FlowScheduleService(db).list_for_user(tenant.organization_id, tenant.user_id)
    return [_out(r) for r in rows]


@router.post('', response_model=ScheduleOut, status_code=201)
async def create_schedule(
    payload: ScheduleIn,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> ScheduleOut:
    try:
        row = await FlowScheduleService(db).create(
            organization_id=tenant.organization_id, user_id=tenant.user_id,
            flow_id=payload.flow_id, flow_name=payload.flow_name, cron=payload.cron,
            timezone_name=payload.timezone, enabled=payload.enabled, task=payload.task,
        )
    except (CronError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _out(row)


@router.put('/{schedule_id}', response_model=ScheduleOut)
async def update_schedule(
    schedule_id: int,
    payload: ScheduleUpdate,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> ScheduleOut:
    svc = FlowScheduleService(db)
    row = await svc.get_owned(tenant.organization_id, tenant.user_id, schedule_id)
    if row is None:
        raise HTTPException(status_code=404, detail='Schedule not found')
    try:
        row = await svc.update(row, cron=payload.cron, timezone_name=payload.timezone, enabled=payload.enabled,
                               **({'task': payload.task} if payload.task is not None else {}),
                               **({'flow_name': payload.flow_name} if payload.flow_name else {}))
    except (CronError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _out(row)


@router.delete('/{schedule_id}')
async def delete_schedule(
    schedule_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    svc = FlowScheduleService(db)
    row = await svc.get_owned(tenant.organization_id, tenant.user_id, schedule_id)
    if row is None:
        raise HTTPException(status_code=404, detail='Schedule not found')
    await svc.delete(row)
    return {'deleted': True}


@router.post('/{schedule_id}/run', response_model=ScheduleOut)
async def run_schedule_now(
    schedule_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> ScheduleOut:
    """Run the flow immediately, outside the schedule (does not move next_run_at)."""
    svc = FlowScheduleService(db)
    row = await svc.get_owned(tenant.organization_id, tenant.user_id, schedule_id)
    if row is None:
        raise HTTPException(status_code=404, detail='Schedule not found')
    await svc.execute(row)
    await db.refresh(row)
    return _out(row)
