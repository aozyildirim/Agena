"""per-user session versioning

`token_version` is embedded in every access token as `ver`; bumping it
(password change, "sign out everywhere") invalidates all outstanding
tokens for that user at once. Tokens issued before this column existed
carry no `ver` and are read as 0, so nobody is signed out by the deploy.

Idempotent like 0081/0082.

Revision ID: 0083_user_sessions
Revises: 0082_api_keys
Create Date: 2026-10-08
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import context, op


revision = '0083_user_sessions'
down_revision = '0082_api_keys'
branch_labels = None
depends_on = None


def _existing_columns() -> set[str]:
    if context.is_offline_mode():
        return set()
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns('users')}


def upgrade() -> None:
    have = _existing_columns()
    if 'token_version' not in have:
        op.add_column('users', sa.Column('token_version', sa.Integer(), nullable=False, server_default='0'))
    if 'password_changed_at' not in have:
        op.add_column('users', sa.Column('password_changed_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'password_changed_at')
    op.drop_column('users', 'token_version')
