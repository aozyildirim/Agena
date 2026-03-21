"""add task story mode and cost guardrail columns

Revision ID: 0008_story_guardrails
Revises: 0007_task_dependencies
Create Date: 2026-03-21
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '0008_story_guardrails'
down_revision = '0007_task_dependencies'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = {col['name'] for col in inspector.get_columns('task_records')}
    if 'story_context' not in existing:
        op.add_column('task_records', sa.Column('story_context', sa.Text(), nullable=True))
    if 'acceptance_criteria' not in existing:
        op.add_column('task_records', sa.Column('acceptance_criteria', sa.Text(), nullable=True))
    if 'edge_cases' not in existing:
        op.add_column('task_records', sa.Column('edge_cases', sa.Text(), nullable=True))
    if 'max_tokens' not in existing:
        op.add_column('task_records', sa.Column('max_tokens', sa.Integer(), nullable=True))
    if 'max_cost_usd' not in existing:
        op.add_column('task_records', sa.Column('max_cost_usd', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('task_records', 'max_cost_usd')
    op.drop_column('task_records', 'max_tokens')
    op.drop_column('task_records', 'edge_cases')
    op.drop_column('task_records', 'acceptance_criteria')
    op.drop_column('task_records', 'story_context')
