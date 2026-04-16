"""add sentry enrichment fields and priority to task_records

Revision ID: b6ff3524aaa0
Revises: 0030_sentry_project_mappings
Create Date: 2026-04-16 13:23:38.937509

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b6ff3524aaa0'
down_revision = '0030_sentry_project_mappings'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Columns & index may already exist from a partial run — guard each step
    conn = op.get_bind()
    existing = [r[0] for r in conn.execute(sa.text("SHOW COLUMNS FROM task_records")).fetchall()]
    if 'priority' not in existing:
        op.add_column('task_records', sa.Column('priority', sa.String(32), nullable=True))
    if 'fixability_score' not in existing:
        op.add_column('task_records', sa.Column('fixability_score', sa.Float, nullable=True))
    if 'is_unhandled' not in existing:
        op.add_column('task_records', sa.Column('is_unhandled', sa.Boolean, nullable=True))
    if 'substatus' not in existing:
        op.add_column('task_records', sa.Column('substatus', sa.String(32), nullable=True))
    if 'first_seen_at' not in existing:
        op.add_column('task_records', sa.Column('first_seen_at', sa.DateTime, nullable=True))

    indexes = [r[2] for r in conn.execute(sa.text("SHOW INDEX FROM task_records")).fetchall()]
    if 'ix_task_records_priority' not in indexes:
        op.create_index('ix_task_records_priority', 'task_records', ['priority'])

    # Deduplicate constraint for external imports
    if 'ix_task_records_external_id' in indexes:
        op.drop_index('ix_task_records_external_id', 'task_records')
    if 'uq_task_org_source_external' not in indexes:
        op.create_unique_constraint('uq_task_org_source_external', 'task_records', ['organization_id', 'source', 'external_id'])


def downgrade() -> None:
    op.drop_constraint('uq_task_org_source_external', 'task_records', type_='unique')
    op.create_index('ix_task_records_external_id', 'task_records', ['external_id'])
    op.drop_index('ix_task_records_priority', 'task_records')
    op.drop_column('task_records', 'first_seen_at')
    op.drop_column('task_records', 'substatus')
    op.drop_column('task_records', 'is_unhandled')
    op.drop_column('task_records', 'fixability_score')
    op.drop_column('task_records', 'priority')
