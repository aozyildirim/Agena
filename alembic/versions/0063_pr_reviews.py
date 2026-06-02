"""pr_reviews: persist AI pull-request review runs

Backs the PR Reviewer page (live, sync-independent): each AI review of a PR
is recorded here so we can show history — which PR, when, by which agent,
findings/severity/score, and posted vs still-open inline threads.

Revision ID: 0063_pr_reviews
Revises: 0062_workspace_sprint_ctx
Create Date: 2026-06-02
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = '0063_pr_reviews'
down_revision = '0062_workspace_sprint_ctx'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if inspect(bind).has_table('pr_reviews'):
        return
    op.create_table(
        'pr_reviews',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('requested_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('provider', sa.String(length=16), nullable=False, index=True),
        sa.Column('repo_mapping_id', sa.Integer(), sa.ForeignKey('repo_mappings.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('repo', sa.String(length=255), nullable=False),
        sa.Column('pr_number', sa.String(length=64), nullable=False, index=True),
        sa.Column('pr_url', sa.String(length=1024), nullable=True),
        sa.Column('title', sa.String(length=512), nullable=True),
        sa.Column('reviewer_role', sa.String(length=64), nullable=True),
        sa.Column('reviewer_provider', sa.String(length=32), nullable=True),
        sa.Column('reviewer_model', sa.String(length=96), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='running', index=True),
        sa.Column('severity', sa.String(length=16), nullable=True),
        sa.Column('score', sa.Integer(), nullable=True),
        sa.Column('findings_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('threads_posted', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('threads_open', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('details', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), index=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if inspect(bind).has_table('pr_reviews'):
        op.drop_table('pr_reviews')
