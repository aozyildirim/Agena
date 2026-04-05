"""create task_repo_assignments table for multi-repo orchestration

Revision ID: 0026_task_repo_assignments
Revises: 0025_repo_mappings_table
Create Date: 2026-04-05
"""

from alembic import op
import sqlalchemy as sa

revision = '0026_task_repo_assignments'
down_revision = '0025_repo_mappings_table'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = bind.dialect.get_table_names(bind)

    if 'task_repo_assignments' not in existing:
        op.create_table(
            'task_repo_assignments',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('task_id', sa.Integer(), nullable=False),
            sa.Column('organization_id', sa.Integer(), nullable=False),
            sa.Column('repo_mapping_id', sa.Integer(), nullable=True),
            sa.Column('status', sa.String(64), nullable=False, server_default='pending'),
            sa.Column('pr_url', sa.String(1024), nullable=True),
            sa.Column('branch_name', sa.String(255), nullable=True),
            sa.Column('failure_reason', sa.Text(), nullable=True),
            sa.Column('run_record_id', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(['task_id'], ['task_records.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['repo_mapping_id'], ['repo_mappings.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['run_record_id'], ['run_records.id'], ondelete='SET NULL'),
            sa.UniqueConstraint('task_id', 'repo_mapping_id', name='uq_task_repo_assignment'),
        )
        op.create_index('ix_task_repo_assignments_task_id', 'task_repo_assignments', ['task_id'])
        op.create_index('ix_task_repo_assignments_organization_id', 'task_repo_assignments', ['organization_id'])
        op.create_index('ix_task_repo_assignments_repo_mapping_id', 'task_repo_assignments', ['repo_mapping_id'])
        op.create_index('ix_task_repo_assignments_status', 'task_repo_assignments', ['status'])


def downgrade() -> None:
    op.drop_table('task_repo_assignments')
