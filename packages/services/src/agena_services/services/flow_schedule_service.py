"""Cron schedules for flows: CRUD, due-detection with an atomic claim, and
running a scheduled flow as its owner."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.flow_schedule import FlowSchedule
from agena_models.models.user_preference import UserPreference
from agena_services.services.flow_cron import CronError, next_run, parse, upcoming

logger = logging.getLogger(__name__)

DUE_BATCH = 50


def _tz(name: str) -> ZoneInfo:
    try:
        return ZoneInfo((name or 'UTC').strip() or 'UTC')
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f'Unknown timezone {name!r}') from exc


def compute_next_run(cron: str, tz_name: str, after: datetime | None = None) -> datetime:
    """Next fire time as naive UTC (what the column stores)."""
    tz = _tz(tz_name)
    base = (after or datetime.now(timezone.utc)).astimezone(tz)
    return next_run(cron, base).astimezone(timezone.utc).replace(tzinfo=None)


def preview(cron: str, tz_name: str, count: int = 5) -> list[datetime]:
    tz = _tz(tz_name)
    return [d.astimezone(timezone.utc).replace(tzinfo=None) for d in upcoming(cron, datetime.now(timezone.utc).astimezone(tz), count)]


class FlowScheduleService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── CRUD ────────────────────────────────────────────────────────────
    async def create(
        self, *, organization_id: int, user_id: int, flow_id: str, flow_name: str,
        cron: str, timezone_name: str = 'UTC', enabled: bool = True, task: dict[str, Any] | None = None,
    ) -> FlowSchedule:
        parse(cron)  # raises CronError
        row = FlowSchedule(
            organization_id=organization_id, user_id=user_id, flow_id=flow_id, flow_name=(flow_name or flow_id)[:255],
            cron=cron.strip(), timezone=(timezone_name or 'UTC').strip() or 'UTC', enabled=enabled, task_json=task or None,
            next_run_at=compute_next_run(cron, timezone_name) if enabled else None,
        )
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def list_for_user(self, organization_id: int, user_id: int) -> list[FlowSchedule]:
        rows = await self.db.execute(
            select(FlowSchedule)
            .where(FlowSchedule.organization_id == organization_id, FlowSchedule.user_id == user_id)
            .order_by(FlowSchedule.created_at.desc())
        )
        return list(rows.scalars().all())

    async def get_owned(self, organization_id: int, user_id: int, schedule_id: int) -> FlowSchedule | None:
        row = await self.db.get(FlowSchedule, schedule_id)
        if row is None or row.organization_id != organization_id or row.user_id != user_id:
            return None
        return row

    async def update(self, row: FlowSchedule, **changes: Any) -> FlowSchedule:
        if 'cron' in changes and changes['cron'] is not None:
            parse(changes['cron'])
            row.cron = changes['cron'].strip()
        if 'timezone_name' in changes and changes['timezone_name']:
            _tz(changes['timezone_name'])
            row.timezone = changes['timezone_name'].strip()
        if 'enabled' in changes and changes['enabled'] is not None:
            row.enabled = bool(changes['enabled'])
        if 'task' in changes:
            row.task_json = changes['task'] or None
        if 'flow_name' in changes and changes['flow_name']:
            row.flow_name = changes['flow_name'][:255]
        row.next_run_at = compute_next_run(row.cron, row.timezone) if row.enabled else None
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def delete(self, row: FlowSchedule) -> None:
        await self.db.delete(row)
        await self.db.commit()

    # ── scheduling ──────────────────────────────────────────────────────
    async def due(self, now: datetime | None = None) -> list[FlowSchedule]:
        now = now or datetime.utcnow()
        rows = await self.db.execute(
            select(FlowSchedule)
            .where(FlowSchedule.enabled.is_(True), FlowSchedule.next_run_at.isnot(None), FlowSchedule.next_run_at <= now)
            .order_by(FlowSchedule.next_run_at)
            .limit(DUE_BATCH)
        )
        return list(rows.scalars().all())

    async def claim(self, row: FlowSchedule, now: datetime | None = None) -> bool:
        """Advance next_run_at past *now* in one conditional UPDATE. Whoever
        wins the row runs the tick; missed ticks are skipped, not replayed."""
        now = now or datetime.utcnow()
        try:
            following = compute_next_run(row.cron, row.timezone, now.replace(tzinfo=timezone.utc))
        except (CronError, ValueError) as exc:
            await self.db.execute(update(FlowSchedule).where(FlowSchedule.id == row.id).values(enabled=False, last_status='invalid', last_error=str(exc)[:2000]))
            await self.db.commit()
            return False
        result = await self.db.execute(
            update(FlowSchedule)
            .where(FlowSchedule.id == row.id, FlowSchedule.next_run_at == row.next_run_at)
            .values(next_run_at=following, last_run_at=now, run_count=FlowSchedule.run_count + 1)
        )
        await self.db.commit()
        return result.rowcount == 1

    async def execute(self, row: FlowSchedule) -> None:
        """Run the scheduled flow as its owner and record the outcome."""
        from agena_services.services.flow_executor import run_flow  # heavy import, keep it lazy

        pref = (await self.db.execute(select(UserPreference).where(UserPreference.user_id == row.user_id))).scalar_one_or_none()
        flows: list[dict[str, Any]] = json.loads(pref.flows_json) if pref and pref.flows_json else []
        flow = next((f for f in flows if f.get('id') == row.flow_id), None)
        if flow is None:
            row.enabled = False
            row.next_run_at = None
            row.last_status = 'missing_flow'
            row.last_error = f'Flow {row.flow_id} no longer exists in the owner\'s flows'
            await self.db.commit()
            return
        # No task row backs a scheduled run: leave `id` out so run_flow stores
        # NULL, and let the trigger node see when/what fired it.
        task = dict(row.task_json or {})
        task.pop('id', None)
        task.setdefault('title', f'Scheduled: {flow.get("name", row.flow_id)}')
        task['scheduled'] = True
        task['schedule_id'] = row.id
        task['scheduled_at'] = datetime.utcnow().isoformat(timespec='minutes')
        try:
            flow_run = await run_flow(flow=flow, task=task, user_id=row.user_id, organization_id=row.organization_id, db=self.db)
            row.last_run_id = flow_run.id
            row.last_status = str(getattr(flow_run, 'status', 'completed') or 'completed')
            row.last_error = None
        except Exception as exc:
            logger.exception('scheduled flow %s failed', row.id)
            # The failed flush leaves the session needing a rollback before
            # the outcome can be written.
            await self.db.rollback()
            row = await self.db.get(FlowSchedule, row.id) or row
            row.last_status = 'failed'
            row.last_error = str(exc)[:2000]
        await self.db.commit()
