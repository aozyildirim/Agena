"""add external_work_item_id to task_records

Revision ID: b7c8d9e0f1a2
Revises: a1b2c3d4e5f6
Create Date: 2026-04-21 00:40:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'b7c8d9e0f1a2'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    existing = [r[0] for r in conn.execute(sa.text("SHOW COLUMNS FROM task_records")).fetchall()]
    if 'external_work_item_id' not in existing:
        op.add_column('task_records', sa.Column('external_work_item_id', sa.String(128), nullable=True))


def downgrade() -> None:
    op.drop_column('task_records', 'external_work_item_id')
