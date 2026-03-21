"""add flow_runs, flow_run_steps and fix user_preferences

Revision ID: 0004_flow_runs
Revises: 0003_user_preferences
Create Date: 2026-03-21
"""

from alembic import op
import sqlalchemy as sa

revision = '0004_flow_runs'
down_revision = '0003_user_preferences'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # user_preferences'a eksik kolonları ekle (varsa atla)
    with op.batch_alter_table('user_preferences') as batch_op:
        batch_op.add_column(sa.Column('agents_json', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('flows_json', sa.Text(), nullable=True))

    op.create_table(
        'flow_runs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('flow_id', sa.String(255), nullable=False),
        sa.Column('flow_name', sa.String(255), nullable=False),
        sa.Column('task_id', sa.String(255), nullable=True),
        sa.Column('task_title', sa.Text(), nullable=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('started_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_flow_runs_user_id', 'flow_runs', ['user_id'])
    op.create_index('ix_flow_runs_flow_id', 'flow_runs', ['flow_id'])

    op.create_table(
        'flow_run_steps',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('run_id', sa.Integer(), sa.ForeignKey('flow_runs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('node_id', sa.String(255), nullable=False),
        sa.Column('node_type', sa.String(50), nullable=False),
        sa.Column('node_label', sa.String(255), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('input_json', sa.Text(), nullable=True),
        sa.Column('output_json', sa.Text(), nullable=True),
        sa.Column('error_msg', sa.Text(), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_flow_run_steps_run_id', 'flow_run_steps', ['run_id'])


def downgrade() -> None:
    op.drop_index('ix_flow_run_steps_run_id', table_name='flow_run_steps')
    op.drop_table('flow_run_steps')
    op.drop_index('ix_flow_runs_flow_id', table_name='flow_runs')
    op.drop_index('ix_flow_runs_user_id', table_name='flow_runs')
    op.drop_table('flow_runs')
    with op.batch_alter_table('user_preferences') as batch_op:
        batch_op.drop_column('flows_json')
        batch_op.drop_column('agents_json')
