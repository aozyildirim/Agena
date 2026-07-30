"""BR Management — attachments on a conversational intake

Business people describe a request with a screenshot far more readily than
with prose. Files are stored on disk (like task attachments) and uploaded to
the Azure work item on submit.

Revision ID: 0079_br_intake_attach
Revises: 0078_br_prompt_resync
Create Date: 2026-07-30
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0079_br_intake_attach'
down_revision = '0078_br_prompt_resync'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'business_request_intake_attachments',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('intake_id', sa.Integer(), nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=False),
        sa.Column('uploaded_by_user_id', sa.Integer(), nullable=True),
        sa.Column('filename', sa.String(length=512), nullable=False),
        sa.Column('content_type', sa.String(length=128), nullable=False,
                  server_default='application/octet-stream'),
        sa.Column('size_bytes', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('storage_path', sa.String(length=1024), nullable=False),
        sa.Column('azure_url', sa.String(length=1024), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['intake_id'], ['business_request_intakes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_br_intake_attach_intake', 'business_request_intake_attachments', ['intake_id']
    )
    op.create_index(
        'ix_br_intake_attach_org', 'business_request_intake_attachments', ['organization_id']
    )


def downgrade() -> None:
    op.drop_index('ix_br_intake_attach_org', table_name='business_request_intake_attachments')
    op.drop_index('ix_br_intake_attach_intake', table_name='business_request_intake_attachments')
    op.drop_table('business_request_intake_attachments')
