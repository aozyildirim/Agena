"""BR Management — continuous auto-evaluation

Settings gain the Azure project to scan, a per-org scan interval and the
last-scan timestamp; evals gain a content hash (re-evaluate only when the
work item's title/description actually changed) and the LLM run time.

Revision ID: 0074_br_auto_eval
Revises: 0073_br_checklist
Create Date: 2026-07-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0074_br_auto_eval'
down_revision = '0073_br_checklist'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'business_request_settings',
        sa.Column('azure_project', sa.String(length=256), nullable=True),
    )
    op.add_column(
        'business_request_settings',
        sa.Column(
            'auto_eval_interval_minutes',
            sa.Integer(),
            nullable=False,
            server_default='5',
        ),
    )
    op.add_column(
        'business_request_settings',
        sa.Column('last_auto_eval_at', sa.DateTime(), nullable=True),
    )
    op.add_column(
        'business_request_evals',
        sa.Column('content_hash', sa.String(length=64), nullable=True),
    )
    op.add_column(
        'business_request_evals',
        sa.Column('evaluated_at', sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('business_request_evals', 'evaluated_at')
    op.drop_column('business_request_evals', 'content_hash')
    op.drop_column('business_request_settings', 'last_auto_eval_at')
    op.drop_column('business_request_settings', 'auto_eval_interval_minutes')
    op.drop_column('business_request_settings', 'azure_project')
