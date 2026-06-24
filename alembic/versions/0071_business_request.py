"""BR Management — settings + evaluation tables, seed module

Adds business_request_settings (org BR config: emails, rubric, epic rule)
and business_request_evals (per-item AI classification + readiness + Q&A),
and seeds the toggleable `br_management` module (default off).

Revision ID: 0071_business_request
Revises: 0070_team_member_types
Create Date: 2026-06-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = '0071_business_request'
down_revision = '0070_team_member_types'
branch_labels = None
depends_on = None


MODULE = {
    'slug': 'br_management',
    'name': 'BR Management',
    'description': 'Evaluate business requests on your BR team — classify Improvement vs Epic, score readiness, and run an AI Q&A loop to close gaps.',
    'icon': '📋',
    'sort_order': 26,
}


def upgrade() -> None:
    op.create_table(
        'business_request_settings',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=False),
        sa.Column('br_emails', sa.JSON(), nullable=True),
        sa.Column('rubric', sa.Text(), nullable=True),
        sa.Column('epic_rule', sa.Text(), nullable=True),
        sa.Column('auto_eval', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('provider', sa.String(length=32), nullable=True),
        sa.Column('model', sa.String(length=128), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization_id', name='uq_br_settings_org'),
    )
    op.create_index(
        'ix_business_request_settings_organization_id',
        'business_request_settings', ['organization_id'],
    )

    op.create_table(
        'business_request_evals',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=False),
        sa.Column('source', sa.String(length=32), nullable=False),
        sa.Column('external_id', sa.String(length=128), nullable=False),
        sa.Column('assignee_email', sa.String(length=320), nullable=True),
        sa.Column('title', sa.Text(), nullable=True),
        sa.Column('br_type', sa.String(length=16), nullable=True),
        sa.Column('readiness_score', sa.Integer(), nullable=True),
        sa.Column('verdict', sa.String(length=16), nullable=True),
        sa.Column('reasoning', sa.Text(), nullable=True),
        sa.Column('questions', sa.JSON(), nullable=True),
        sa.Column('answers', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization_id', 'source', 'external_id', name='uq_br_eval_item'),
    )
    op.create_index(
        'ix_business_request_evals_organization_id',
        'business_request_evals', ['organization_id'],
    )

    # Seed the toggleable module (default off, like triage/review_backlog).
    conn = op.get_bind()
    existing = conn.execute(
        sa.text('SELECT id FROM modules WHERE slug = :slug'), {'slug': MODULE['slug']}
    ).scalar_one_or_none()
    if not existing:
        conn.execute(
            sa.text(
                'INSERT INTO modules (slug, name, description, icon, is_core, default_enabled, sort_order) '
                'VALUES (:slug, :name, :description, :icon, 0, 0, :sort_order)'
            ),
            MODULE,
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text('DELETE FROM modules WHERE slug = :slug'), {'slug': MODULE['slug']})
    conn.execute(
        sa.text('DELETE FROM organization_modules WHERE module_slug = :slug'),
        {'slug': MODULE['slug']},
    )
    op.drop_index('ix_business_request_evals_organization_id', table_name='business_request_evals')
    op.drop_table('business_request_evals')
    op.drop_index('ix_business_request_settings_organization_id', table_name='business_request_settings')
    op.drop_table('business_request_settings')
