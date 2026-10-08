"""organization audit trail

One row per state-changing request a member makes (written by the API's
AuditMiddleware) plus explicit login/signup events. Metadata only — no
request bodies.

Idempotent: the API runs ``Base.metadata.create_all`` at startup, so on a
live deployment the table usually exists before this migration runs.

Revision ID: 0081_audit_logs
Revises: 0080_br_packs_states
Create Date: 2026-10-08
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import context, op


revision = '0081_audit_logs'
down_revision = '0080_br_packs_states'
branch_labels = None
depends_on = None


def _already_exists() -> bool:
    # Offline `--sql` rendering has no live connection to inspect.
    if context.is_offline_mode():
        return False
    return sa.inspect(op.get_bind()).has_table('audit_logs')


def upgrade() -> None:
    if _already_exists():
        return
    op.create_table(
        'audit_logs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=False),
        sa.Column('workspace_id', sa.Integer(), nullable=True),
        sa.Column('actor_user_id', sa.Integer(), nullable=True),
        sa.Column('actor_email', sa.String(length=255), nullable=True),
        sa.Column('actor_role', sa.String(length=16), nullable=True),
        sa.Column('action', sa.String(length=96), nullable=False),
        sa.Column('method', sa.String(length=8), nullable=False),
        sa.Column('path', sa.String(length=512), nullable=False),
        sa.Column('route', sa.String(length=255), nullable=True),
        sa.Column('target_type', sa.String(length=64), nullable=True),
        sa.Column('target_id', sa.String(length=64), nullable=True),
        sa.Column('status_code', sa.SmallInteger(), nullable=False, server_default='0'),
        sa.Column('request_id', sa.String(length=64), nullable=True),
        sa.Column('ip_address', sa.String(length=64), nullable=True),
        sa.Column('user_agent', sa.String(length=512), nullable=True),
        sa.Column('details', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['actor_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_audit_logs_org_created', 'audit_logs', ['organization_id', 'created_at'])
    op.create_index('ix_audit_logs_org_action', 'audit_logs', ['organization_id', 'action'])


def downgrade() -> None:
    op.drop_index('ix_audit_logs_org_action', table_name='audit_logs')
    op.drop_index('ix_audit_logs_org_created', table_name='audit_logs')
    op.drop_table('audit_logs')
