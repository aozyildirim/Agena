"""add profile settings json to user preferences

Revision ID: 0009_profile_settings_json
Revises: 0008_task_story_and_cost_guardrails
Create Date: 2026-03-22
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '0009_profile_settings_json'
down_revision = '0008_story_guardrails'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = {col['name'] for col in inspector.get_columns('user_preferences')}
    if 'profile_settings_json' not in existing:
        op.add_column('user_preferences', sa.Column('profile_settings_json', sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = {col['name'] for col in inspector.get_columns('user_preferences')}
    if 'profile_settings_json' in existing:
        op.drop_column('user_preferences', 'profile_settings_json')
