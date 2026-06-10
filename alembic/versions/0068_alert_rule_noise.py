"""alert_rules: noise suppression — min_abs (absolute floor) + consecutive breaches

A percent rule on a jittery low-latency endpoint flaps (opens then auto-resolves
seconds later). Two knobs fix it: only fire when the current value also clears an
absolute floor (min_abs), and only after N consecutive breaching samples.

Revision ID: 0068_alert_rule_noise
Revises: 0067_seed_sentinel_module
Create Date: 2026-06-06
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = '0068_alert_rule_noise'
down_revision = '0067_seed_sentinel_module'
branch_labels = None
depends_on = None


def _has_col(bind, table, col):
    insp = inspect(bind)
    return insp.has_table(table) and any(c['name'] == col for c in insp.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    if not _has_col(bind, 'alert_rules', 'min_abs'):
        op.add_column('alert_rules', sa.Column('min_abs', sa.Float(), nullable=True))
    if not _has_col(bind, 'alert_rules', 'consecutive'):
        op.add_column('alert_rules', sa.Column('consecutive', sa.Integer(), nullable=False, server_default='1'))


def downgrade() -> None:
    bind = op.get_bind()
    for col in ('consecutive', 'min_abs'):
        if _has_col(bind, 'alert_rules', col):
            op.drop_column('alert_rules', col)
