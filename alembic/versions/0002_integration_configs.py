"""add integration configs

Revision ID: 0002_integration_configs
Revises: 0001_initial
Create Date: 2026-03-21
"""

from alembic import op
import sqlalchemy as sa


revision = '0002_integration_configs'
down_revision = '0001_initial'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'integration_configs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('provider', sa.String(length=32), nullable=False),
        sa.Column('base_url', sa.String(length=512), nullable=False),
        sa.Column('project', sa.String(length=255), nullable=True),
        sa.Column('username', sa.String(length=255), nullable=True),
        sa.Column('secret', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint('organization_id', 'provider', name='uq_org_provider_integration'),
    )
    op.create_index('ix_integration_configs_organization_id', 'integration_configs', ['organization_id'])
    op.create_index('ix_integration_configs_provider', 'integration_configs', ['provider'])


def downgrade() -> None:
    op.drop_index('ix_integration_configs_provider', table_name='integration_configs')
    op.drop_index('ix_integration_configs_organization_id', table_name='integration_configs')
    op.drop_table('integration_configs')
