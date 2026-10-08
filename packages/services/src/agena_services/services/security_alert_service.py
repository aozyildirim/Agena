"""Turn security-relevant audit rows into notifications for the people who
should know: the organization's owners and admins, plus the account owner
for events about their own account.

Runs as a background task on its own session (see schedule_security_alert)
so that sending e-mail never delays the request that was audited.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_core.database import SessionLocal
from agena_models.models.audit_log import AuditLog
from agena_models.models.organization_member import OrganizationMember
from agena_services.services.email_templates import generic_notification_email
from agena_services.services.notification_service import NotificationService
from agena_services.services.security_events import (
    NEW_LOGIN_WINDOW_DAYS,
    SECURITY_ALERT_EVENT,
    Alert,
    describe,
    new_login_alert,
)

logger = logging.getLogger(__name__)

AUDIT_LOG_URL = 'https://agena.dev/dashboard/audit-log'


class SecurityAlertService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def handle(self, row: AuditLog) -> int:
        """Notify for this audit row if it warrants it; returns recipients notified."""
        alert = await self._alert_for(row)
        if alert is None:
            return 0
        recipients = await self._recipients(row.organization_id)
        if alert.account_scoped and row.actor_user_id is not None:
            recipients.add(row.actor_user_id)

        subject, html = generic_notification_email(
            title=alert.title, message=alert.message, severity=alert.severity,
            action_url=AUDIT_LOG_URL, action_label='Open audit log',
        )
        notifier = NotificationService(self.db)
        sent = 0
        for user_id in sorted(recipients):
            try:
                await notifier.notify_event(
                    organization_id=row.organization_id,
                    user_id=user_id,
                    event_type=SECURITY_ALERT_EVENT,
                    title=alert.title,
                    message=alert.message,
                    severity=alert.severity,
                    payload={'audit_log_id': row.id, 'action': row.action, 'ip': row.ip_address, 'href': '/dashboard/audit-log'},
                    email_subject=f'[AGENA security] {alert.title}',
                    email_html=html,
                )
                sent += 1
            except Exception:
                logger.warning('security alert: notify failed for user %s', user_id, exc_info=True)
        return sent

    async def _alert_for(self, row: AuditLog) -> Alert | None:
        if row.action == 'auth.login':
            if 200 <= int(row.status_code or 0) < 300 and await self._is_new_address(row):
                return new_login_alert(row.actor_email, row.ip_address)
            return None
        return describe(row.action, row.status_code, row.actor_email, row.ip_address, row.details)

    async def _is_new_address(self, row: AuditLog) -> bool:
        """True when this user has signed in recently but never from this IP.

        A user with no earlier sign-ins on record is a baseline, not an
        alert — otherwise every account would fire once right after the
        audit trail was introduced.
        """
        if not row.ip_address or row.actor_user_id is None:
            return False
        since = datetime.utcnow() - timedelta(days=NEW_LOGIN_WINDOW_DAYS)
        base = select(func.count()).select_from(AuditLog).where(
            AuditLog.actor_user_id == row.actor_user_id,
            AuditLog.action == 'auth.login',
            AuditLog.id < row.id,
            AuditLog.created_at >= since,
        )
        earlier = (await self.db.execute(base)).scalar_one()
        if not earlier:
            return False
        same_ip = (await self.db.execute(base.where(AuditLog.ip_address == row.ip_address))).scalar_one()
        return same_ip == 0

    async def _recipients(self, organization_id: int) -> set[int]:
        rows = await self.db.execute(
            select(OrganizationMember.user_id).where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.role.in_(('owner', 'admin')),
            )
        )
        return {int(r[0]) for r in rows.all()}


# Strong references so the event loop cannot garbage-collect in-flight alerts.
_PENDING: set[asyncio.Task] = set()


def schedule_security_alert(audit_log_id: int) -> None:
    """Fire-and-forget: evaluate and send alerts for an audit row."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(_run(audit_log_id))
    _PENDING.add(task)
    task.add_done_callback(_PENDING.discard)


async def _run(audit_log_id: int) -> None:
    try:
        async with SessionLocal() as session:
            row = await session.get(AuditLog, audit_log_id)
            if row is not None:
                await SecurityAlertService(session).handle(row)
    except Exception:
        logger.warning('security alert: failed for audit row %s', audit_log_id, exc_info=True)
