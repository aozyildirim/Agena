"""add platform admin and contact newsletter tables

Revision ID: 6c7a8fa0425f
Revises: 0024_prompt_overrides
Create Date: 2026-04-03 09:11:09.830359

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '6c7a8fa0425f'
down_revision = '0024_prompt_overrides'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # User.is_platform_admin — may already exist from create_all
    try:
        op.add_column('users', sa.Column('is_platform_admin', sa.Boolean(), server_default='0', nullable=False))
    except Exception:
        pass

    # Contact submissions table — may already exist from create_all
    op.create_table(
        'contact_submissions',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('email', sa.String(255), nullable=False, index=True),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('newsletter', sa.Boolean(), default=False, nullable=False),
        sa.Column('is_read', sa.Boolean(), default=False, nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
    )

    # Newsletter subscribers table
    op.create_table(
        'newsletter_subscribers',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('email', sa.String(255), unique=True, nullable=False, index=True),
        sa.Column('is_active', sa.Boolean(), default=True, nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('newsletter_subscribers')
    op.drop_table('contact_submissions')
    op.drop_column('users', 'is_platform_admin')
