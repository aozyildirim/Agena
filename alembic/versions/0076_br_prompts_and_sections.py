"""BR Management — editable Decision Pack + prompts, discussion-aware evals

Three things become configurable instead of hardcoded:
  * the Decision Pack section list (per org)
  * the evaluation / intake system prompts (per org, plus a system-level
    row in `prompts` so PromptService has something to serve)
and the eval row learns to track the discussion thread it scored, so the
auto-eval poller can re-score an item when stakeholders answer in comments.

Revision ID: 0076_br_prompts_sections
Revises: 0075_br_intake
Create Date: 2026-07-30
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0076_br_prompts_sections'
down_revision = '0075_br_intake'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'business_request_settings',
        sa.Column('decision_pack_sections', sa.JSON(), nullable=True),
    )
    op.add_column(
        'business_request_settings',
        sa.Column('eval_prompt', sa.Text(), nullable=True),
    )
    op.add_column(
        'business_request_settings',
        sa.Column('intake_prompt', sa.Text(), nullable=True),
    )
    op.add_column(
        'business_request_evals',
        sa.Column('discussion_hash', sa.String(length=64), nullable=True),
    )
    op.add_column(
        'business_request_evals',
        sa.Column('pushed_to_source_at', sa.DateTime(), nullable=True),
    )

    # Seed the two BR prompts so the `prompts` table — not the Python
    # constant — is the system-level default an admin can change.
    from agena_services.services.br_management_service import (
        DEFAULT_INTAKE_SYSTEM_PROMPT,
        DEFAULT_SYSTEM_PROMPT,
    )

    prompts = sa.table(
        'prompts',
        sa.column('slug', sa.String),
        sa.column('name', sa.String),
        sa.column('category', sa.String),
        sa.column('content', sa.Text),
        sa.column('description', sa.Text),
        sa.column('is_active', sa.Boolean),
        sa.column('version', sa.Integer),
    )
    conn = op.get_bind()
    seeds = [
        {
            'slug': 'br_evaluation_system_prompt',
            'name': 'BR Evaluation System Prompt',
            'category': 'br',
            'content': DEFAULT_SYSTEM_PROMPT,
            'description': (
                'Scores a work item against the Decision Pack. '
                '{{DECISION_PACK_SECTIONS}} is replaced with the '
                "organization's numbered section list."
            ),
            'is_active': True,
            'version': 1,
        },
        {
            'slug': 'br_intake_system_prompt',
            'name': 'BR Intake Interview Prompt',
            'category': 'br',
            'content': DEFAULT_INTAKE_SYSTEM_PROMPT,
            'description': (
                'Runs the conversational BR intake and composes the '
                'Decision Pack. Also supports {{DECISION_PACK_SECTIONS}}.'
            ),
            'is_active': True,
            'version': 1,
        },
    ]
    for seed in seeds:
        exists = conn.execute(
            sa.text('SELECT 1 FROM prompts WHERE slug = :slug'), {'slug': seed['slug']}
        ).first()
        if not exists:
            op.bulk_insert(prompts, [seed])


def downgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "DELETE FROM prompts WHERE slug IN "
            "('br_evaluation_system_prompt', 'br_intake_system_prompt')"
        )
    )
    op.drop_column('business_request_evals', 'pushed_to_source_at')
    op.drop_column('business_request_evals', 'discussion_hash')
    op.drop_column('business_request_settings', 'intake_prompt')
    op.drop_column('business_request_settings', 'eval_prompt')
    op.drop_column('business_request_settings', 'decision_pack_sections')
