"""add task_records.assigned_to

Source-platform assignee (Azure DevOps displayName, Jira name) so the
sprint-detail breakdown can show the real human the work item is on,
not the Agena user that ran the import.

Revision ID: 0036_task_assigned_to
Revises: 0035_git_pr_reviews
Create Date: 2026-04-29
"""

from alembic import op
import sqlalchemy as sa


revision = '0036_task_assigned_to'
down_revision = '0035_git_pr_reviews'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {col['name'] for col in bind.dialect.get_columns(bind, 'task_records')}
    if 'assigned_to' not in cols:
        op.add_column(
            'task_records',
            sa.Column('assigned_to', sa.String(255), nullable=True),
        )
        op.create_index('ix_task_records_assigned_to', 'task_records', ['assigned_to'])


def downgrade() -> None:
    op.drop_index('ix_task_records_assigned_to', table_name='task_records')
    op.drop_column('task_records', 'assigned_to')
