from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class PrReview(Base):
    """An AI code-review run against a pull request (not an Agena task).

    The PR Reviewer fetches a PR's diff LIVE from the provider (Azure / GitHub
    — no dependency on the backlog sync table), has the org's reviewer agent
    evaluate the changed lines, and posts inline discussion threads on the PR.
    Each run is persisted here so the PR Reviewer page can show history:
    which PR was reviewed, when, by which agent, how many findings of what
    severity, and how many inline threads are still open vs resolved.
    """

    __tablename__ = 'pr_reviews'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), index=True)
    requested_by_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True)

    # Which PR. provider is 'azure' | 'github'. repo + pr_number identify it;
    # pr_url is the human-facing link. repo_mapping_id is set when the PR was
    # reached via a known org repo mapping (null for paste-a-URL reviews).
    provider: Mapped[str] = mapped_column(String(16), index=True)
    repo_mapping_id: Mapped[int | None] = mapped_column(ForeignKey('repo_mappings.id', ondelete='SET NULL'), nullable=True, index=True)
    repo: Mapped[str] = mapped_column(String(255))
    pr_number: Mapped[str] = mapped_column(String(64), index=True)
    pr_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    title: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Reviewer agent that ran (resolved from org default settings).
    reviewer_role: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewer_provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reviewer_model: Mapped[str | None] = mapped_column(String(96), nullable=True)

    # 'running' | 'completed' | 'failed'
    status: Mapped[str] = mapped_column(String(16), default='running', index=True)
    # Highest severity among posted findings: critical/high/medium/low/clean.
    severity: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # 0-100 readiness score from the reviewer.
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    findings_count: Mapped[int] = mapped_column(Integer, default=0)
    # Inline threads we posted, and how many of them are still open (not
    # resolved on the provider). Refreshed when the page reloads.
    threads_posted: Mapped[int] = mapped_column(Integer, default=0)
    threads_open: Mapped[int] = mapped_column(Integer, default=0)

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Freeform JSON-ish snapshot (findings summary, diff stats) for the UI.
    details: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
