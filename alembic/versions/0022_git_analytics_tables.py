"""create git analytics tables (commits, pull requests, deployments)

Revision ID: 0022_git_analytics_tables
Revises: 0021_invite_invited_by
Create Date: 2026-03-26 12:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = '0022_git_analytics_tables'
down_revision = '0021_invite_invited_by'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = bind.dialect.get_table_names(bind)
    if 'git_commits' in existing and 'git_pull_requests' in existing and 'git_deployments' in existing:
        return  # tables already exist, skip

    op.create_table(
        'git_commits',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('repo_mapping_id', sa.String(64), nullable=False, index=True),
        sa.Column('sha', sa.String(64), nullable=False),
        sa.Column('author_name', sa.String(255), nullable=True),
        sa.Column('author_email', sa.String(255), nullable=True),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('committed_at', sa.DateTime(), nullable=False),
        sa.Column('additions', sa.Integer(), default=0),
        sa.Column('deletions', sa.Integer(), default=0),
        sa.Column('files_changed', sa.Integer(), default=0),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint('organization_id', 'repo_mapping_id', 'sha'),
    )

    op.create_table(
        'git_pull_requests',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('repo_mapping_id', sa.String(64), nullable=False, index=True),
        sa.Column('provider', sa.String(32), nullable=True),
        sa.Column('external_id', sa.String(64), nullable=True),
        sa.Column('title', sa.String(512), nullable=True),
        sa.Column('author', sa.String(255), nullable=True),
        sa.Column('status', sa.String(32), nullable=True),
        sa.Column('source_branch', sa.String(255), nullable=True),
        sa.Column('target_branch', sa.String(255), nullable=True),
        sa.Column('created_at_ext', sa.DateTime(), nullable=True),
        sa.Column('merged_at', sa.DateTime(), nullable=True),
        sa.Column('closed_at', sa.DateTime(), nullable=True),
        sa.Column('additions', sa.Integer(), default=0),
        sa.Column('deletions', sa.Integer(), default=0),
        sa.Column('commits_count', sa.Integer(), default=0),
        sa.Column('review_comments', sa.Integer(), default=0),
        sa.Column('first_commit_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint('organization_id', 'repo_mapping_id', 'provider', 'external_id'),
    )

    op.create_table(
        'git_deployments',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('repo_mapping_id', sa.String(64), nullable=False, index=True),
        sa.Column('provider', sa.String(32), nullable=True),
        sa.Column('external_id', sa.String(128), nullable=True),
        sa.Column('environment', sa.String(64), default='production'),
        sa.Column('status', sa.String(32), nullable=True),
        sa.Column('deployed_at', sa.DateTime(), nullable=False),
        sa.Column('sha', sa.String(64), nullable=True),
        sa.Column('duration_sec', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint('organization_id', 'repo_mapping_id', 'provider', 'external_id'),
    )


def downgrade() -> None:
    op.drop_table('git_deployments')
    op.drop_table('git_pull_requests')
    op.drop_table('git_commits')
