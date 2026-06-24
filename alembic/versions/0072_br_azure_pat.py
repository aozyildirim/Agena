"""BR Management — optional BR-scoped Azure PAT

The org's main Azure PAT often can't see the BR team's project/area, so
BR settings gets its own optional PAT (+ base URL). Empty falls back to
the main Azure integration.

Revision ID: 0072_br_azure_pat
Revises: 0071_business_request
Create Date: 2026-06-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0072_br_azure_pat'
down_revision = '0071_business_request'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('business_request_settings', sa.Column('azure_pat', sa.Text(), nullable=True))
    op.add_column('business_request_settings', sa.Column('azure_base_url', sa.String(length=512), nullable=True))


def downgrade() -> None:
    op.drop_column('business_request_settings', 'azure_base_url')
    op.drop_column('business_request_settings', 'azure_pat')
