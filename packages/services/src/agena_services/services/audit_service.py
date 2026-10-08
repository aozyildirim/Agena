"""Organization audit trail — who did what, on which resource, from where.

Rows are written by ``AuditMiddleware`` for every state-changing request a
member makes, and explicitly by the auth routes for login/signup. Only
request metadata is stored, never bodies.
"""

from __future__ import annotations

import csv
import io
import logging
from datetime import datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_core.database import SessionLocal
from agena_models.models.audit_log import AuditLog

logger = logging.getLogger(__name__)

EXPORT_MAX_ROWS = 10_000
EXPORT_COLUMNS = (
    'id', 'created_at', 'actor_email', 'actor_role', 'action', 'method', 'path',
    'target_type', 'target_id', 'status_code', 'ip_address', 'request_id', 'workspace_id',
)


class AuditService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def record(
        self,
        *,
        organization_id: int,
        action: str,
        actor_user_id: int | None = None,
        actor_email: str | None = None,
        actor_role: str | None = None,
        workspace_id: int | None = None,
        method: str = '',
        path: str = '',
        route: str | None = None,
        target_type: str | None = None,
        target_id: str | None = None,
        status_code: int = 0,
        request_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> AuditLog:
        row = AuditLog(
            organization_id=organization_id,
            workspace_id=workspace_id,
            actor_user_id=actor_user_id,
            actor_email=(actor_email or '')[:255] or None,
            actor_role=(actor_role or '')[:16] or None,
            action=action[:96],
            method=(method or '')[:8],
            path=(path or '')[:512],
            route=(route or '')[:255] or None,
            target_type=(target_type or '')[:64] or None,
            target_id=(target_id or '')[:64] or None,
            status_code=int(status_code or 0),
            request_id=(request_id or '')[:64] or None,
            ip_address=(ip_address or '')[:64] or None,
            user_agent=(user_agent or '')[:512] or None,
            details=details or None,
        )
        self.db.add(row)
        await self.db.commit()
        # Security-relevant rows fan out to owners/admins in the background;
        # imported here to keep audit_service importable without the
        # notification stack.
        from agena_services.services.security_alert_service import schedule_security_alert

        schedule_security_alert(row.id)
        return row

    def _filtered(
        self,
        organization_id: int,
        *,
        action: str | None = None,
        actor: str | None = None,
        target_type: str | None = None,
        q: str | None = None,
        created_from: datetime | None = None,
        created_to: datetime | None = None,
    ):
        stmt = select(AuditLog).where(AuditLog.organization_id == organization_id)
        if action and action != 'all':
            stmt = stmt.where(AuditLog.action == action)
        if actor:
            stmt = stmt.where(AuditLog.actor_email.ilike(f'%{actor.strip()}%'))
        if target_type and target_type != 'all':
            stmt = stmt.where(AuditLog.target_type == target_type)
        if q:
            like = f'%{q.strip()}%'
            stmt = stmt.where(or_(
                AuditLog.path.ilike(like),
                AuditLog.action.ilike(like),
                AuditLog.target_id.ilike(like),
                AuditLog.ip_address.ilike(like),
                AuditLog.request_id == q.strip(),
            ))
        if created_from:
            stmt = stmt.where(AuditLog.created_at >= created_from)
        if created_to:
            stmt = stmt.where(AuditLog.created_at <= created_to)
        return stmt

    async def list(
        self, organization_id: int, *, page: int = 1, page_size: int = 50, **filters: Any,
    ) -> tuple[int, list[AuditLog]]:
        stmt = self._filtered(organization_id, **filters)
        total = (await self.db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
        rows = (await self.db.execute(
            stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )).scalars().all()
        return int(total or 0), list(rows)

    async def distinct_actions(self, organization_id: int) -> list[str]:
        rows = await self.db.execute(
            select(AuditLog.action)
            .where(AuditLog.organization_id == organization_id)
            .distinct()
            .order_by(AuditLog.action)
        )
        return [r[0] for r in rows.all()]

    async def export_csv(self, organization_id: int, **filters: Any) -> str:
        stmt = (
            self._filtered(organization_id, **filters)
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .limit(EXPORT_MAX_ROWS)
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(EXPORT_COLUMNS)
        for r in rows:
            writer.writerow([
                r.id, r.created_at.isoformat() if r.created_at else '', r.actor_email or '', r.actor_role or '',
                r.action, r.method, r.path, r.target_type or '', r.target_id or '', r.status_code,
                r.ip_address or '', r.request_id or '', r.workspace_id if r.workspace_id is not None else '',
            ])
        return buf.getvalue()


async def record_request(**fields: Any) -> None:
    """Write one row on a session of its own. Called by the middleware after
    the response exists, so nothing that goes wrong here can affect it."""
    try:
        async with SessionLocal() as session:
            await AuditService(session).record(**fields)
    except Exception:
        logger.warning('audit: failed to record %s %s', fields.get('method'), fields.get('path'), exc_info=True)
