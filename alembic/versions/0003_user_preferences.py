"""add user preferences

Revision ID: 0003_user_preferences
Revises: 0002_integration_configs
Create Date: 2026-03-21
"""

from alembic import op
import sqlalchemy as sa

revision = '0003_user_preferences'
down_revision = '0002_integration_configs'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'user_preferences',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('azure_project', sa.String(255), nullable=True),
        sa.Column('azure_team', sa.String(255), nullable=True),
        sa.Column('azure_sprint_path', sa.Text(), nullable=True),
        sa.Column('my_team_json', sa.Text(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index('ix_user_preferences_user_id', 'user_preferences', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_user_preferences_user_id', table_name='user_preferences')
    op.drop_table('user_preferences')
