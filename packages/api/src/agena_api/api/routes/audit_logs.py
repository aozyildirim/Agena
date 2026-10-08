"""Read side of the organization audit trail (owner / admin only)."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, require_permission
from agena_core.database import get_db_session
from agena_services.services.audit_service import AuditService

router = APIRouter(prefix='/audit-logs', tags=['audit-logs'])


class AuditLogItem(BaseModel):
    id: int
    created_at: datetime
    actor_user_id: int | None = None
    actor_email: str | None = None
    actor_role: str | None = None
    action: str
    method: str
    path: str
    route: str | None = None
    target_type: str | None = None
    target_id: str | None = None
    status_code: int
    request_id: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    workspace_id: int | None = None
    details: dict[str, Any] | None = None


class AuditLogListResponse(BaseModel):
    page: int
    page_size: int
    total: int
    items: list[AuditLogItem]


def _filters(
    action: str, actor: str | None, target_type: str, q: str | None,
    created_from: str | None, created_to: str | None,
) -> dict[str, Any]:
    from_dt = datetime.fromisoformat(created_from) if created_from else None
    # Inclusive day: a `created_to` of 2026-10-08 means through the end of that day.
    to_dt = datetime.fromisoformat(created_to) + timedelta(days=1) - timedelta(seconds=1) if created_to else None
    return dict(action=action, actor=actor, target_type=target_type, q=q, created_from=from_dt, created_to=to_dt)


@router.get('', response_model=AuditLogListResponse)
async def list_audit_logs(
    action: str = Query(default='all'),
    actor: str | None = Query(default=None),
    target_type: str = Query(default='all'),
    q: str | None = Query(default=None),
    created_from: str | None = Query(default=None),
    created_to: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    tenant: CurrentTenant = Depends(require_permission('audit:read')),
    db: AsyncSession = Depends(get_db_session),
) -> AuditLogListResponse:
    total, rows = await AuditService(db).list(
        tenant.organization_id, page=page, page_size=page_size,
        **_filters(action, actor, target_type, q, created_from, created_to),
    )
    return AuditLogListResponse(
        page=page, page_size=page_size, total=total,
        items=[AuditLogItem.model_validate(r, from_attributes=True) for r in rows],
    )


@router.get('/actions', response_model=list[str])
async def list_audit_actions(
    tenant: CurrentTenant = Depends(require_permission('audit:read')),
    db: AsyncSession = Depends(get_db_session),
) -> list[str]:
    return await AuditService(db).distinct_actions(tenant.organization_id)


@router.get('/export.csv')
async def export_audit_logs(
    action: str = Query(default='all'),
    actor: str | None = Query(default=None),
    target_type: str = Query(default='all'),
    q: str | None = Query(default=None),
    created_from: str | None = Query(default=None),
    created_to: str | None = Query(default=None),
    tenant: CurrentTenant = Depends(require_permission('audit:read')),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    body = await AuditService(db).export_csv(
        tenant.organization_id, **_filters(action, actor, target_type, q, created_from, created_to),
    )
    stamp = datetime.utcnow().strftime('%Y%m%d-%H%M')
    return Response(
        content=body,
        media_type='text/csv; charset=utf-8',
        headers={
            'Content-Disposition': f'attachment; filename="audit-log-{stamp}.csv"',
            'X-Content-Type-Options': 'nosniff',
        },
    )
