"""add notification_records table

Revision ID: 0010_notification_records
Revises: 0009_profile_settings_json
Create Date: 2026-03-22 09:40:00
"""

from alembic import op
import sqlalchemy as sa


revision = '0010_notification_records'
down_revision = '0009_profile_settings_json'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'notification_records',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('task_id', sa.Integer(), nullable=True),
        sa.Column('event_type', sa.String(length=64), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('severity', sa.String(length=16), nullable=False, server_default='info'),
        sa.Column('is_read', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('payload_json', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('read_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['task_id'], ['task_records.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_notification_records_organization_id', 'notification_records', ['organization_id'])
    op.create_index('ix_notification_records_user_id', 'notification_records', ['user_id'])
    op.create_index('ix_notification_records_task_id', 'notification_records', ['task_id'])
    op.create_index('ix_notification_records_event_type', 'notification_records', ['event_type'])
    op.create_index('ix_notification_records_is_read', 'notification_records', ['is_read'])
    op.create_index('ix_notification_records_created_at', 'notification_records', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_notification_records_created_at', table_name='notification_records')
    op.drop_index('ix_notification_records_is_read', table_name='notification_records')
    op.drop_index('ix_notification_records_event_type', table_name='notification_records')
    op.drop_index('ix_notification_records_task_id', table_name='notification_records')
    op.drop_index('ix_notification_records_user_id', table_name='notification_records')
    op.drop_index('ix_notification_records_organization_id', table_name='notification_records')
    op.drop_table('notification_records')
