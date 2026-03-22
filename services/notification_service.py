from __future__ import annotations

import json
import logging
import smtplib
from datetime import datetime, timezone
from email.mime.text import MIMEText
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.settings import get_settings
from models.notification_record import NotificationRecord
from models.user import User
from models.user_preference import UserPreference

logger = logging.getLogger(__name__)


DEFAULT_EVENT_PREFS: dict[str, dict[str, bool]] = {
    'task_queued': {'in_app': True, 'email': False, 'web_push': False},
    'task_running': {'in_app': True, 'email': False, 'web_push': False},
    'task_completed': {'in_app': True, 'email': True, 'web_push': True},
    'task_failed': {'in_app': True, 'email': True, 'web_push': True},
    'pr_created': {'in_app': True, 'email': False, 'web_push': True},
    'pr_failed': {'in_app': True, 'email': True, 'web_push': True},
    'approval_required': {'in_app': True, 'email': False, 'web_push': True},
    'approval_decision': {'in_app': True, 'email': False, 'web_push': True},
    'integration_auth_expired': {'in_app': True, 'email': True, 'web_push': True},
    'queue_backlog_warning': {'in_app': True, 'email': False, 'web_push': True},
}


class NotificationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.settings = get_settings()

    async def notify_task_result(
        self,
        *,
        organization_id: int,
        user_id: int,
        task_id: int,
        task_title: str,
        status: str,
        pr_url: str | None = None,
        failure_reason: str | None = None,
    ) -> bool:
        is_completed = status == 'completed'
        event_type = 'task_completed' if is_completed else 'task_failed'
        title = f"Task #{task_id} {'completed' if is_completed else 'failed'}"
        message = task_title if is_completed else (failure_reason or task_title)
        subject = f"[Tiqr] Task #{task_id} {status.upper()}: {task_title}"
        if is_completed:
            email_body = (
                f"Task completed successfully.\n\n"
                f"Task: #{task_id} - {task_title}\n"
                f"Status: {status}\n"
                f"PR: {pr_url or '-'}\n"
            )
        else:
            email_body = (
                f"Task finished with status: {status}\n\n"
                f"Task: #{task_id} - {task_title}\n"
                f"Reason: {failure_reason or '-'}\n"
                f"PR: {pr_url or '-'}\n"
            )
        return await self.notify_event(
            organization_id=organization_id,
            user_id=user_id,
            event_type=event_type,
            title=title,
            message=message,
            severity='success' if is_completed else 'error',
            task_id=task_id,
            payload={'status': status, 'pr_url': pr_url, 'failure_reason': failure_reason},
            email_subject=subject,
            email_body=email_body,
        )

    async def notify_event(
        self,
        *,
        organization_id: int,
        user_id: int,
        event_type: str,
        title: str,
        message: str,
        severity: str = 'info',
        task_id: int | None = None,
        payload: dict[str, Any] | None = None,
        email_subject: str | None = None,
        email_body: str | None = None,
    ) -> bool:
        settings = await self._resolve_profile_settings(user_id)
        should_store_in_app = self._is_enabled(settings, event_type, 'in_app')
        should_email = self._is_enabled(settings, event_type, 'email')

        if should_store_in_app:
            self.db.add(
                NotificationRecord(
                    organization_id=organization_id,
                    user_id=user_id,
                    task_id=task_id,
                    event_type=event_type,
                    title=title,
                    message=message,
                    severity=severity,
                    payload_json=json.dumps(payload or {}, ensure_ascii=False) if payload is not None else None,
                )
            )
            await self.db.commit()

        if not should_email:
            return False

        recipient = await self._resolve_recipient(user_id)
        if not recipient:
            return False
        subject = email_subject or f"[Tiqr] {title}"
        body = email_body or f"{title}\n\n{message}"
        return self._send_email(recipient, subject, body)

    async def list_for_user(
        self,
        *,
        organization_id: int,
        user_id: int,
        limit: int = 20,
        only_unread: bool = False,
        page: int = 1,
        page_size: int = 20,
        event_type: str | None = None,
        read_status: str = 'all',
    ) -> tuple[list[NotificationRecord], int, int]:
        page = max(1, int(page))
        page_size = max(1, min(int(page_size), 100))
        base_filters = [
            NotificationRecord.organization_id == organization_id,
            NotificationRecord.user_id == user_id,
        ]
        if only_unread or read_status == 'unread':
            base_filters.append(NotificationRecord.is_read.is_(False))
        elif read_status == 'read':
            base_filters.append(NotificationRecord.is_read.is_(True))
        if event_type and event_type != 'all':
            base_filters.append(NotificationRecord.event_type == event_type)

        total_stmt = select(func.count(NotificationRecord.id)).where(*base_filters)
        total = int((await self.db.execute(total_stmt)).scalar_one() or 0)

        # legacy callers that only pass limit still work (page=1)
        effective_limit = max(1, min(limit, 100)) if page == 1 and page_size == 20 and limit != 20 else page_size
        stmt = (
            select(NotificationRecord)
            .where(*base_filters)
            .order_by(NotificationRecord.created_at.desc())
            .offset((page - 1) * effective_limit)
            .limit(effective_limit)
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        unread_stmt = select(func.count(NotificationRecord.id)).where(
            NotificationRecord.organization_id == organization_id,
            NotificationRecord.user_id == user_id,
            NotificationRecord.is_read.is_(False),
        )
        unread_count = int((await self.db.execute(unread_stmt)).scalar_one() or 0)
        return rows, unread_count, total

    async def mark_read(self, *, organization_id: int, user_id: int, notification_id: int) -> bool:
        row = await self.db.get(NotificationRecord, notification_id)
        if row is None:
            return False
        if row.organization_id != organization_id or row.user_id != user_id:
            return False
        if not row.is_read:
            row.is_read = True
            row.read_at = datetime.now(timezone.utc).replace(tzinfo=None)
            await self.db.commit()
        return True

    async def mark_all_read(self, *, organization_id: int, user_id: int) -> int:
        stmt = select(NotificationRecord).where(
            NotificationRecord.organization_id == organization_id,
            NotificationRecord.user_id == user_id,
            NotificationRecord.is_read.is_(False),
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        if not rows:
            return 0
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        for row in rows:
            row.is_read = True
            row.read_at = now
        await self.db.commit()
        return len(rows)

    async def clear_all(self, *, organization_id: int, user_id: int) -> int:
        stmt = select(NotificationRecord).where(
            NotificationRecord.organization_id == organization_id,
            NotificationRecord.user_id == user_id,
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        if not rows:
            return 0
        for row in rows:
            await self.db.delete(row)
        await self.db.commit()
        return len(rows)

    async def _resolve_recipient(self, user_id: int) -> str | None:
        user_result = await self.db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if user is None or not user.email:
            return None
        return user.email

    async def _resolve_profile_settings(self, user_id: int) -> dict[str, Any]:
        pref_result = await self.db.execute(select(UserPreference).where(UserPreference.user_id == user_id))
        pref = pref_result.scalar_one_or_none()
        if pref is None or not pref.profile_settings_json:
            return {}
        try:
            data = json.loads(pref.profile_settings_json)
            if isinstance(data, dict):
                return data
        except Exception:
            pass
        return {}

    def _is_enabled(self, settings: dict[str, Any], event_type: str, channel: str) -> bool:
        if channel == 'email' and settings.get('email_notifications') is False:
            return False
        if channel == 'web_push' and settings.get('web_push_notifications') is False:
            return False

        custom = settings.get('notification_preferences')
        if isinstance(custom, dict):
            per_event = custom.get(event_type)
            if isinstance(per_event, dict):
                val = per_event.get(channel)
                if isinstance(val, bool):
                    return val
        return DEFAULT_EVENT_PREFS.get(event_type, {'in_app': True, 'email': False, 'web_push': False}).get(channel, False)

    def _send_email(self, to_email: str, subject: str, body: str) -> bool:
        if not self.settings.smtp_host:
            logger.info('SMTP_HOST not configured, skipping email notification')
            return False

        msg = MIMEText(body, 'plain', 'utf-8')
        msg['Subject'] = subject
        msg['From'] = f"{self.settings.smtp_from_name} <{self.settings.smtp_from_email}>"
        msg['To'] = to_email

        try:
            if self.settings.smtp_use_ssl:
                server = smtplib.SMTP_SSL(self.settings.smtp_host, self.settings.smtp_port, timeout=10)
            else:
                server = smtplib.SMTP(self.settings.smtp_host, self.settings.smtp_port, timeout=10)

            with server:
                if self.settings.smtp_use_tls and not self.settings.smtp_use_ssl:
                    server.starttls()
                if self.settings.smtp_user:
                    server.login(self.settings.smtp_user, self.settings.smtp_password)
                server.sendmail(self.settings.smtp_from_email, [to_email], msg.as_string())
            return True
        except Exception:
            logger.exception('Failed to send email notification')
            return False
