from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.organization import Organization, slugify
from agena_models.models.organization_member import OrganizationMember
from agena_models.models.subscription import Subscription
from agena_models.models.user import User
from agena_models.models.workspace import Workspace, WorkspaceMember, generate_invite_code
from agena_models.schemas.auth import LoginRequest, SignupRequest
from agena_core.security.jwt import create_access_token
from agena_core.security.passwords import hash_password, verify_password


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def signup(self, payload: SignupRequest) -> tuple[str, User, Organization]:
        existing_user = await self.db.execute(select(User).where(User.email == payload.email))
        if existing_user.scalar_one_or_none():
            raise ValueError('Email already registered')

        # Determine slug: use provided value or auto-generate from org name
        slug = payload.org_slug.strip().lower() if payload.org_slug else slugify(payload.organization_name)

        # Check slug uniqueness
        existing_slug = await self.db.execute(select(Organization).where(Organization.slug == slug))
        if existing_slug.scalar_one_or_none():
            raise ValueError('Organization slug already taken')

        org = Organization(name=payload.organization_name, slug=slug)
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
        self.db.add(Subscription(organization_id=org.id, plan_name='pro', status='active'))

        # Auto-create a default workspace and add the new user as owner.
        # Onboarding can later let them rename it or create more workspaces.
        workspace = Workspace(
            organization_id=org.id,
            name=payload.organization_name,
            slug='default',
            description='Default workspace (auto-created)',
            invite_code=generate_invite_code(),
            is_default=True,
            created_by_user_id=user.id,
        )
        self.db.add(workspace)
        await self.db.flush()
        self.db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role='owner'))

        await self.db.commit()

        token = create_access_token(subject=user.email, org_id=org.id, user_id=user.id, is_platform_admin=user.is_platform_admin)
        return token, user, org

    async def login(self, payload: LoginRequest) -> tuple[str, User, Organization]:
        result = await self.db.execute(select(User).where(User.email == payload.email))
        user = result.scalar_one_or_none()
        if user is None:
            raise ValueError('Invalid credentials')
        try:
            valid = verify_password(payload.password, user.hashed_password)
        except Exception:
            raise ValueError('Invalid credentials')
        if not valid:
            raise ValueError('Invalid credentials')

        org_result = await self.db.execute(
            select(OrganizationMember).where(OrganizationMember.user_id == user.id).limit(1)
        )
        membership = org_result.scalar_one_or_none()
        if membership is None:
            raise ValueError('No organization membership found')

        org_row = await self.db.execute(select(Organization).where(Organization.id == membership.organization_id))
        org = org_row.scalar_one()

        token = create_access_token(subject=user.email, org_id=org.id, user_id=user.id, is_platform_admin=user.is_platform_admin)
        return token, user, org
