"""triage: opt-in by default + per-scan LLM call cap

Two production-cost fixes:
  1. ``OrgWorkflowSettings.triage_enabled`` flipped to FALSE on every
     existing row. We were defaulting to True so the worker's 6h
     ``_poll_triage`` was scanning every org and calling Claude once
     per stale ticket — credits burned at ~10 calls/min on big orgs.
  2. New ``triage_max_decisions_per_scan`` column (default 50) caps
     LLM calls per scan so even an opted-in org with 1000 idle tickets
     can't drain credits in a single tick.

Customers who actually want triage running re-enable it in
/dashboard/triage; the matching toggle was already there, just gated
to a different default.

Revision ID: 0060_triage_cap_and_optin
Revises: 0059_workspace_invite_links
Create Date: 2026-05-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = '0060_triage_cap_and_optin'
down_revision = '0059_workspace_invite_links'
branch_labels = None
depends_on = None


def _has_column(bind, table: str, col: str) -> bool:
    insp = inspect(bind)
    if not insp.has_table(table):
        return False
    return any(c['name'] == col for c in insp.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()

    if not _has_column(bind, 'org_workflow_settings', 'triage_max_decisions_per_scan'):
        op.add_column(
            'org_workflow_settings',
            sa.Column('triage_max_decisions_per_scan', sa.Integer, nullable=False, server_default='50'),
        )

    # Force-disable triage for every existing org. Customers who already
    # depend on it will flip it back on from /dashboard/triage; until then
    # the worker stops auto-scanning and the LLM-call drain stops.
    bind.execute(sa.text("UPDATE org_workflow_settings SET triage_enabled = 0"))


def downgrade() -> None:
    op.drop_column('org_workflow_settings', 'triage_max_decisions_per_scan')
