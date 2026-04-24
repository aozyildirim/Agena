"""add task_attachments table

Revision ID: d7e4f1a8b9c2
Revises: c9e2a4b7d821
Create Date: 2026-04-24 12:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = 'd7e4f1a8b9c2'
down_revision = 'c9e2a4b7d821'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'task_attachments',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('task_id', sa.Integer(), sa.ForeignKey('task_records.id', ondelete='CASCADE'), nullable=False),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('uploaded_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('filename', sa.String(length=512), nullable=False),
        sa.Column('content_type', sa.String(length=128), nullable=False, server_default='application/octet-stream'),
        sa.Column('size_bytes', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('storage_path', sa.String(length=1024), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('ix_task_attachments_task_id', 'task_attachments', ['task_id'])
    op.create_index('ix_task_attachments_organization_id', 'task_attachments', ['organization_id'])


def downgrade() -> None:
    op.drop_index('ix_task_attachments_organization_id', table_name='task_attachments')
    op.drop_index('ix_task_attachments_task_id', table_name='task_attachments')
    op.drop_table('task_attachments')
