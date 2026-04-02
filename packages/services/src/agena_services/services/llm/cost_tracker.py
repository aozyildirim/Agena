from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.usage_record import UsageRecord


class CostTracker:
    def estimate_cost_usd(self, prompt_tokens: int, completion_tokens: int, model: str) -> float:
        if 'mini' in model:
            prompt_rate = 0.0000003
            completion_rate = 0.0000012
        else:
            prompt_rate = 0.000002
            completion_rate = 0.000008
        return round((prompt_tokens * prompt_rate) + (completion_tokens * completion_rate), 6)

    async def add_usage(
        self,
        db: AsyncSession,
        organization_id: int,
        task_delta: int,
        token_delta: int,
    ) -> UsageRecord:
        period = datetime.now(tz=UTC).strftime('%Y-%m')
        result = await db.execute(
            select(UsageRecord).where(
                UsageRecord.organization_id == organization_id,
                UsageRecord.period_month == period,
            )
        )
        usage = result.scalar_one_or_none()
        if usage is None:
            usage = UsageRecord(
                organization_id=organization_id,
                period_month=period,
                tasks_used=0,
                tokens_used=0,
            )
            db.add(usage)

        usage.tasks_used += task_delta
        usage.tokens_used += token_delta
        await db.commit()
        await db.refresh(usage)
        return usage
