"""seed the pr_reviewer module so it can be toggled on /dashboard/modules

The PR Reviewer (live, AI inline code review on a PR) is gated behind
`module: 'pr_reviewer'` in the sidebar, so it must exist in the modules
table to appear on the modules page. Idempotent INSERT IGNORE, same shape
as 0054.

Revision ID: 0064_seed_pr_reviewer_module
Revises: 0063_pr_reviews
Create Date: 2026-06-02
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0064_seed_pr_reviewer_module'
down_revision = '0063_pr_reviews'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    existing = {r[0] for r in conn.execute(sa.text('SELECT slug FROM modules')).all()}
    if 'pr_reviewer' in existing:
        return
    conn.execute(
        sa.text(
            'INSERT INTO modules '
            '(slug, name, description, icon, is_core, default_enabled, sort_order) '
            'VALUES (:slug, :name, :desc, :icon, :is_core, :enabled, :sort_order)'
        ),
        {
            'slug': 'pr_reviewer',
            'name': 'PR Reviewer',
            'desc': 'AI reviews a pull request line-by-line and posts inline discussion threads on the changed code.',
            'icon': '🧑‍⚖️',
            'is_core': 0,
            'enabled': 0,
            'sort_order': 30,
        },
    )


def downgrade() -> None:
    # No-op (same rationale as 0054): dropping a module row would orphan
    # organization_modules and silently disable the feature.
    pass
