"""workspaces: per-workspace repos + active sprint + active flag

Adds the data a workspace (a team) needs to own its delivery context:
  1. ``workspaces.is_active`` — on/off toggle (inactive workspaces are kept
     but de-emphasized in the UI).
  2. ``workspaces.sprint_provider`` / ``workspaces.sprint_path`` — the
     workspace's active sprint (Azure path or Jira sprint id).
  3. ``workspace_repos`` join table — the repos the team is responsible for,
     selected from the org's RepoMappings.

Revision ID: 0061_workspace_repos_sprint_active
Revises: 0060_triage_cap_and_optin
Create Date: 2026-06-02
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = '0061_workspace_delivery'
down_revision = '0060_triage_cap_and_optin'
branch_labels = None
depends_on = None


def _has_column(bind, table: str, col: str) -> bool:
    insp = inspect(bind)
    if not insp.has_table(table):
        return False
    return any(c['name'] == col for c in insp.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not _has_column(bind, 'workspaces', 'is_active'):
        op.add_column('workspaces', sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'))
    if not _has_column(bind, 'workspaces', 'sprint_provider'):
        op.add_column('workspaces', sa.Column('sprint_provider', sa.String(length=16), nullable=True))
    if not _has_column(bind, 'workspaces', 'sprint_path'):
        op.add_column('workspaces', sa.Column('sprint_path', sa.String(length=512), nullable=True))

    if not insp.has_table('workspace_repos'):
        op.create_table(
            'workspace_repos',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('workspace_id', sa.Integer(), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('repo_mapping_id', sa.Integer(), sa.ForeignKey('repo_mappings.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.UniqueConstraint('workspace_id', 'repo_mapping_id', name='uq_workspace_repo'),
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if insp.has_table('workspace_repos'):
        op.drop_table('workspace_repos')
    for col in ('sprint_path', 'sprint_provider', 'is_active'):
        if _has_column(bind, 'workspaces', col):
            op.drop_column('workspaces', col)
