"""BR Management — conversational intake (chat) sessions

Business users describe a request in chat; the AI interviews them and
maintains a live Decision Pack + readiness score. Submittable to Azure
DevOps once the score clears the gate.

Revision ID: 0075_br_intake
Revises: 0074_br_auto_eval
Create Date: 2026-07-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0075_br_intake'
down_revision = '0074_br_auto_eval'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'business_request_intakes',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=False),
        sa.Column('created_by_user_id', sa.Integer(), nullable=True),
        sa.Column('title', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='draft'),
        sa.Column('messages', sa.JSON(), nullable=True),
        sa.Column('checklist', sa.JSON(), nullable=True),
        sa.Column('pack_markdown', sa.Text(), nullable=True),
        sa.Column('br_type', sa.String(length=16), nullable=True),
        sa.Column('readiness_score', sa.Integer(), nullable=True),
        sa.Column('azure_work_item_id', sa.String(length=64), nullable=True),
        sa.Column('azure_url', sa.String(length=1024), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_business_request_intakes_organization_id',
        'business_request_intakes', ['organization_id'],
    )


def downgrade() -> None:
    op.drop_index(
        'ix_business_request_intakes_organization_id',
        table_name='business_request_intakes',
    )
    op.drop_table('business_request_intakes')
