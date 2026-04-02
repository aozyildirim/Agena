from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_services.services.notification_service import NotificationService

router = APIRouter(prefix='/notifications', tags=['notifications'])


class NotificationItem(BaseModel):
    id: int
    task_id: int | None
    event_type: str
    title: str
    message: str
    severity: str
    is_read: bool
    created_at: datetime


class NotificationListResponse(BaseModel):
    unread_count: int
    total: int
    page: int
    page_size: int
    items: list[NotificationItem]


class NotificationEventPayload(BaseModel):
    event_type: str
    title: str
    message: str
    severity: str = 'info'
    task_id: int | None = None


@router.get('', response_model=NotificationListResponse)
async def list_notifications(
    limit: int = Query(default=15, ge=1, le=100),
    only_unread: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    event_type: str = Query(default='all'),
    read_status: str = Query(default='all'),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> NotificationListResponse:
    service = NotificationService(db)
    rows, unread_count, total = await service.list_for_user(
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        limit=limit,
        only_unread=only_unread,
        page=page,
        page_size=page_size,
        event_type=event_type,
        read_status=read_status,
    )
    return NotificationListResponse(
        unread_count=unread_count,
        total=total,
        page=page,
        page_size=page_size,
        items=[
            NotificationItem(
                id=row.id,
                task_id=row.task_id,
                event_type=row.event_type,
                title=row.title,
                message=row.message,
                severity=row.severity,
                is_read=row.is_read,
                created_at=row.created_at,
            )
            for row in rows
        ],
    )


@router.post('/event')
async def create_notification_event(
    payload: NotificationEventPayload,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    service = NotificationService(db)
    await service.notify_event(
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        event_type=payload.event_type,
        title=payload.title,
        message=payload.message,
        severity=payload.severity,
        task_id=payload.task_id,
    )
    return {'ok': True}


@router.post('/{notification_id}/read')
async def mark_notification_read(
    notification_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    service = NotificationService(db)
    ok = await service.mark_read(
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        notification_id=notification_id,
    )
    if not ok:
        raise HTTPException(status_code=404, detail='Notification not found')
    return {'ok': True}


@router.post('/read-all')
async def mark_all_notifications_read(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, int]:
    service = NotificationService(db)
    count = await service.mark_all_read(
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
    )
    return {'updated': count}


@router.delete('')
async def clear_notifications(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, int]:
    service = NotificationService(db)
    count = await service.clear_all(
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
    )
    return {'deleted': count}
