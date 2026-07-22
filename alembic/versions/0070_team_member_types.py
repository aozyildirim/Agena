"""team member product/developer classification

Stores org-level product|developer buckets for sprint team members
(keyed by org + email). `source` records auto-derived vs manual override.
Backs the team-page grouping and the upcoming business-requests feature.

Revision ID: 0070_team_member_types
Revises: 0069_seed_youtrack_module
Create Date: 2026-06-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0070_team_member_types'
down_revision = '0069_seed_youtrack_module'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'team_member_types',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('display_name', sa.String(length=255), nullable=True),
        sa.Column('provider', sa.String(length=32), nullable=True),
        sa.Column('member_type', sa.String(length=16), nullable=False),
        sa.Column('source', sa.String(length=16), nullable=False, server_default='manual'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization_id', 'email', name='uq_team_member_type'),
    )
    op.create_index(
        'ix_team_member_types_organization_id', 'team_member_types', ['organization_id']
    )


def downgrade() -> None:
    op.drop_index('ix_team_member_types_organization_id', table_name='team_member_types')
    op.drop_table('team_member_types')
