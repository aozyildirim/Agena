"""Weekly engineering digest per organization: what happened in the last
seven days, compared with the seven before, delivered to owners and
admins through the usual channels (and outbound webhooks via the
notification hook)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_core.settings import get_settings
from agena_models.models.ai_usage_event import AIUsageEvent
from agena_models.models.audit_log import AuditLog
from agena_models.models.flow_run import FlowRun
from agena_models.models.notification_record import NotificationRecord
from agena_models.models.organization import Organization
from agena_models.models.organization_member import OrganizationMember
from agena_models.models.task_record import TaskRecord
from agena_services.services.digest_text import render
from agena_services.services.email_templates import generic_notification_email
from agena_services.services.notification_service import NotificationService

logger = logging.getLogger(__name__)

WEEKLY_DIGEST_EVENT = 'weekly_digest'
SEND_WEEKDAY = 0      # Monday
SEND_AFTER_HOUR_UTC = 6
INSIGHTS_URL = 'https://agena.dev/dashboard/insights'

_redis: Redis | None = None


def _redis_client() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(get_settings().redis_url, decode_responses=True)
    return _redis


def week_key(now: datetime) -> str:
    iso = now.isocalendar()
    return f'{iso[0]}-W{iso[1]:02d}'


class WeeklyDigestService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def build(self, organization_id: int, *, days: int = 7, until: datetime | None = None) -> dict[str, Any]:
        until = until or datetime.utcnow()
        since = until - timedelta(days=days)
        prev_since = since - timedelta(days=days)
        org = await self.db.get(Organization, organization_id)
        current = await self._window(organization_id, since, until)
        previous = await self._window(organization_id, prev_since, since, light=True)
        return {
            'organization_id': organization_id,
            'organization_name': org.name if org else None,
            'since': since.isoformat(timespec='minutes'),
            'until': until.isoformat(timespec='minutes'),
            **current,
            'previous': previous,
        }

    async def _window(self, org_id: int, since: datetime, until: datetime, *, light: bool = False) -> dict[str, Any]:
        tasks = (await self.db.execute(
            select(
                func.count(TaskRecord.id),
                func.sum(case((TaskRecord.status == 'completed', 1), else_=0)),
                func.sum(case((TaskRecord.status == 'failed', 1), else_=0)),
            ).where(TaskRecord.organization_id == org_id, TaskRecord.created_at >= since, TaskRecord.created_at < until)
        )).one()
        ai = (await self.db.execute(
            select(func.count(AIUsageEvent.id), func.coalesce(func.sum(AIUsageEvent.total_tokens), 0), func.coalesce(func.sum(AIUsageEvent.cost_usd), 0.0))
            .where(AIUsageEvent.organization_id == org_id, AIUsageEvent.created_at >= since, AIUsageEvent.created_at < until)
        )).one()
        out: dict[str, Any] = {
            'tasks': {'created': int(tasks[0] or 0), 'completed': int(tasks[1] or 0), 'failed': int(tasks[2] or 0)},
            'ai': {'calls': int(ai[0] or 0), 'tokens': int(ai[1] or 0), 'cost_usd': round(float(ai[2] or 0), 2)},
        }
        if light:
            return out

        out['prs_opened'] = int((await self.db.execute(
            select(func.count(TaskRecord.id)).where(
                TaskRecord.organization_id == org_id, TaskRecord.pr_url.isnot(None),
                TaskRecord.updated_at >= since, TaskRecord.updated_at < until,
            )
        )).scalar_one() or 0)

        # Flow runs are user-scoped; attribute them through org membership.
        member_ids = select(OrganizationMember.user_id).where(OrganizationMember.organization_id == org_id)
        flows = (await self.db.execute(
            select(func.count(FlowRun.id), func.sum(case((FlowRun.status == 'failed', 1), else_=0)))
            .where(FlowRun.user_id.in_(member_ids), FlowRun.started_at >= since, FlowRun.started_at < until)
        )).one()
        out['flows'] = {'runs': int(flows[0] or 0), 'failed': int(flows[1] or 0)}

        top_models = (await self.db.execute(
            select(AIUsageEvent.model, func.coalesce(func.sum(AIUsageEvent.cost_usd), 0.0))
            .where(AIUsageEvent.organization_id == org_id, AIUsageEvent.created_at >= since, AIUsageEvent.created_at < until)
            .group_by(AIUsageEvent.model).order_by(func.sum(AIUsageEvent.cost_usd).desc()).limit(3)
        )).all()
        out['ai']['top_models'] = [{'model': m or 'unknown', 'cost_usd': round(float(c or 0), 2)} for m, c in top_models]

        audit_total = (await self.db.execute(
            select(func.count(AuditLog.id), func.count(func.distinct(AuditLog.actor_user_id)))
            .where(AuditLog.organization_id == org_id, AuditLog.created_at >= since, AuditLog.created_at < until)
        )).one()
        top_actors = (await self.db.execute(
            select(AuditLog.actor_email, func.count(AuditLog.id))
            .where(AuditLog.organization_id == org_id, AuditLog.created_at >= since, AuditLog.created_at < until, AuditLog.actor_email.isnot(None))
            .group_by(AuditLog.actor_email).order_by(func.count(AuditLog.id).desc()).limit(3)
        )).all()
        alerts = (await self.db.execute(
            select(func.count(func.distinct(NotificationRecord.title + NotificationRecord.message)))
            .where(NotificationRecord.organization_id == org_id, NotificationRecord.event_type == 'security_alert',
                   NotificationRecord.created_at >= since, NotificationRecord.created_at < until)
        )).scalar_one()
        out['audit'] = {
            'events': int(audit_total[0] or 0),
            'actors': int(audit_total[1] or 0),
            'security_alerts': int(alerts or 0),
            'top_actors': [{'email': e, 'events': int(n)} for e, n in top_actors],
        }
        return out

    async def recipients(self, organization_id: int) -> list[int]:
        rows = await self.db.execute(
            select(OrganizationMember.user_id).where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.role.in_(('owner', 'admin')),
            )
        )
        return sorted({int(r[0]) for r in rows.all()})

    async def send(self, organization_id: int, *, user_ids: list[int] | None = None) -> int:
        digest = await self.build(organization_id)
        title, message = render(digest)
        _, html = generic_notification_email(title=title, message=message, severity='info', action_url=INSIGHTS_URL, action_label='Open insights')
        notifier = NotificationService(self.db)
        sent = 0
        for uid in (user_ids if user_ids is not None else await self.recipients(organization_id)):
            try:
                await notifier.notify_event(
                    organization_id=organization_id, user_id=uid, event_type=WEEKLY_DIGEST_EVENT,
                    title=title, message=message, severity='info', payload={'digest': digest, 'href': '/dashboard/insights'},
                    email_subject=f'[AGENA] {title}', email_html=html,
                )
                sent += 1
            except Exception:
                logger.warning('weekly digest: notify failed for user %s', uid, exc_info=True)
        return sent

    @staticmethod
    def is_send_window(now: datetime) -> bool:
        return now.weekday() == SEND_WEEKDAY and now.hour >= SEND_AFTER_HOUR_UTC

    async def send_due(self, now: datetime | None = None) -> list[int]:
        """Send this week's digest to every organization that has not had it
        yet. The Redis NX key is the once-per-week lock; it outlives the
        send window so a Tuesday restart does not resend."""
        now = now or datetime.utcnow()
        if not self.is_send_window(now):
            return []
        org_ids = [int(r[0]) for r in (await self.db.execute(select(Organization.id))).all()]
        sent_for: list[int] = []
        for org_id in org_ids:
            try:
                fresh = await _redis_client().set(f'digest:sent:{org_id}:{week_key(now)}', '1', ex=8 * 24 * 3600, nx=True)
            except Exception:
                logger.warning('weekly digest: redis unavailable, skipping this tick')
                return sent_for
            if not fresh:
                continue
            try:
                if await self.send(org_id):
                    sent_for.append(org_id)
            except Exception:
                logger.exception('weekly digest: failed for org %s', org_id)
        return sent_for
