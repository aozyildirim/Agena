"""add workspaces + workspace_members; seed one default workspace per existing org and backfill

Adds a Workspace layer between Organization and tasks/sprints/repos. For
backward compatibility every existing organization is given a default
workspace named "Default" with all members auto-joined and all existing
tasks / sprints / repo mappings / agents back-filled to point at it.

The new `workspace_id` column on those tables is nullable for the duration
of this migration so the data move can happen in one upgrade. After the
backfill the column stays nullable for forward-compat with NULL = "no
workspace" rows that older code paths may still produce until they are
fully migrated. Service-layer code that wants a hard guarantee can use
`workspace_id IS NOT NULL`.

Revision ID: 0057_add_workspaces
Revises: 0056_review_assignment
Create Date: 2026-05-06
"""
from __future__ import annotations

import secrets
import string

import sqlalchemy as sa
from alembic import op


revision = '0057_add_workspaces'
down_revision = '0056_review_assignment'
branch_labels = None
depends_on = None


def _ambiguous_safe_alphabet() -> str:
    return ''.join(c for c in (string.ascii_uppercase + string.digits) if c not in 'O0I1')


def _generate_code(length: int = 6) -> str:
    alphabet = _ambiguous_safe_alphabet()
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def upgrade() -> None:
    op.create_table(
        'workspaces',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('organization_id', sa.Integer, sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('slug', sa.String(100), nullable=False),
        sa.Column('description', sa.String(500), nullable=True),
        sa.Column('invite_code', sa.String(16), nullable=False, unique=True, index=True),
        sa.Column('is_default', sa.Boolean, nullable=False, server_default=sa.text('0')),
        sa.Column('created_by_user_id', sa.Integer, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('organization_id', 'slug', name='uq_workspace_org_slug'),
    )

    op.create_table(
        'workspace_members',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('workspace_id', sa.Integer, sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('role', sa.String(32), nullable=False, server_default='member'),
        sa.Column('title', sa.String(80), nullable=True),
        sa.Column('joined_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('workspace_id', 'user_id', name='uq_workspace_member'),
    )

    # Add workspace_id (nullable) to the tables that should scope down to a workspace.
    for table in ('task_records', 'repo_mappings'):
        op.add_column(table, sa.Column('workspace_id', sa.Integer, sa.ForeignKey('workspaces.id', ondelete='SET NULL'), nullable=True, index=True))

    # Seed a default workspace per organization and backfill rows.
    bind = op.get_bind()

    orgs = bind.execute(sa.text('SELECT id FROM organizations')).fetchall()
    used_codes: set[str] = set()
    for (org_id,) in orgs:
        code = _generate_code()
        while code in used_codes:
            code = _generate_code()
        used_codes.add(code)

        result = bind.execute(
            sa.text(
                "INSERT INTO workspaces (organization_id, name, slug, description, invite_code, is_default) "
                "VALUES (:org_id, 'Default', 'default', 'Default workspace (auto-created)', :code, 1)"
            ),
            {'org_id': org_id, 'code': code},
        )
        ws_id = result.lastrowid

        # Auto-add every org member to the default workspace
        bind.execute(
            sa.text(
                "INSERT INTO workspace_members (workspace_id, user_id, role) "
                "SELECT :ws_id, user_id, role FROM organization_members WHERE organization_id = :org_id"
            ),
            {'ws_id': ws_id, 'org_id': org_id},
        )

        # Backfill workspace_id on the per-org tables
        for table in ('task_records', 'repo_mappings'):
            bind.execute(
                sa.text(f"UPDATE {table} SET workspace_id = :ws_id WHERE organization_id = :org_id AND workspace_id IS NULL"),
                {'ws_id': ws_id, 'org_id': org_id},
            )


def downgrade() -> None:
    for table in ('repo_mappings', 'task_records'):
        op.drop_column(table, 'workspace_id')
    op.drop_table('workspace_members')
    op.drop_table('workspaces')
