"""task_reviews: add assignment_id

Reviews used to be one-per-task — fine for single-repo tasks, useless
for multi-repo tasks where each repo has its own PR (and therefore its
own diff worth reviewing). Storing the assignment_id lets the trigger
fan out a separate review per repo and the list page show which repo
each review covers.

Revision ID: 0056_review_assignment
Revises: 0055_add_task_revisions
Create Date: 2026-05-06
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0056_review_assignment'
down_revision = '0055_add_task_revisions'
branch_labels = None
depends_on = None


def _column_exists(bind, table: str, column: str) -> bool:
    insp = sa.inspect(bind)
    if table not in insp.get_table_names():
        return False
    return any(c['name'] == column for c in insp.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    if not _column_exists(bind, 'task_reviews', 'assignment_id'):
        op.add_column(
            'task_reviews',
            sa.Column(
                'assignment_id', sa.Integer(),
                sa.ForeignKey('task_repo_assignments.id', ondelete='SET NULL'),
                nullable=True, index=True,
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _column_exists(bind, 'task_reviews', 'assignment_id'):
        op.drop_column('task_reviews', 'assignment_id')
