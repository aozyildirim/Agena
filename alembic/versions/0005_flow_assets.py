"""add flow templates, versions, and analytics snapshots

Revision ID: 0005_flow_assets
Revises: 0004_flow_runs
Create Date: 2026-03-21
"""

from alembic import op
import sqlalchemy as sa

revision = '0005_flow_assets'
down_revision = '0004_flow_runs'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'flow_templates',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('flow_json', sa.Text(), nullable=False),
        sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index('ix_flow_templates_organization_id', 'flow_templates', ['organization_id'])

    op.create_table(
        'flow_versions',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('flow_id', sa.String(255), nullable=False),
        sa.Column('flow_name', sa.String(255), nullable=False),
        sa.Column('label', sa.String(255), nullable=False),
        sa.Column('flow_json', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index('ix_flow_versions_organization_id', 'flow_versions', ['organization_id'])
    op.create_index('ix_flow_versions_user_id', 'flow_versions', ['user_id'])
    op.create_index('ix_flow_versions_flow_id', 'flow_versions', ['flow_id'])
    op.create_index('ix_flow_versions_created_at', 'flow_versions', ['created_at'])

    op.create_table(
        'agent_analytics_snapshots',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('snapshot_json', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index('ix_agent_analytics_snapshots_organization_id', 'agent_analytics_snapshots', ['organization_id'])
    op.create_index('ix_agent_analytics_snapshots_user_id', 'agent_analytics_snapshots', ['user_id'])
    op.create_index('ix_agent_analytics_snapshots_created_at', 'agent_analytics_snapshots', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_agent_analytics_snapshots_created_at', table_name='agent_analytics_snapshots')
    op.drop_index('ix_agent_analytics_snapshots_user_id', table_name='agent_analytics_snapshots')
    op.drop_index('ix_agent_analytics_snapshots_organization_id', table_name='agent_analytics_snapshots')
    op.drop_table('agent_analytics_snapshots')

    op.drop_index('ix_flow_versions_created_at', table_name='flow_versions')
    op.drop_index('ix_flow_versions_flow_id', table_name='flow_versions')
    op.drop_index('ix_flow_versions_user_id', table_name='flow_versions')
    op.drop_index('ix_flow_versions_organization_id', table_name='flow_versions')
    op.drop_table('flow_versions')

    op.drop_index('ix_flow_templates_organization_id', table_name='flow_templates')
    op.drop_table('flow_templates')
