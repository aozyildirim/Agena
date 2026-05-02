"""triage_decisions: add ticket_state for source state badge + filter

Capture the source ticket's current state ('Active', 'In Progress',
'Cancelled', etc.) so the UI can show a per-row badge and the GET
list can drop dead-state rows that survived from older scans.

Revision ID: 0048_triage_ticket_state
Revises: 0047_triage_project_key
Create Date: 2026-05-03
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0048_triage_ticket_state'
down_revision = '0047_triage_project_key'
branch_labels = None
depends_on = None


def _column_exists(bind, table: str, column: str) -> bool:
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return False
    return any(c['name'] == column for c in inspector.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    if not _column_exists(bind, 'triage_decisions', 'ticket_state'):
        op.add_column(
            'triage_decisions',
            sa.Column('ticket_state', sa.String(length=64), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _column_exists(bind, 'triage_decisions', 'ticket_state'):
        op.drop_column('triage_decisions', 'ticket_state')
