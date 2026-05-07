"""add workspace_invite_links table

Token-based shareable invite links for workspaces. Distinct from the
existing email-based ``invites`` table (which targets a specific recipient
inside an org). These links can pre-bind a ``role_id`` and optionally cap
``max_uses`` / ``expires_at`` for safer external sharing.

Revision ID: 0059_workspace_invite_links
Revises: 0058_workspace_roles
Create Date: 2026-05-06
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0059_workspace_invite_links'
down_revision = '0058_workspace_roles'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'workspace_invite_links',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('workspace_id', sa.Integer, sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('token', sa.String(64), nullable=False, unique=True, index=True),
        sa.Column('role_id', sa.Integer, sa.ForeignKey('workspace_roles.id', ondelete='SET NULL'), nullable=True),
        sa.Column('max_uses', sa.Integer, nullable=True),
        sa.Column('uses', sa.Integer, nullable=False, server_default='0'),
        sa.Column('expires_at', sa.DateTime, nullable=True),
        sa.Column('revoked_at', sa.DateTime, nullable=True),
        sa.Column('created_by_user_id', sa.Integer, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('workspace_invite_links')
