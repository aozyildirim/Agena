"""Organization API keys — create, list, revoke, and resolve on each request."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.api_key import ApiKey
from agena_services.services.api_key_tokens import cap_role, generate_key, hash_key

# last_used_at is informational; one write a minute per key is plenty.
TOUCH_INTERVAL = timedelta(seconds=60)


class ApiKeyService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(
        self,
        *,
        organization_id: int,
        user_id: int,
        creator_role: str,
        name: str,
        role: str = 'member',
        expires_in_days: int | None = None,
    ) -> tuple[ApiKey, str]:
        """Returns the row and the plaintext key — the only time it exists."""
        granted = cap_role(role, creator_role)
        if granted is None:
            raise ValueError(f'Role {role!r} cannot be granted to an API key by a {creator_role}')
        clean_name = (name or '').strip()
        if not clean_name:
            raise ValueError('Name is required')

        plain, prefix = generate_key()
        row = ApiKey(
            organization_id=organization_id,
            created_by_user_id=user_id,
            name=clean_name[:120],
            key_prefix=prefix,
            key_hash=hash_key(plain),
            role=granted,
            expires_at=(datetime.utcnow() + timedelta(days=expires_in_days)) if expires_in_days else None,
        )
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return row, plain

    async def list(self, organization_id: int) -> list[ApiKey]:
        rows = await self.db.execute(
            select(ApiKey)
            .where(ApiKey.organization_id == organization_id)
            .order_by(ApiKey.created_at.desc(), ApiKey.id.desc())
        )
        return list(rows.scalars().all())

    async def revoke(self, organization_id: int, key_id: int) -> ApiKey | None:
        row = await self.db.get(ApiKey, key_id)
        if row is None or row.organization_id != organization_id:
            return None
        if row.revoked_at is None:
            row.revoked_at = datetime.utcnow()
            await self.db.commit()
            await self.db.refresh(row)
        return row

    async def resolve(self, plain: str) -> ApiKey | None:
        """The active key for this plaintext, or None (unknown, revoked, expired)."""
        row = (await self.db.execute(
            select(ApiKey).where(ApiKey.key_hash == hash_key(plain))
        )).scalar_one_or_none()
        if row is None or row.status != 'active':
            return None
        return row

    async def touch(self, row: ApiKey) -> None:
        now = datetime.utcnow()
        if row.last_used_at is not None and now - row.last_used_at < TOUCH_INTERVAL:
            return
        row.last_used_at = now
        await self.db.commit()
