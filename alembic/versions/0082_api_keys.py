"""organization API keys

Long-lived credentials for the SDK and automation. Only the SHA-256 of a
key is stored. Idempotent for the same reason as 0081: the API's startup
create_all usually makes the table first on a live deployment.

Revision ID: 0082_api_keys
Revises: 0081_audit_logs
Create Date: 2026-10-08
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import context, op


revision = '0082_api_keys'
down_revision = '0081_audit_logs'
branch_labels = None
depends_on = None


def _already_exists() -> bool:
    if context.is_offline_mode():
        return False
    return sa.inspect(op.get_bind()).has_table('api_keys')


def upgrade() -> None:
    if _already_exists():
        return
    op.create_table(
        'api_keys',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=False),
        sa.Column('created_by_user_id', sa.Integer(), nullable=True),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('key_prefix', sa.String(length=16), nullable=False),
        sa.Column('key_hash', sa.String(length=64), nullable=False),
        sa.Column('role', sa.String(length=16), nullable=False, server_default='member'),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_api_keys_key_hash', 'api_keys', ['key_hash'], unique=True)
    op.create_index('ix_api_keys_org_created', 'api_keys', ['organization_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_api_keys_org_created', table_name='api_keys')
    op.drop_index('ix_api_keys_key_hash', table_name='api_keys')
    op.drop_table('api_keys')
