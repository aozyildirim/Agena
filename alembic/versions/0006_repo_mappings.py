"""add repo mappings json to user preferences

Revision ID: 0006_repo_mappings
Revises: 0005_flow_assets
Create Date: 2026-03-21
"""

from alembic import op
import sqlalchemy as sa

revision = '0006_repo_mappings'
down_revision = '0005_flow_assets'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('user_preferences', sa.Column('repo_mappings_json', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('user_preferences', 'repo_mappings_json')
