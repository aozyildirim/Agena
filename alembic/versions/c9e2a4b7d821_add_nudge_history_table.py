"""add nudge_history table

Revision ID: c9e2a4b7d821
Revises: 7c771ad7939f
Create Date: 2026-04-24 09:42:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = 'c9e2a4b7d821'
down_revision = '7c771ad7939f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'nudge_history',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('provider', sa.String(length=16), nullable=False),
        sa.Column('external_item_id', sa.String(length=128), nullable=False),
        sa.Column('assignee', sa.String(length=256), nullable=True),
        sa.Column('language', sa.String(length=8), nullable=False, server_default='en'),
        sa.Column('agent_provider', sa.String(length=32), nullable=False, server_default='openai'),
        sa.Column('agent_model', sa.String(length=64), nullable=True),
        sa.Column('generated_by', sa.String(length=128), nullable=True),
        sa.Column('comment_text', sa.Text(), nullable=True),
        sa.Column('last_commenter', sa.String(length=256), nullable=True),
        sa.Column('hours_silent', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.UniqueConstraint('organization_id', 'provider', 'external_item_id', 'created_at', name='uq_nudge_history_org_item_ts'),
    )
    op.create_index('ix_nudge_history_organization_id', 'nudge_history', ['organization_id'])
    op.create_index('ix_nudge_history_user_id', 'nudge_history', ['user_id'])
    op.create_index('ix_nudge_history_provider', 'nudge_history', ['provider'])
    op.create_index('ix_nudge_history_external_item_id', 'nudge_history', ['external_item_id'])
    op.create_index('ix_nudge_history_created_at', 'nudge_history', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_nudge_history_created_at', table_name='nudge_history')
    op.drop_index('ix_nudge_history_external_item_id', table_name='nudge_history')
    op.drop_index('ix_nudge_history_provider', table_name='nudge_history')
    op.drop_index('ix_nudge_history_user_id', table_name='nudge_history')
    op.drop_index('ix_nudge_history_organization_id', table_name='nudge_history')
    op.drop_table('nudge_history')
