"""BR Management — Decision Pack checklist column

Stores per-section coverage of the Business Request Decision Pack on each
evaluation (which required sections are filled / partial / missing).

Revision ID: 0073_br_checklist
Revises: 0072_br_azure_pat
Create Date: 2026-06-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0073_br_checklist'
down_revision = '0072_br_azure_pat'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('business_request_evals', sa.Column('checklist', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('business_request_evals', 'checklist')
