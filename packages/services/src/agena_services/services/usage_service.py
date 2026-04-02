from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_core.plans import get_plan
from agena_models.models.subscription import Subscription
from agena_models.models.usage_record import UsageRecord


class UsageService:
    FREE_TASK_LIMIT = 5  # kept for backwards compat; prefer plan-based limits

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_or_create_usage(self, organization_id: int) -> UsageRecord:
        period = datetime.now(tz=UTC).strftime('%Y-%m')
        for _ in range(2):
            result = await self.db.execute(
                select(UsageRecord).where(
                    UsageRecord.organization_id == organization_id,
                    UsageRecord.period_month == period,
                )
            )
            usage = result.scalar_one_or_none()
            if usage is not None:
                return usage

            usage = UsageRecord(organization_id=organization_id, period_month=period, tasks_used=0, tokens_used=0)
            self.db.add(usage)
            try:
                await self.db.commit()
                await self.db.refresh(usage)
                return usage
            except IntegrityError:
                await self.db.rollback()

        result = await self.db.execute(
            select(UsageRecord).where(
                UsageRecord.organization_id == organization_id,
                UsageRecord.period_month == period,
            )
        )
        usage = result.scalar_one_or_none()
        if usage is None:
            raise RuntimeError('Failed to initialize usage record')
        return usage

    async def check_task_quota(self, organization_id: int) -> None:
        sub_result = await self.db.execute(select(Subscription).where(Subscription.organization_id == organization_id))
        sub = sub_result.scalar_one_or_none()
        plan_name = sub.plan_name if sub else 'free'
        plan = get_plan(plan_name)
        limit = plan['max_tasks_per_month']

        if limit == -1:  # unlimited
            return

        usage = await self.get_or_create_usage(organization_id)
        if usage.tasks_used >= limit:
            raise PermissionError(
                f'{plan["name"]} plan limit reached ({limit} tasks/month). Upgrade your plan.'
            )

    async def increment_tasks(self, organization_id: int, delta: int = 1) -> UsageRecord:
        usage = await self.get_or_create_usage(organization_id)
        usage.tasks_used += delta
        await self.db.commit()
        await self.db.refresh(usage)
        return usage

    async def increment_tokens(self, organization_id: int, delta: int) -> UsageRecord:
        usage = await self.get_or_create_usage(organization_id)
        usage.tokens_used += delta
        await self.db.commit()
        await self.db.refresh(usage)
        return usage
