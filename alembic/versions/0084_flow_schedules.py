"""cron schedules for flows

Revision ID: 0084_flow_schedules
Revises: 0083_user_sessions
Create Date: 2026-10-08
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import context, op


revision = '0084_flow_schedules'
down_revision = '0083_user_sessions'
branch_labels = None
depends_on = None


def _already_exists() -> bool:
    if context.is_offline_mode():
        return False
    return sa.inspect(op.get_bind()).has_table('flow_schedules')


def upgrade() -> None:
    if _already_exists():
        return
    op.create_table(
        'flow_schedules',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('flow_id', sa.String(length=64), nullable=False),
        sa.Column('flow_name', sa.String(length=255), nullable=False),
        sa.Column('cron', sa.String(length=120), nullable=False),
        sa.Column('timezone', sa.String(length=64), nullable=False, server_default='UTC'),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('task_json', sa.JSON(), nullable=True),
        sa.Column('next_run_at', sa.DateTime(), nullable=True),
        sa.Column('last_run_at', sa.DateTime(), nullable=True),
        sa.Column('last_run_id', sa.Integer(), nullable=True),
        sa.Column('last_status', sa.String(length=32), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('run_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_flow_schedules_due', 'flow_schedules', ['enabled', 'next_run_at'])
    op.create_index('ix_flow_schedules_org_user', 'flow_schedules', ['organization_id', 'user_id'])


def downgrade() -> None:
    op.drop_index('ix_flow_schedules_org_user', table_name='flow_schedules')
    op.drop_index('ix_flow_schedules_due', table_name='flow_schedules')
    op.drop_table('flow_schedules')
