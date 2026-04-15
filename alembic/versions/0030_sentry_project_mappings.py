"""create sentry_project_mappings table

Revision ID: 0030_sentry_project_mappings
Revises: 0029_nr_entity_mappings
Create Date: 2026-04-15
"""

from alembic import op
import sqlalchemy as sa

revision = '0030_sentry_project_mappings'
down_revision = '0029_nr_entity_mappings'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = bind.dialect.get_table_names(bind)

    if 'sentry_project_mappings' not in existing:
        op.create_table(
            'sentry_project_mappings',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('organization_id', sa.Integer(), nullable=False),
            sa.Column('project_slug', sa.String(255), nullable=False),
            sa.Column('project_name', sa.String(512), nullable=False),
            sa.Column('repo_mapping_id', sa.Integer(), nullable=True),
            sa.Column('flow_id', sa.String(255), nullable=True),
            sa.Column('auto_import', sa.Boolean(), nullable=False, server_default=sa.text('0')),
            sa.Column('import_interval_minutes', sa.Integer(), nullable=False, server_default=sa.text('60')),
            sa.Column('last_import_at', sa.DateTime(), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['repo_mapping_id'], ['repo_mappings.id'], ondelete='SET NULL'),
            sa.UniqueConstraint('organization_id', 'project_slug', name='uq_org_sentry_project'),
        )
        op.create_index('ix_sentry_project_mappings_org_id', 'sentry_project_mappings', ['organization_id'])
        op.create_index('ix_sentry_project_mappings_project_slug', 'sentry_project_mappings', ['project_slug'])
        op.create_index('ix_sentry_project_mappings_repo_mapping_id', 'sentry_project_mappings', ['repo_mapping_id'])


def downgrade() -> None:
    op.drop_table('sentry_project_mappings')
