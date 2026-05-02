"""triage_decisions: add source_updated_at for incremental rescan

Cache the ticket's source-side updated_at (Jira: fields.updated, Azure:
System.ChangedDate) so the next scan can skip the LLM call entirely
when nothing changed since our last verdict. Only re-evaluate when
the ticket itself moved.

Revision ID: 0046_triage_source_updated_at
Revises: 0045_triage_source_side
Create Date: 2026-05-02
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0046_triage_source_updated_at'
down_revision = '0045_triage_source_side'
branch_labels = None
depends_on = None


def _column_exists(bind, table: str, column: str) -> bool:
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return False
    return any(c['name'] == column for c in inspector.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    if not _column_exists(bind, 'triage_decisions', 'source_updated_at'):
        op.add_column(
            'triage_decisions',
            sa.Column('source_updated_at', sa.String(length=64), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _column_exists(bind, 'triage_decisions', 'source_updated_at'):
        op.drop_column('triage_decisions', 'source_updated_at')
