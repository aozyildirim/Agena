from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.ai_usage_event import AIUsageEvent


class AIUsageEventService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create_event(
        self,
        *,
        organization_id: int,
        user_id: int | None,
        task_id: int | None,
        operation_type: str,
        provider: str,
        model: str | None,
        status: str,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        cost_usd: float,
        started_at: datetime | None = None,
        ended_at: datetime | None = None,
        duration_ms: int | None = None,
        cache_hit: bool = False,
        local_repo_path: str | None = None,
        profile_version: int | None = None,
        error_message: str | None = None,
        details_json: dict | None = None,
    ) -> AIUsageEvent:
        event = AIUsageEvent(
            organization_id=organization_id,
            user_id=user_id,
            task_id=task_id,
            operation_type=operation_type,
            provider=provider or 'unknown',
            model=model,
            status=status,
            prompt_tokens=max(0, int(prompt_tokens)),
            completion_tokens=max(0, int(completion_tokens)),
            total_tokens=max(0, int(total_tokens)),
            cost_usd=max(0.0, float(cost_usd)),
            started_at=started_at,
            ended_at=ended_at,
            duration_ms=max(0, int(duration_ms)) if duration_ms is not None else None,
            cache_hit=bool(cache_hit),
            local_repo_path=(local_repo_path or '').strip() or None,
            profile_version=profile_version,
            error_message=(error_message or '').strip() or None,
            details_json=details_json or None,
        )
        self.db.add(event)
        await self.db.commit()
        await self.db.refresh(event)
        return event

    async def list_task_events(self, organization_id: int, task_id: int) -> list[AIUsageEvent]:
        result = await self.db.execute(
            select(AIUsageEvent)
            .where(AIUsageEvent.organization_id == organization_id, AIUsageEvent.task_id == task_id)
            .order_by(AIUsageEvent.created_at.desc())
        )
        return list(result.scalars().all())

    async def list_events(
        self,
        *,
        organization_id: int,
        user_id: int | None = None,
        operation_type: str | None = None,
        provider: str | None = None,
        task_id: int | None = None,
        status: str | None = None,
        created_from: datetime | None = None,
        created_to: datetime | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[AIUsageEvent], int]:
        filters = [AIUsageEvent.organization_id == organization_id]
        if user_id is not None:
            filters.append(AIUsageEvent.user_id == user_id)
        if operation_type and operation_type != 'all':
            filters.append(AIUsageEvent.operation_type == operation_type)
        if provider and provider != 'all':
            filters.append(AIUsageEvent.provider == provider)
        if task_id is not None:
            filters.append(AIUsageEvent.task_id == task_id)
        if status and status != 'all':
            filters.append(AIUsageEvent.status == status)
        if created_from is not None:
            filters.append(AIUsageEvent.created_at >= created_from)
        if created_to is not None:
            filters.append(AIUsageEvent.created_at <= created_to)

        total_result = await self.db.execute(select(func.count(AIUsageEvent.id)).where(*filters))
        total = int(total_result.scalar_one() or 0)
        result = await self.db.execute(
            select(AIUsageEvent)
            .where(*filters)
            .order_by(AIUsageEvent.created_at.desc())
            .offset((max(1, int(page)) - 1) * max(1, int(page_size)))
            .limit(max(1, min(int(page_size), 100)))
        )
        return list(result.scalars().all()), total

    async def summary(
        self,
        *,
        organization_id: int,
        user_id: int | None = None,
        operation_type: str | None = None,
        provider: str | None = None,
        task_id: int | None = None,
        status: str | None = None,
        created_from: datetime | None = None,
        created_to: datetime | None = None,
    ) -> dict[str, float | int]:
        filters = [AIUsageEvent.organization_id == organization_id]
        if user_id is not None:
            filters.append(AIUsageEvent.user_id == user_id)
        if operation_type and operation_type != 'all':
            filters.append(AIUsageEvent.operation_type == operation_type)
        if provider and provider != 'all':
            filters.append(AIUsageEvent.provider == provider)
        if task_id is not None:
            filters.append(AIUsageEvent.task_id == task_id)
        if status and status != 'all':
            filters.append(AIUsageEvent.status == status)
        if created_from is not None:
            filters.append(AIUsageEvent.created_at >= created_from)
        if created_to is not None:
            filters.append(AIUsageEvent.created_at <= created_to)

        result = await self.db.execute(
            select(
                func.count(AIUsageEvent.id),
                func.coalesce(func.sum(AIUsageEvent.prompt_tokens), 0),
                func.coalesce(func.sum(AIUsageEvent.completion_tokens), 0),
                func.coalesce(func.sum(AIUsageEvent.total_tokens), 0),
                func.coalesce(func.sum(AIUsageEvent.cost_usd), 0),
                func.coalesce(func.avg(AIUsageEvent.duration_ms), 0),
            ).where(*filters)
        )
        count, prompt, completion, total_tokens, cost, avg_duration = result.one()
        return {
            'count': int(count or 0),
            'prompt_tokens': int(prompt or 0),
            'completion_tokens': int(completion or 0),
            'total_tokens': int(total_tokens or 0),
            'cost_usd': float(cost or 0.0),
            'avg_duration_ms': int(avg_duration or 0),
        }
