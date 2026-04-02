from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_services.services.ai_usage_event_service import AIUsageEventService

router = APIRouter(prefix='/usage-events', tags=['usage-events'])


class UsageEventItem(BaseModel):
    id: int
    operation_type: str
    provider: str
    model: str | None = None
    status: str
    task_id: int | None = None
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float
    duration_ms: int | None = None
    cache_hit: bool
    local_repo_path: str | None = None
    profile_version: int | None = None
    error_message: str | None = None
    created_at: datetime


class UsageSummary(BaseModel):
    count: int
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float
    avg_duration_ms: int


class UsageEventListResponse(BaseModel):
    page: int
    page_size: int
    total: int
    summary: UsageSummary
    items: list[UsageEventItem]


@router.get('', response_model=UsageEventListResponse)
async def list_usage_events(
    operation_type: str = Query(default='all'),
    provider: str = Query(default='all'),
    status: str = Query(default='all'),
    task_id: int | None = Query(default=None),
    created_from: str | None = Query(default=None),
    created_to: str | None = Query(default=None),
    mine_only: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> UsageEventListResponse:
    from_dt: datetime | None = None
    to_dt: datetime | None = None
    if created_from:
        from_dt = datetime.fromisoformat(created_from)
    if created_to:
        to_dt = datetime.fromisoformat(created_to) + timedelta(days=1) - timedelta(seconds=1)

    service = AIUsageEventService(db)
    user_id = tenant.user_id if mine_only else None
    items, total = await service.list_events(
        organization_id=tenant.organization_id,
        user_id=user_id,
        operation_type=operation_type,
        provider=provider,
        task_id=task_id,
        status=status,
        created_from=from_dt,
        created_to=to_dt,
        page=page,
        page_size=page_size,
    )
    summary_raw = await service.summary(
        organization_id=tenant.organization_id,
        user_id=user_id,
        operation_type=operation_type,
        provider=provider,
        task_id=task_id,
        status=status,
        created_from=from_dt,
        created_to=to_dt,
    )
    return UsageEventListResponse(
        page=page,
        page_size=page_size,
        total=total,
        summary=UsageSummary(**summary_raw),
        items=[
            UsageEventItem(
                id=e.id,
                operation_type=e.operation_type,
                provider=e.provider,
                model=e.model,
                status=e.status,
                task_id=e.task_id,
                prompt_tokens=e.prompt_tokens,
                completion_tokens=e.completion_tokens,
                total_tokens=e.total_tokens,
                cost_usd=e.cost_usd,
                duration_ms=e.duration_ms,
                cache_hit=e.cache_hit,
                local_repo_path=e.local_repo_path,
                profile_version=e.profile_version,
                error_message=e.error_message,
                created_at=e.created_at,
            )
            for e in items
        ],
    )

