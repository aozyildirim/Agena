"""seed the sentinel module so it can be toggled on /dashboard/modules

The Alerts page (/dashboard/alerts) is gated by `module: 'sentinel'` in the
sidebar, so the module must exist in the modules table to appear on the modules
page and in the nav. Idempotent INSERT IGNORE.

Revision ID: 0067_seed_sentinel_module
Revises: 0066_sentinel_alerts
Create Date: 2026-06-06
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0067_seed_sentinel_module'
down_revision = '0066_sentinel_alerts'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    existing = {r[0] for r in conn.execute(sa.text('SELECT slug FROM modules')).all()}
    if 'sentinel' not in existing:
        conn.execute(
            sa.text(
                'INSERT INTO modules '
                '(slug, name, description, icon, is_core, default_enabled, sort_order) '
                'VALUES (:slug, :name, :desc, :icon, :is_core, :enabled, :sort_order)'
            ),
            {
                'slug': 'sentinel',
                'name': 'Sentinel',
                'desc': 'Proactive production alerting on New Relic / Sentry metrics '
                        '(throughput, latency, error-rate, DB time) with AI-assisted fixes.',
                'icon': '🛡️',
                'is_core': 0,
                'enabled': 1,
                'sort_order': 32,
            },
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM modules WHERE slug = 'sentinel'"))
