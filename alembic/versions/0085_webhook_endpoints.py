"""outbound webhooks: endpoints and deliveries

Revision ID: 0085_webhook_endpoints
Revises: 0084_flow_schedules
Create Date: 2026-10-08
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import context, op


revision = '0085_webhook_endpoints'
down_revision = '0084_flow_schedules'
branch_labels = None
depends_on = None


def _has(table: str) -> bool:
    if context.is_offline_mode():
        return False
    return sa.inspect(op.get_bind()).has_table(table)


def upgrade() -> None:
    if not _has('webhook_endpoints'):
        op.create_table(
            'webhook_endpoints',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('organization_id', sa.Integer(), nullable=False),
            sa.Column('created_by_user_id', sa.Integer(), nullable=True),
            sa.Column('name', sa.String(length=120), nullable=False),
            sa.Column('url', sa.String(length=1024), nullable=False),
            sa.Column('secret', sa.String(length=128), nullable=False),
            sa.Column('events', sa.JSON(), nullable=True),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default='1'),
            sa.Column('failure_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('last_delivery_at', sa.DateTime(), nullable=True),
            sa.Column('last_status', sa.String(length=16), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_webhook_endpoints_org_enabled', 'webhook_endpoints', ['organization_id', 'enabled'])
    if not _has('webhook_deliveries'):
        op.create_table(
            'webhook_deliveries',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('organization_id', sa.Integer(), nullable=False),
            sa.Column('endpoint_id', sa.Integer(), nullable=False),
            sa.Column('event_type', sa.String(length=64), nullable=False),
            sa.Column('payload', sa.JSON(), nullable=True),
            sa.Column('status', sa.String(length=16), nullable=False, server_default='pending'),
            sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('next_attempt_at', sa.DateTime(), nullable=True),
            sa.Column('response_status', sa.Integer(), nullable=True),
            sa.Column('last_error', sa.Text(), nullable=True),
            sa.Column('delivered_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['endpoint_id'], ['webhook_endpoints.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_webhook_deliveries_due', 'webhook_deliveries', ['status', 'next_attempt_at'])
        op.create_index('ix_webhook_deliveries_endpoint_created', 'webhook_deliveries', ['endpoint_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_webhook_deliveries_endpoint_created', table_name='webhook_deliveries')
    op.drop_index('ix_webhook_deliveries_due', table_name='webhook_deliveries')
    op.drop_table('webhook_deliveries')
    op.drop_index('ix_webhook_endpoints_org_enabled', table_name='webhook_endpoints')
    op.drop_table('webhook_endpoints')
