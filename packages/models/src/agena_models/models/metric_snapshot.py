"""Periodic samples of production metrics (throughput, latency, error-rate,
DB time, apdex) pulled from New Relic / Sentry. The Sentinel service compares
these against rolling baselines and deploy windows to raise Alerts. This is the
"stage 0" the Insights/correlation engine never had — raw metric history."""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class MetricSnapshot(Base):
    __tablename__ = 'metric_snapshots'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    source: Mapped[str] = mapped_column(String(16), nullable=False)          # newrelic | sentry
    entity_ref: Mapped[str] = mapped_column(String(255), nullable=False, index=True)  # NR guid / app name / sentry project slug
    entity_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # throughput | latency_p95 | error_rate | db_time | apdex
    metric_kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    scope: Mapped[str] = mapped_column(String(255), default='overall')       # transaction name or 'overall'
    value: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)    # rpm | ms | pct | score | count
    sample_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    window_start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    window_end: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
