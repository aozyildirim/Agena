"""BR Management — multiple packs, state control, delivery breakdown, field map

Four things the business unit asked for:
  * a second, heavier Decision Pack for requests that become projects
  * control over which Azure states belong in the queue (so a Done BR can
    still be scored) and the state reaching the prompt
  * an AI-proposed Feature/Story/Task tree created under the BR in Azure
  * Decision Pack sections written into Azure custom fields, not just the
    description

Revision ID: 0080_br_packs_states
Revises: 0079_br_intake_attach
Create Date: 2026-07-31
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0080_br_packs_states'
down_revision = '0079_br_intake_attach'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('business_request_settings', sa.Column('decision_packs', sa.JSON(), nullable=True))
    op.add_column('business_request_settings', sa.Column('included_states', sa.JSON(), nullable=True))
    op.add_column('business_request_settings', sa.Column('azure_field_map', sa.JSON(), nullable=True))

    op.add_column('business_request_evals', sa.Column('state', sa.String(length=64), nullable=True))
    op.add_column('business_request_evals', sa.Column('pack_key', sa.String(length=64), nullable=True))
    op.add_column('business_request_evals', sa.Column('breakdown', sa.JSON(), nullable=True))
    op.add_column(
        'business_request_evals', sa.Column('breakdown_created_at', sa.DateTime(), nullable=True)
    )

    op.add_column('business_request_intakes', sa.Column('pack_key', sa.String(length=64), nullable=True))

    # The breakdown prompt joins the other two as an editable DB row.
    from agena_services.services.br_management_service import (
        DEFAULT_BREAKDOWN_SYSTEM_PROMPT,
    )

    conn = op.get_bind()
    if not conn.execute(
        sa.text('SELECT 1 FROM prompts WHERE slug = :s'),
        {'s': 'br_breakdown_system_prompt'},
    ).first():
        op.bulk_insert(
            sa.table(
                'prompts',
                sa.column('slug', sa.String), sa.column('name', sa.String),
                sa.column('category', sa.String), sa.column('content', sa.Text),
                sa.column('description', sa.Text), sa.column('is_active', sa.Boolean),
                sa.column('version', sa.Integer),
            ),
            [{
                'slug': 'br_breakdown_system_prompt',
                'name': 'BR Delivery Breakdown Prompt',
                'category': 'br',
                'content': DEFAULT_BREAKDOWN_SYSTEM_PROMPT,
                'description': (
                    'Turns a matured BR into the Feature / User Story / Task tree '
                    'created under it in Azure.'
                ),
                'is_active': True,
                'version': 1,
            }],
        )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text("DELETE FROM prompts WHERE slug = 'br_breakdown_system_prompt'")
    )
    op.drop_column('business_request_intakes', 'pack_key')
    op.drop_column('business_request_evals', 'breakdown_created_at')
    op.drop_column('business_request_evals', 'breakdown')
    op.drop_column('business_request_evals', 'pack_key')
    op.drop_column('business_request_evals', 'state')
    op.drop_column('business_request_settings', 'azure_field_map')
    op.drop_column('business_request_settings', 'included_states')
    op.drop_column('business_request_settings', 'decision_packs')
