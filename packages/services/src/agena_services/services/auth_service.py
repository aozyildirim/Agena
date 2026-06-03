from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.organization import Organization, slugify
from agena_models.models.organization_member import OrganizationMember
from agena_models.models.subscription import Subscription
from agena_models.models.user import User
from agena_models.models.workspace import Workspace, WorkspaceMember, generate_invite_code
from agena_models.models.workspace_role import WorkspaceRole
from agena_models.schemas.auth import LoginRequest, SignupRequest
from agena_core.security.jwt import create_access_token
from agena_core.security.passwords import hash_password, verify_password


# Seed permission sets for the 4 built-in roles. Mirrors migration 0058 so
# that new orgs created via signup get the same starting matrix as orgs
# that existed at migration time.
_BUILTIN_ROLES = [
    {
        'name': 'Owner', 'sort': 10, 'is_default': False,
        'description': 'Full control of a workspace — settings, members, deletion.',
        'permissions': [
            'workspace:create', 'workspace:delete', 'workspace:manage', 'workspace:invite',
            'members:add', 'members:remove', 'members:assign-role',
            'tasks:create', 'tasks:edit', 'tasks:delete', 'tasks:assign', 'tasks:run-ai',
            'sprint:select', 'sprint:create', 'sprint:assign-task',
            'code:write', 'pr:create', 'pr:merge', 'pr:close',
            'review:request', 'review:approve',
            'refinement:run', 'refinement:approve',
            'repo:manage',
            'agents:manage', 'flows:manage', 'prompts:edit',
            'integrations:manage', 'modules:configure',
            'billing:read', 'billing:manage', 'analytics:read',
        ],
    },
    {
        'name': 'Admin', 'sort': 20, 'is_default': False,
        'description': 'Manages members, repos, and day-to-day operations.',
        'permissions': [
            'workspace:manage', 'workspace:invite',
            'members:add', 'members:remove', 'members:assign-role',
            'tasks:create', 'tasks:edit', 'tasks:delete', 'tasks:assign', 'tasks:run-ai',
            'sprint:select', 'sprint:create', 'sprint:assign-task',
            'code:write', 'pr:create', 'pr:merge', 'pr:close',
            'review:request', 'review:approve',
            'refinement:run', 'refinement:approve',
            'repo:manage',
            'agents:manage', 'flows:manage', 'prompts:edit',
            'integrations:manage',
            'analytics:read',
        ],
    },
    {
        'name': 'Member', 'sort': 30, 'is_default': True,
        'description': 'Default role — can work on tasks and run AI agents.',
        'permissions': [
            'tasks:create', 'tasks:edit', 'tasks:assign', 'tasks:run-ai',
            'sprint:select', 'sprint:assign-task',
            'code:write', 'pr:create',
            'review:request', 'review:approve',
            'analytics:read',
        ],
    },
    {
        'name': 'Viewer', 'sort': 40, 'is_default': False,
        'description': 'Read-only — can view tasks but cannot create or run AI.',
        'permissions': ['analytics:read'],
    },
]


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def signup(self, payload: SignupRequest) -> tuple[str, User, Organization]:
        existing_user = await self.db.execute(select(User).where(User.email == payload.email))
        if existing_user.scalar_one_or_none():
            raise ValueError('Email already registered')

        # Invite-driven path: user joins an existing workspace + org instead
        # of creating a new one. We resolve the invite up-front so a bad
        # token fails before any DB writes happen.
        if (payload.invite_token or '').strip():
            return await self._signup_via_invite(payload)

        if not payload.organization_name.strip():
            raise ValueError('Organization name is required')

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

        # Seed the 4 built-in workspace roles for this org so the
        # permission matrix exists before the first workspace is created.
        owner_role: WorkspaceRole | None = None
        for role_def in _BUILTIN_ROLES:
            role = WorkspaceRole(
                organization_id=org.id,
                name=role_def['name'],
                description=role_def['description'],
                permissions_json=__import__('json').dumps(role_def['permissions']),
                is_builtin=True,
                is_default_for_new_members=role_def['is_default'],
                sort_order=role_def['sort'],
            )
            self.db.add(role)
            if role_def['name'] == 'Owner':
                owner_role = role
        await self.db.flush()

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
        self.db.add(WorkspaceMember(
            workspace_id=workspace.id,
            user_id=user.id,
            role='owner',
            role_id=owner_role.id if owner_role is not None else None,
        ))

        await self.db.commit()

        token = create_access_token(subject=user.email, org_id=org.id, user_id=user.id, is_platform_admin=user.is_platform_admin)
        return token, user, org

    async def _signup_via_invite(self, payload: SignupRequest) -> tuple[str, User, Organization]:
        """Create a user and join the workspace pre-bound by ``invite_token``.

        Skips org creation, role seeding, and default-workspace bootstrapping
        because the invitee is plugging into someone else's already-set-up
        org. Org membership defaults to ``member`` (not owner).
        """
        from agena_models.models.workspace_invite_link import WorkspaceInviteLink

        token = payload.invite_token.strip()
        invite_row = await self.db.execute(
            select(WorkspaceInviteLink, Workspace, Organization)
            .join(Workspace, Workspace.id == WorkspaceInviteLink.workspace_id)
            .join(Organization, Organization.id == Workspace.organization_id)
            .where(WorkspaceInviteLink.token == token)
        )
        row = invite_row.first()
        if row is None:
            raise ValueError('Invite not found')
        link, workspace, org = row

        from datetime import datetime, timezone
        if link.revoked_at is not None:
            raise ValueError('Invite has been revoked')
        if link.expires_at is not None and link.expires_at < datetime.now(timezone.utc).replace(tzinfo=None):
            raise ValueError('Invite has expired')
        if link.max_uses is not None and link.uses >= link.max_uses:
            raise ValueError('Invite usage limit reached')

        user = User(
            email=payload.email,
            full_name=payload.full_name,
            hashed_password=hash_password(payload.password),
        )
        self.db.add(user)
        await self.db.flush()

        self.db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role='member'))

        # When the invite didn't pre-bind a role, fall back to the org's
        # ``is_default_for_new_members`` role so the new user actually
        # inherits permissions instead of getting an empty set.
        effective_role_id = link.role_id
        if effective_role_id is None:
            from agena_models.models.workspace_role import WorkspaceRole
            default_row = await self.db.execute(
                select(WorkspaceRole).where(
                    WorkspaceRole.organization_id == org.id,
                    WorkspaceRole.is_default_for_new_members.is_(True),
                ).limit(1)
            )
            default_role = default_row.scalar_one_or_none()
            if default_role is None:
                fallback_row = await self.db.execute(
                    select(WorkspaceRole).where(
                        WorkspaceRole.organization_id == org.id,
                        WorkspaceRole.is_builtin.is_(True),
                        WorkspaceRole.name == 'Member',
                    ).limit(1)
                )
                default_role = fallback_row.scalar_one_or_none()
            if default_role is not None:
                effective_role_id = default_role.id

        self.db.add(WorkspaceMember(
            workspace_id=workspace.id,
            user_id=user.id,
            role='member',
            role_id=effective_role_id,
        ))
        link.uses = (link.uses or 0) + 1

        await self.db.commit()

        token_str = create_access_token(
            subject=user.email,
            org_id=org.id,
            user_id=user.id,
            is_platform_admin=user.is_platform_admin,
        )
        return token_str, user, org

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
