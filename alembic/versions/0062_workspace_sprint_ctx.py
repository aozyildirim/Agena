"""workspaces: store sprint picker cascade context

Adds ``sprint_project`` / ``sprint_team`` / ``sprint_board`` so the
per-workspace active-sprint picker (Azure project→team→sprint, Jira
project→board→sprint) can be fully restored on reload.

Revision ID: 0062_workspace_sprint_ctx
Revises: 0061_workspace_delivery
Create Date: 2026-06-02
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = '0062_workspace_sprint_ctx'
down_revision = '0061_workspace_delivery'
branch_labels = None
depends_on = None


def _has_column(bind, table: str, col: str) -> bool:
    insp = inspect(bind)
    if not insp.has_table(table):
        return False
    return any(c['name'] == col for c in insp.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    for col in ('sprint_project', 'sprint_team', 'sprint_board'):
        if not _has_column(bind, 'workspaces', col):
            op.add_column('workspaces', sa.Column(col, sa.String(length=255), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    for col in ('sprint_board', 'sprint_team', 'sprint_project'):
        if _has_column(bind, 'workspaces', col):
            op.drop_column('workspaces', col)
