"""add task story mode and cost guardrail columns

Revision ID: 0008_task_story_and_cost_guardrails
Revises: 0007_task_dependencies
Create Date: 2026-03-21
"""

from alembic import op
import sqlalchemy as sa

revision = '0008_task_story_and_cost_guardrails'
down_revision = '0007_task_dependencies'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('task_records', sa.Column('story_context', sa.Text(), nullable=True))
    op.add_column('task_records', sa.Column('acceptance_criteria', sa.Text(), nullable=True))
    op.add_column('task_records', sa.Column('edge_cases', sa.Text(), nullable=True))
    op.add_column('task_records', sa.Column('max_tokens', sa.Integer(), nullable=True))
    op.add_column('task_records', sa.Column('max_cost_usd', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('task_records', 'max_cost_usd')
    op.drop_column('task_records', 'max_tokens')
    op.drop_column('task_records', 'edge_cases')
    op.drop_column('task_records', 'acceptance_criteria')
    op.drop_column('task_records', 'story_context')
