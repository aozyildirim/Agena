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


def _table_exists(bind, name: str) -> bool:
    return name in sa.inspect(bind).get_table_names()


def _index_exists(bind, table: str, name: str) -> bool:
    if not _table_exists(bind, table):
        return False
    return any(ix.get('name') == name for ix in sa.inspect(bind).get_indexes(table))


def upgrade() -> None:
    # Idempotent: an earlier hand-rolled CREATE TABLE on some envs already
    # provisioned this. Re-running the same DDL would crash with
    # "Table already exists" — skip if already there.
    bind = op.get_bind()
    if not _table_exists(bind, 'task_attachments'):
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
    if not _index_exists(bind, 'task_attachments', 'ix_task_attachments_task_id'):
        op.create_index('ix_task_attachments_task_id', 'task_attachments', ['task_id'])
    if not _index_exists(bind, 'task_attachments', 'ix_task_attachments_organization_id'):
        op.create_index('ix_task_attachments_organization_id', 'task_attachments', ['organization_id'])


def downgrade() -> None:
    bind = op.get_bind()
    if _index_exists(bind, 'task_attachments', 'ix_task_attachments_organization_id'):
        op.drop_index('ix_task_attachments_organization_id', table_name='task_attachments')
    if _index_exists(bind, 'task_attachments', 'ix_task_attachments_task_id'):
        op.drop_index('ix_task_attachments_task_id', table_name='task_attachments')
    if _table_exists(bind, 'task_attachments'):
        op.drop_table('task_attachments')
