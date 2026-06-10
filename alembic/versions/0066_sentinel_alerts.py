"""Sentinel: proactive metric alerting (metric_snapshots, alert_rules, alerts)

Adds the "stage 0" the Insights/correlation engine never had: raw production
metric history (throughput, latency, error-rate, DB time, apdex) plus an
operator-defined rule engine and the alerts those rules raise.

Revision ID: 0066_sentinel_alerts
Revises: 0065_task_runtime_id
Create Date: 2026-06-06
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = '0066_sentinel_alerts'
down_revision = '0065_task_runtime_id'
branch_labels = None
depends_on = None


def _has_table(bind, table: str) -> bool:
    return inspect(bind).has_table(table)


def upgrade() -> None:
    bind = op.get_bind()

    if not _has_table(bind, 'metric_snapshots'):
        op.create_table(
            'metric_snapshots',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
            sa.Column('source', sa.String(16), nullable=False),
            sa.Column('entity_ref', sa.String(255), nullable=False),
            sa.Column('entity_name', sa.String(255), nullable=True),
            sa.Column('metric_kind', sa.String(32), nullable=False),
            sa.Column('scope', sa.String(255), nullable=False, server_default='overall'),
            sa.Column('value', sa.Float(), nullable=False),
            sa.Column('unit', sa.String(16), nullable=True),
            sa.Column('sample_count', sa.Integer(), nullable=True),
            sa.Column('window_start', sa.DateTime(), nullable=False),
            sa.Column('window_end', sa.DateTime(), nullable=False),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        )
        op.create_index('ix_metric_snapshots_organization_id', 'metric_snapshots', ['organization_id'])
        op.create_index('ix_metric_snapshots_entity_ref', 'metric_snapshots', ['entity_ref'])
        op.create_index('ix_metric_snapshots_metric_kind', 'metric_snapshots', ['metric_kind'])
        op.create_index('ix_metric_snapshots_window_end', 'metric_snapshots', ['window_end'])
        op.create_index('ix_metric_snapshots_lookup', 'metric_snapshots',
                        ['organization_id', 'entity_ref', 'metric_kind', 'scope', 'window_end'])

    if not _has_table(bind, 'alert_rules'):
        op.create_table(
            'alert_rules',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
            sa.Column('name', sa.String(160), nullable=False),
            sa.Column('source', sa.String(16), nullable=False, server_default='newrelic'),
            sa.Column('metric_kind', sa.String(32), nullable=False),
            sa.Column('scope_filter', sa.String(255), nullable=True),
            sa.Column('comparison', sa.String(24), nullable=False, server_default='pct_up'),
            sa.Column('threshold', sa.Float(), nullable=False, server_default='30'),
            sa.Column('min_samples', sa.Integer(), nullable=False, server_default='5'),
            sa.Column('baseline_mode', sa.String(16), nullable=False, server_default='both'),
            sa.Column('severity', sa.String(16), nullable=False, server_default='high'),
            sa.Column('repo_mapping_id', sa.Integer(), sa.ForeignKey('repo_mappings.id', ondelete='SET NULL'), nullable=True),
            sa.Column('auto_fix', sa.String(16), nullable=False, server_default='suggest'),
            sa.Column('cooldown_min', sa.Integer(), nullable=False, server_default='30'),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
        )
        op.create_index('ix_alert_rules_organization_id', 'alert_rules', ['organization_id'])

    if not _has_table(bind, 'alerts'):
        op.create_table(
            'alerts',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
            sa.Column('rule_id', sa.Integer(), sa.ForeignKey('alert_rules.id', ondelete='SET NULL'), nullable=True),
            sa.Column('source', sa.String(16), nullable=False),
            sa.Column('metric_kind', sa.String(32), nullable=False),
            sa.Column('entity_ref', sa.String(255), nullable=False),
            sa.Column('entity_name', sa.String(255), nullable=True),
            sa.Column('scope', sa.String(255), nullable=False, server_default='overall'),
            sa.Column('severity', sa.String(16), nullable=False, server_default='high'),
            sa.Column('title', sa.String(512), nullable=False),
            sa.Column('detail', sa.JSON(), nullable=True),
            sa.Column('status', sa.String(16), nullable=False, server_default='open'),
            sa.Column('fingerprint', sa.String(64), nullable=False),
            sa.Column('deploy_id', sa.Integer(), sa.ForeignKey('git_deployments.id', ondelete='SET NULL'), nullable=True),
            sa.Column('suggested_fix', sa.JSON(), nullable=True),
            sa.Column('task_id', sa.Integer(), sa.ForeignKey('task_records.id', ondelete='SET NULL'), nullable=True),
            sa.Column('acknowledged_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('note', sa.Text(), nullable=True),
            sa.Column('opened_at', sa.DateTime(), server_default=sa.func.now()),
            sa.Column('resolved_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
        )
        op.create_index('ix_alerts_organization_id', 'alerts', ['organization_id'])
        op.create_index('ix_alerts_entity_ref', 'alerts', ['entity_ref'])
        op.create_index('ix_alerts_severity', 'alerts', ['severity'])
        op.create_index('ix_alerts_status', 'alerts', ['status'])
        op.create_index('ix_alerts_fingerprint', 'alerts', ['fingerprint'])
        op.create_index('ix_alerts_opened_at', 'alerts', ['opened_at'])


def downgrade() -> None:
    bind = op.get_bind()
    for tbl in ('alerts', 'alert_rules', 'metric_snapshots'):
        if _has_table(bind, tbl):
            op.drop_table(tbl)
