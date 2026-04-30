"""create integration_rules table + add tags_json to task_records

Revision ID: 0037_integration_rules
Revises: 0036_task_assigned_to
Create Date: 2026-04-30
"""

from alembic import op
import sqlalchemy as sa


revision = '0037_integration_rules'
down_revision = '0036_task_assigned_to'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing_tables = bind.dialect.get_table_names(bind)

    if 'integration_rules' not in existing_tables:
        op.create_table(
            'integration_rules',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('organization_id', sa.Integer(), nullable=False),
            sa.Column('provider', sa.String(16), nullable=False),
            sa.Column('name', sa.String(160), nullable=False),
            sa.Column('match_json', sa.Text(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column('action_json', sa.Text(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
            sa.Column('sort_order', sa.Integer(), nullable=False, server_default=sa.text('100')),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        )
        op.create_index('ix_integration_rules_org_provider', 'integration_rules', ['organization_id', 'provider'])

    # Add tags_json to task_records if not present
    insp = sa.inspect(bind)
    cols = [c['name'] for c in insp.get_columns('task_records')]
    if 'tags_json' not in cols:
        op.add_column('task_records', sa.Column('tags_json', sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = [c['name'] for c in insp.get_columns('task_records')]
    if 'tags_json' in cols:
        op.drop_column('task_records', 'tags_json')
    op.drop_table('integration_rules')
