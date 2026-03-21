from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.organization import Organization
from models.organization_member import OrganizationMember
from models.subscription import Subscription
from models.user import User
from schemas.auth import LoginRequest, SignupRequest
from security.jwt import create_access_token
from security.passwords import hash_password, verify_password


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def signup(self, payload: SignupRequest) -> tuple[str, User, int]:
        existing_user = await self.db.execute(select(User).where(User.email == payload.email))
        if existing_user.scalar_one_or_none():
            raise ValueError('Email already registered')

        org = Organization(name=payload.organization_name)
        self.db.add(org)
        await self.db.flush()

        user = User(
            email=payload.email,
            full_name=payload.full_name,
            hashed_password=hash_password(payload.password),
        )
        self.db.add(user)
        await self.db.flush()

        membership = OrganizationMember(organization_id=org.id, user_id=user.id, role='owner')
        self.db.add(membership)
        self.db.add(Subscription(organization_id=org.id, plan_name='free', status='active'))
        await self.db.commit()

        token = create_access_token(subject=user.email, org_id=org.id, user_id=user.id)
        return token, user, org.id

    async def login(self, payload: LoginRequest) -> tuple[str, User, int]:
        result = await self.db.execute(select(User).where(User.email == payload.email))
        user = result.scalar_one_or_none()
        if user is None or not verify_password(payload.password, user.hashed_password):
            raise ValueError('Invalid credentials')

        org_result = await self.db.execute(
            select(OrganizationMember).where(OrganizationMember.user_id == user.id).limit(1)
        )
        membership = org_result.scalar_one_or_none()
        if membership is None:
            raise ValueError('No organization membership found')

        token = create_access_token(subject=user.email, org_id=membership.organization_id, user_id=user.id)
        return token, user, membership.organization_id
