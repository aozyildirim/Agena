"""An operator-defined rule that turns a metric movement into an Alert.

Example: "New Relic p95 latency on checkout-api up 30% vs baseline → high
severity, route fixes to repo X, suggest a fix (don't auto-merge)."

baseline_mode:
  rolling - compare current sample to the rolling baseline (same hour, last N days ± stddev)
  deploy  - compare a window after a deploy to the window before it
  both    - evaluate under both triggers
comparison:
  pct_up / pct_down - percent change vs baseline crosses `threshold` (e.g. 30 = +30%)
  abs_above / abs_below - raw value crosses `threshold` (e.g. p95 > 500ms)
  anomaly - value is more than `threshold` standard deviations from baseline
auto_fix:
  off     - alert only
  suggest - alert + AI-proposed fix, requires human approval to open a task
  auto    - open a fix task automatically
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class AlertRule(Base):
    __tablename__ = 'alert_rules'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    source: Mapped[str] = mapped_column(String(16), default='newrelic')       # newrelic | sentry | any
    metric_kind: Mapped[str] = mapped_column(String(32), nullable=False)      # throughput | latency_p95 | error_rate | db_time | apdex
    scope_filter: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # transaction name pattern; null = overall/all
    comparison: Mapped[str] = mapped_column(String(24), default='pct_up')     # pct_up|pct_down|abs_above|abs_below|anomaly
    threshold: Mapped[float] = mapped_column(Float, default=30.0)
    # Noise suppression: only fire when the current value also clears this
    # absolute floor (e.g. p95 > 200ms), and only after N consecutive breaches.
    min_abs: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    consecutive: Mapped[int] = mapped_column(Integer, default=1)
    min_samples: Mapped[int] = mapped_column(Integer, default=5)
    baseline_mode: Mapped[str] = mapped_column(String(16), default='both')    # rolling | deploy | both
    severity: Mapped[str] = mapped_column(String(16), default='high')
    repo_mapping_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey('repo_mappings.id', ondelete='SET NULL'), nullable=True,
    )
    auto_fix: Mapped[str] = mapped_column(String(16), default='suggest')      # off | suggest | auto
    cooldown_min: Mapped[int] = mapped_column(Integer, default=30)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
