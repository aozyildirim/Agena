"""Task share-link service.

Creates time-limited, use-capped tokens that grant a non-member read
access to a task plus a one-shot import into their own organization.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.task_share_token import TaskShareToken


class TaskShareService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _new_token() -> str:
        # 32 random bytes → ~43 char urlsafe-base64 string. Fits in 64-char column.
        return secrets.token_urlsafe(32)

    async def create_token(
        self,
        organization_id: int,
        task_id: int,
        user_id: int | None,
        *,
        expires_in_days: int = 7,
        max_uses: int = 3,
    ) -> TaskShareToken:
        expires = datetime.utcnow() + timedelta(days=max(1, min(expires_in_days, 90)))
        row = TaskShareToken(
            organization_id=organization_id,
            task_id=task_id,
            created_by_user_id=user_id,
            token=self._new_token(),
            expires_at=expires,
            max_uses=max(1, min(max_uses, 100)),
            use_count=0,
        )
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def list_for_task(
        self,
        organization_id: int,
        task_id: int,
    ) -> list[TaskShareToken]:
        stmt = (
            select(TaskShareToken)
            .where(
                TaskShareToken.organization_id == organization_id,
                TaskShareToken.task_id == task_id,
            )
            .order_by(desc(TaskShareToken.created_at))
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def revoke(
        self,
        organization_id: int,
        token_id: int,
    ) -> bool:
        row = await self.db.get(TaskShareToken, token_id)
        if row is None or row.organization_id != organization_id:
            return False
        if row.revoked_at is None:
            row.revoked_at = datetime.utcnow()
            await self.db.commit()
        return True

    async def resolve(self, token: str) -> TaskShareToken | None:
        """Return the token row if it exists, isn't revoked, hasn't expired,
        and has uses left. Does NOT increment use_count — that's the
        import endpoint's job, since plain reads should be free."""
        if not token:
            return None
        stmt = select(TaskShareToken).where(TaskShareToken.token == token)
        row = (await self.db.execute(stmt)).scalar_one_or_none()
        if row is None:
            return None
        if row.revoked_at is not None:
            return None
        if row.expires_at is not None and row.expires_at < datetime.utcnow():
            return None
        if row.use_count >= row.max_uses:
            # Reads are still allowed up to max_uses; the import endpoint
            # is the one that consumes a use. Reading after exhaustion is
            # blocked because once the token has been "spent" the link
            # shouldn't keep dripping data.
            return None
        return row

    async def consume(self, token: TaskShareToken) -> None:
        token.use_count = (token.use_count or 0) + 1
        await self.db.commit()
