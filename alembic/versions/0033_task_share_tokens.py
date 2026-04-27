"""create task_share_tokens table

Time-limited, use-capped tokens that let a non-member read a task via a
public URL and optionally import it into their own organization.

Revision ID: 0033_task_share_tokens
Revises: 0032_refinement_jobs
Create Date: 2026-04-28
"""

from alembic import op
import sqlalchemy as sa


revision = '0033_task_share_tokens'
down_revision = '0032_refinement_jobs'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = bind.dialect.get_table_names(bind)

    if 'task_share_tokens' not in existing:
        op.create_table(
            'task_share_tokens',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('organization_id', sa.Integer(), nullable=False),
            sa.Column('task_id', sa.Integer(), nullable=False),
            sa.Column('created_by_user_id', sa.Integer(), nullable=True),
            sa.Column('token', sa.String(64), nullable=False),
            sa.Column('expires_at', sa.DateTime(), nullable=True),
            sa.Column('max_uses', sa.Integer(), nullable=False, server_default=sa.text('3')),
            sa.Column('use_count', sa.Integer(), nullable=False, server_default=sa.text('0')),
            sa.Column('revoked_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['task_id'], ['task_records.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='SET NULL'),
            sa.UniqueConstraint('token', name='uq_task_share_tokens_token'),
        )
        op.create_index('ix_task_share_tokens_task', 'task_share_tokens', ['task_id'])
        op.create_index('ix_task_share_tokens_org', 'task_share_tokens', ['organization_id'])
        op.create_index('ix_task_share_tokens_expires', 'task_share_tokens', ['expires_at'])


def downgrade() -> None:
    op.drop_table('task_share_tokens')
