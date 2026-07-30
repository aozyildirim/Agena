"""BR Management — re-sync the seeded prompts with the code defaults

0076 seeded `prompts` from the constants in br_management_service. The intake
prompt has since gained a `section` field on each question (it anchors the
question to a Decision Pack row in the intake UI), and the DB row wins over
the constant — so without this the new field would never be emitted.

Only rows still identical to the 0076 seed are refreshed; a hand-edited
prompt is left alone.

Revision ID: 0078_br_prompt_resync
Revises: 0077_br_webhook_token
Create Date: 2026-07-30
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0078_br_prompt_resync'
down_revision = '0077_br_webhook_token'
branch_labels = None
depends_on = None

# What 0076 wrote: version 1, untouched by an admin.
SEEDED_VERSION = 1


def upgrade() -> None:
    from agena_services.services.br_management_service import (
        DEFAULT_INTAKE_SYSTEM_PROMPT,
        DEFAULT_SYSTEM_PROMPT,
    )

    conn = op.get_bind()
    for slug, content in (
        ('br_evaluation_system_prompt', DEFAULT_SYSTEM_PROMPT),
        ('br_intake_system_prompt', DEFAULT_INTAKE_SYSTEM_PROMPT),
    ):
        conn.execute(
            sa.text(
                'UPDATE prompts SET content = :content, version = version + 1 '
                'WHERE slug = :slug AND version = :seeded'
            ),
            {'content': content, 'slug': slug, 'seeded': SEEDED_VERSION},
        )


def downgrade() -> None:
    # The previous text is not recoverable here, and the code constant is the
    # fallback anyway — leave the rows as they are.
    pass
