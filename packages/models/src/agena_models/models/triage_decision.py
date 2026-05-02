"""TriageDecision — one row per stale Jira/Azure ticket the triage
poller has examined. Stores the AI's verdict and the user's eventual
action so we have an audit trail."""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from agena_core.db.base import Base


class TriageDecision(Base):
    __tablename__ = 'triage_decisions'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True,
    )
    # Nullable: source-side triage produces decisions for tickets that
    # have never been imported into AGENA's task_records.
    task_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey('task_records.id', ondelete='CASCADE'), nullable=True,
    )
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    external_id: Mapped[str] = mapped_column(String(128), nullable=False)
    ticket_title: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    ticket_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    # ISO timestamp from the source platform's "updated" field at the
    # time we last evaluated this ticket. Lets the scan loop skip the
    # LLM call when the ticket hasn't moved since our last verdict.
    source_updated_at: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    idle_days: Mapped[int] = mapped_column(Integer, default=0)

    ai_verdict: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    ai_confidence: Mapped[int] = mapped_column(Integer, default=0)
    ai_reasoning: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(String(32), default='pending', index=True)
    applied_verdict: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    applied_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    applied_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey('users.id', ondelete='SET NULL'), nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    organization = relationship('Organization')
    task = relationship('TaskRecord')
    applied_by = relationship('User', foreign_keys=[applied_by_user_id])
