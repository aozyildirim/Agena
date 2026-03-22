"""add profile settings json to user preferences

Revision ID: 0009_profile_settings_json
Revises: 0008_task_story_and_cost_guardrails
Create Date: 2026-03-22
"""

from alembic import op
import sqlalchemy as sa

revision = '0009_profile_settings_json'
down_revision = '0008_task_story_and_cost_guardrails'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('user_preferences', sa.Column('profile_settings_json', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('user_preferences', 'profile_settings_json')
