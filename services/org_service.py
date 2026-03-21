from __future__ import annotations

import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.invite import Invite
from models.organization_member import OrganizationMember
from models.user import User


class OrgService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def invite_user(self, organization_id: int, email: str) -> Invite:
        invite = Invite(
            organization_id=organization_id,
            email=email,
            token=secrets.token_urlsafe(32),
            status='pending',
        )
        self.db.add(invite)
        await self.db.commit()
        await self.db.refresh(invite)
        return invite

    async def accept_invite(self, token: str, user_id: int) -> None:
        result = await self.db.execute(select(Invite).where(Invite.token == token, Invite.status == 'pending'))
        invite = result.scalar_one_or_none()
        if invite is None:
            raise ValueError('Invalid invite token')

        exists = await self.db.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == invite.organization_id,
                OrganizationMember.user_id == user_id,
            )
        )
        if exists.scalar_one_or_none() is None:
            self.db.add(
                OrganizationMember(
                    organization_id=invite.organization_id,
                    user_id=user_id,
                    role='member',
                )
            )
        invite.status = 'accepted'
        await self.db.commit()

    async def get_user(self, user_id: int) -> User | None:
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()
