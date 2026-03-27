"""add invited_by column to invites

Revision ID: 0021_invite_invited_by
Revises: 0020_org_slug
Create Date: 2026-03-26 12:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = '0021_invite_invited_by'
down_revision = '0020_org_slug'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_name='invites' AND column_name='invited_by'"
    ))
    if result.scalar():
        return
    op.add_column(
        'invites',
        sa.Column('invited_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('invites', 'invited_by')
