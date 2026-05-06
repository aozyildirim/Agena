"""One-shot helper: seed workspace_roles for org_id=1 (if missing) and add a
few Member users so ss@ss.com can see how a multi-member workspace looks.

Usage (from inside the backend container):
    python scripts/seed_test_members.py
"""
from __future__ import annotations

import asyncio
import json

import bcrypt
from sqlalchemy import select, text

from agena_core.database import get_db_session
from agena_models.models.organization_member import OrganizationMember
from agena_models.models.user import User
from agena_models.models.workspace import Workspace, WorkspaceMember
from agena_models.models.workspace_role import WorkspaceRole


ORG_ID = 1
WORKSPACE_ID = 1

BUILTIN_ROLES = [
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

NEW_MEMBERS = [
    ('ahmet@ss.com', 'Ahmet Yılmaz'),
    ('zeynep@ss.com', 'Zeynep Demir'),
    ('mert@ss.com', 'Mert Kaya'),
]
DEFAULT_PASSWORD = 'password123'  # they can change it later


async def main() -> None:
    async for db in get_db_session():
        # 1. Seed builtin workspace_roles for ORG_ID if missing
        existing = await db.execute(
            select(WorkspaceRole).where(WorkspaceRole.organization_id == ORG_ID)
        )
        existing_by_name = {r.name: r for r in existing.scalars().all()}

        role_by_name: dict[str, WorkspaceRole] = dict(existing_by_name)
        for spec in BUILTIN_ROLES:
            if spec['name'] in existing_by_name:
                print(f"role exists: {spec['name']}")
                continue
            role = WorkspaceRole(
                organization_id=ORG_ID,
                name=spec['name'],
                description=spec['description'],
                permissions_json=json.dumps(spec['permissions']),
                is_builtin=True,
                is_default_for_new_members=spec['is_default'],
                sort_order=spec['sort'],
            )
            db.add(role)
            await db.flush()
            role_by_name[spec['name']] = role
            print(f"seeded role: {spec['name']} (id={role.id})")

        await db.commit()

        # 2. Backfill existing workspace_members.role_id from the legacy `role` string
        legacy_map = {'owner': 'Owner', 'admin': 'Admin', 'member': 'Member', 'viewer': 'Viewer'}
        await db.execute(text(
            """
            UPDATE workspace_members wm
            JOIN workspaces w ON w.id = wm.workspace_id
            JOIN workspace_roles wr ON wr.organization_id = w.organization_id
              AND wr.name = CASE LOWER(wm.role)
                WHEN 'owner' THEN 'Owner'
                WHEN 'admin' THEN 'Admin'
                WHEN 'viewer' THEN 'Viewer'
                ELSE 'Member'
              END
            SET wm.role_id = wr.id
            WHERE wm.role_id IS NULL AND w.organization_id = :org_id
            """
        ), {'org_id': ORG_ID})
        await db.commit()
        print('backfilled workspace_members.role_id')

        # 3. Create new Member users
        member_role = role_by_name.get('Member')
        if not member_role:
            print('Member role missing — abort')
            return

        ws_lookup = await db.execute(select(Workspace).where(Workspace.id == WORKSPACE_ID))
        workspace = ws_lookup.scalar_one_or_none()
        if not workspace:
            print(f'workspace id={WORKSPACE_ID} not found — abort')
            return

        pw_hash = bcrypt.hashpw(DEFAULT_PASSWORD.encode(), bcrypt.gensalt()).decode()
        for email, full_name in NEW_MEMBERS:
            existing_user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
            if existing_user:
                print(f'user exists: {email}')
                user = existing_user
            else:
                user = User(email=email, full_name=full_name, hashed_password=pw_hash, is_active=True)
                db.add(user)
                await db.flush()
                print(f'created user: {email} (id={user.id})')

            # organization member
            om_existing = (await db.execute(
                select(OrganizationMember).where(
                    OrganizationMember.organization_id == ORG_ID,
                    OrganizationMember.user_id == user.id,
                )
            )).scalar_one_or_none()
            if not om_existing:
                db.add(OrganizationMember(organization_id=ORG_ID, user_id=user.id, role='member'))
                print(f'  + added to org as member')

            # workspace member
            wm_existing = (await db.execute(
                select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == WORKSPACE_ID,
                    WorkspaceMember.user_id == user.id,
                )
            )).scalar_one_or_none()
            if not wm_existing:
                db.add(WorkspaceMember(
                    workspace_id=WORKSPACE_ID,
                    user_id=user.id,
                    role='member',
                    role_id=member_role.id,
                ))
                print(f'  + added to workspace {WORKSPACE_ID} as Member')

        await db.commit()
        print('done.')
        break


if __name__ == '__main__':
    asyncio.run(main())
