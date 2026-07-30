"""BR Management — per-org webhook token

Azure DevOps service hooks post to /webhooks/br-evaluate/{token}; the token
is what identifies the organization, since a service hook carries no auth of
its own.

Revision ID: 0077_br_webhook_token
Revises: 0076_br_prompts_sections
Create Date: 2026-07-30
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0077_br_webhook_token'
down_revision = '0076_br_prompts_sections'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'business_request_settings',
        sa.Column('webhook_token', sa.String(length=64), nullable=True),
    )
    op.create_index(
        'ix_br_settings_webhook_token', 'business_request_settings',
        ['webhook_token'], unique=True,
    )


def downgrade() -> None:
    op.drop_index('ix_br_settings_webhook_token', table_name='business_request_settings')
    op.drop_column('business_request_settings', 'webhook_token')
