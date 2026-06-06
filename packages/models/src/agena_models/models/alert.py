"""A raised production alert — a metric crossed a rule's threshold (or regressed
after a deploy). Phase 2: an alert can carry an AI-suggested fix and, on
approval, spawn a fix task that flows through the normal agent → PR pipeline.
The alert auto-resolves when the metric returns to baseline."""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, JSON, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class Alert(Base):
    __tablename__ = 'alerts'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    rule_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey('alert_rules.id', ondelete='SET NULL'), nullable=True,
    )
    source: Mapped[str] = mapped_column(String(16), nullable=False)          # newrelic | sentry
    metric_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_ref: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    entity_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    scope: Mapped[str] = mapped_column(String(255), default='overall')
    severity: Mapped[str] = mapped_column(String(16), default='high', index=True)  # critical|high|medium|low
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    # current value, baseline, pct_change, top offending transactions/queries,
    # linked deploy/PR, sample window, trigger ('rolling'|'deploy')
    detail: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default='open', index=True)  # open|acknowledged|resolved|suppressed
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    deploy_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey('git_deployments.id', ondelete='SET NULL'), nullable=True,
    )
    # Phase 2: AI-proposed remediation {summary, files, approach}
    suggested_fix: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    task_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey('task_records.id', ondelete='SET NULL'), nullable=True,
    )
    acknowledged_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey('users.id', ondelete='SET NULL'), nullable=True,
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
