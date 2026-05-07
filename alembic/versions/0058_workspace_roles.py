"""add workspace_roles table; seed 4 built-in roles per org; add role_id FK on workspace_members and backfill from existing role string

Builds the foundation for org-customisable roles. Each existing org
gets the 4 built-in rows (owner / admin / member / viewer) with the
default permission catalog applied; existing workspace members get
their role_id set based on their legacy `role` string column. The old
column stays for backward-compat — code paths that read it can do so
until they're migrated to read the FK.

Revision ID: 0058_workspace_roles
Revises: 0057_add_workspaces
Create Date: 2026-05-06
"""
from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = '0058_workspace_roles'
down_revision = '0057_add_workspaces'
branch_labels = None
depends_on = None


# Default permission sets for the four built-in roles. Org owner can
# override these in the UI; what we store here is just the seed.
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
        'permissions': [
            'analytics:read',
        ],
    },
]

# Map the legacy WorkspaceMember.role string to the built-in role name
LEGACY_ROLE_MAP = {
    'owner': 'Owner',
    'admin': 'Admin',
    'member': 'Member',
    'viewer': 'Viewer',
}


def _has_table(bind, name: str) -> bool:
    return inspect(bind).has_table(name)


def _has_column(bind, table: str, col: str) -> bool:
    insp = inspect(bind)
    if not insp.has_table(table):
        return False
    return any(c['name'] == col for c in insp.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()

    if not _has_table(bind, 'workspace_roles'):
        op.create_table(
            'workspace_roles',
            sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
            sa.Column('organization_id', sa.Integer, sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('name', sa.String(80), nullable=False),
            sa.Column('description', sa.String(255), nullable=True),
            sa.Column('permissions_json', sa.Text, nullable=False),
            sa.Column('is_builtin', sa.Boolean, nullable=False, server_default=sa.text('0')),
            sa.Column('is_default_for_new_members', sa.Boolean, nullable=False, server_default=sa.text('0')),
            sa.Column('sort_order', sa.Integer, nullable=False, server_default='100'),
            sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint('organization_id', 'name', name='uq_workspace_role_name'),
        )

    # Add role_id to workspace_members (nullable — backfilled below)
    if not _has_column(bind, 'workspace_members', 'role_id'):
        op.add_column('workspace_members', sa.Column('role_id', sa.Integer, sa.ForeignKey('workspace_roles.id', ondelete='SET NULL'), nullable=True, index=True))

    # Seed 4 built-in roles per org. Skip rows that already exist (re-run safe)
    # and remember each role id per (org_id, role_name) for the backfill below.
    orgs = bind.execute(sa.text('SELECT id FROM organizations')).fetchall()
    role_id_by_org_name: dict[tuple[int, str], int] = {}
    for (org_id,) in orgs:
        for role_def in BUILTIN_ROLES:
            existing = bind.execute(
                sa.text('SELECT id FROM workspace_roles WHERE organization_id = :org_id AND name = :name'),
                {'org_id': org_id, 'name': role_def['name']},
            ).scalar()
            if existing is not None:
                role_id_by_org_name[(org_id, role_def['name'])] = existing
                continue
            result = bind.execute(
                sa.text(
                    "INSERT INTO workspace_roles (organization_id, name, description, permissions_json, is_builtin, is_default_for_new_members, sort_order) "
                    "VALUES (:org_id, :name, :desc, :perms, 1, :is_default, :sort)"
                ),
                {
                    'org_id': org_id,
                    'name': role_def['name'],
                    'desc': role_def['description'],
                    'perms': json.dumps(role_def['permissions']),
                    'is_default': 1 if role_def['is_default'] else 0,
                    'sort': role_def['sort'],
                },
            )
            role_id_by_org_name[(org_id, role_def['name'])] = result.lastrowid

    # Backfill workspace_members.role_id from the legacy `role` string —
    # only touch rows that don't yet have a role_id so re-runs are no-op.
    member_rows = bind.execute(sa.text(
        "SELECT wm.id, wm.role, w.organization_id "
        "FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id "
        "WHERE wm.role_id IS NULL"
    )).fetchall()
    for member_id, legacy_role, org_id in member_rows:
        role_name = LEGACY_ROLE_MAP.get((legacy_role or 'member').lower(), 'Member')
        role_id = role_id_by_org_name.get((org_id, role_name))
        if role_id is not None:
            bind.execute(
                sa.text("UPDATE workspace_members SET role_id = :role_id WHERE id = :member_id"),
                {'role_id': role_id, 'member_id': member_id},
            )


def downgrade() -> None:
    op.drop_column('workspace_members', 'role_id')
    op.drop_table('workspace_roles')
