"""Quota checking service -- validates plan limits before resource creation."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_core.plans import get_plan
from agena_models.models.organization_member import OrganizationMember
from agena_models.models.subscription import Subscription
from agena_services.services.usage_service import UsageService


class QuotaService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _get_plan_name(self, organization_id: int) -> str:
        result = await self.db.execute(
            select(Subscription.plan_name).where(Subscription.organization_id == organization_id)
        )
        row = result.scalar_one_or_none()
        return row if row else 'free'

    async def check_task_quota(self, organization_id: int) -> None:
        """Raise ``PermissionError`` when the monthly task limit is reached."""
        plan_name = await self._get_plan_name(organization_id)
        plan = get_plan(plan_name)
        limit = plan['max_tasks_per_month']
        if limit == -1:  # unlimited
            return

        usage_service = UsageService(self.db)
        usage = await usage_service.get_or_create_usage(organization_id)
        if usage.tasks_used >= limit:
            raise PermissionError(
                f'{plan["name"]} plan limit reached ({limit} tasks/month). Upgrade your plan.'
            )

    async def check_member_quota(self, organization_id: int) -> None:
        """Raise ``PermissionError`` when the member limit is reached."""
        plan_name = await self._get_plan_name(organization_id)
        plan = get_plan(plan_name)
        limit = plan['max_members']
        if limit == -1:  # unlimited
            return

        result = await self.db.execute(
            select(func.count()).select_from(OrganizationMember).where(
                OrganizationMember.organization_id == organization_id
            )
        )
        member_count = result.scalar() or 0
        if member_count >= limit:
            raise PermissionError(
                f'{plan["name"]} plan limit reached ({limit} members). Upgrade your plan.'
            )

    async def get_usage_summary(self, organization_id: int) -> dict:
        """Return current usage vs plan limits for the organization."""
        plan_name = await self._get_plan_name(organization_id)
        plan = get_plan(plan_name)

        usage_service = UsageService(self.db)
        usage = await usage_service.get_or_create_usage(organization_id)

        member_result = await self.db.execute(
            select(func.count()).select_from(OrganizationMember).where(
                OrganizationMember.organization_id == organization_id
            )
        )
        member_count = member_result.scalar() or 0

        return {
            'plan_name': plan_name,
            'plan_display_name': plan['name'],
            'tasks_used': usage.tasks_used,
            'tasks_limit': plan['max_tasks_per_month'],
            'members_used': member_count,
            'members_limit': plan['max_members'],
            'agents_limit': plan['max_agents'],
            'features': plan['features'],
            'tokens_used': usage.tokens_used,
        }
