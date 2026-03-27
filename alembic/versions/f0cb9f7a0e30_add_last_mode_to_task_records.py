"""add last_mode to task_records

Revision ID: f0cb9f7a0e30
Revises: 0022_git_analytics_tables
Create Date: 2026-03-27 11:53:57.559532

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f0cb9f7a0e30'
down_revision = '0022_git_analytics_tables'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_name='task_records' AND column_name='last_mode'"
    ))
    if result.scalar():
        return
    op.add_column('task_records', sa.Column('last_mode', sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column('task_records', 'last_mode')
