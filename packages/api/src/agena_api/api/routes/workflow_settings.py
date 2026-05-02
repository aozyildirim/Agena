"""/workflow-settings — per-org config for Triage and Review Backlog."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_models.models.org_workflow_settings import OrgWorkflowSettings

router = APIRouter(prefix='/workflow-settings', tags=['workflow-settings'])


class WorkflowSettingsResponse(BaseModel):
    triage_enabled: bool
    triage_idle_days: int
    triage_schedule_cron: str
    triage_sources: str
    backlog_enabled: bool
    backlog_warn_hours: int
    backlog_critical_hours: int
    backlog_nudge_interval_hours: int
    backlog_channel: str
    backlog_exempt_repos: str | None = None
    nudge_comment_language: str = 'en'
    nudge_use_ai: bool = False
    updated_at: datetime | None = None


class WorkflowSettingsUpdate(BaseModel):
    triage_enabled: bool | None = None
    triage_idle_days: int | None = Field(default=None, ge=1, le=365)
    triage_schedule_cron: str | None = None
    triage_sources: str | None = None
    backlog_enabled: bool | None = None
    backlog_warn_hours: int | None = Field(default=None, ge=1, le=720)
    backlog_critical_hours: int | None = Field(default=None, ge=1, le=720)
    backlog_nudge_interval_hours: int | None = Field(default=None, ge=1, le=168)
    backlog_channel: str | None = None
    backlog_exempt_repos: str | None = None
    nudge_comment_language: str | None = None
    nudge_use_ai: bool | None = None


async def _get_or_create(db: AsyncSession, org_id: int) -> OrgWorkflowSettings:
    row = (
        await db.execute(select(OrgWorkflowSettings).where(OrgWorkflowSettings.organization_id == org_id))
    ).scalar_one_or_none()
    if row is None:
        row = OrgWorkflowSettings(organization_id=org_id)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


@router.get('', response_model=WorkflowSettingsResponse)
async def get_settings(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> WorkflowSettingsResponse:
    row = await _get_or_create(db, tenant.organization_id)
    return WorkflowSettingsResponse.model_validate(row, from_attributes=True)


@router.put('', response_model=WorkflowSettingsResponse)
async def update_settings(
    body: WorkflowSettingsUpdate,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> WorkflowSettingsResponse:
    row = await _get_or_create(db, tenant.organization_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    if row.backlog_critical_hours <= row.backlog_warn_hours:
        # keep critical strictly above warn, otherwise the severity
        # ladder collapses
        row.backlog_critical_hours = row.backlog_warn_hours + 1
    await db.commit()
    await db.refresh(row)
    return WorkflowSettingsResponse.model_validate(row, from_attributes=True)
