"""tasks: add runtime_id (route a task to a compute runtime)

Adds ``task_records.runtime_id`` — a nullable FK to ``runtimes``. Null means
the default (central local worker). Recorded at assign time and surfaced in
the UI; execution routing by runtime is a later phase.

Revision ID: 0065_task_runtime_id
Revises: 0064_seed_pr_reviewer_module
Create Date: 2026-06-04
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = '0065_task_runtime_id'
down_revision = '0064_seed_pr_reviewer_module'
branch_labels = None
depends_on = None


def _has_column(bind, table: str, col: str) -> bool:
    insp = inspect(bind)
    if not insp.has_table(table):
        return False
    return any(c['name'] == col for c in insp.get_columns(table))


def _has_fk(bind, table: str, name: str) -> bool:
    insp = inspect(bind)
    if not insp.has_table(table):
        return False
    return any(fk.get('name') == name for fk in insp.get_foreign_keys(table))


def upgrade() -> None:
    bind = op.get_bind()
    if not _has_column(bind, 'task_records', 'runtime_id'):
        op.add_column('task_records', sa.Column('runtime_id', sa.Integer(), nullable=True))
        op.create_index('ix_task_records_runtime_id', 'task_records', ['runtime_id'])
    if not _has_fk(bind, 'task_records', 'fk_task_records_runtime_id'):
        op.create_foreign_key(
            'fk_task_records_runtime_id',
            'task_records', 'runtimes',
            ['runtime_id'], ['id'],
            ondelete='SET NULL',
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _has_fk(bind, 'task_records', 'fk_task_records_runtime_id'):
        op.drop_constraint('fk_task_records_runtime_id', 'task_records', type_='foreignkey')
    if _has_column(bind, 'task_records', 'runtime_id'):
        op.drop_index('ix_task_records_runtime_id', table_name='task_records')
        op.drop_column('task_records', 'runtime_id')
