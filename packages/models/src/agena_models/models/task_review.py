from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class TaskReview(Base):
    """A code-review record produced by a reviewer agent against a task.
    Distinct from refinement (which is story-point estimation): a review is
    a no-mutation pass over the diff / PR / repo by the configured reviewer
    persona, output is markdown findings + a numeric score, no code changes
    are written and no PR is opened."""

    __tablename__ = 'task_reviews'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), index=True)
    task_id: Mapped[int] = mapped_column(ForeignKey('task_records.id', ondelete='CASCADE'), index=True)
    # Set when the review covers a specific repo on a multi-repo task.
    # None = legacy single-repo review (uses task.pr_url directly). Each
    # assignment gets its own row so the list page can show a per-repo
    # verdict instead of a single "task-level" one.
    assignment_id: Mapped[int | None] = mapped_column(ForeignKey('task_repo_assignments.id', ondelete='SET NULL'), nullable=True, index=True)
    requested_by_user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)

    # Reviewer identity. We capture both the agent role string (so we can
    # group by persona — reviewer / security_developer / qa) and the
    # provider/model that actually ran, for telemetry.
    reviewer_agent_role: Mapped[str] = mapped_column(String(64), index=True)
    reviewer_provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reviewer_model: Mapped[str | None] = mapped_column(String(96), nullable=True)

    # Snapshot of what the reviewer was looking at (PR url, branch, file count,
    # diff lines added/removed). Stored as freeform text so we don't lock in
    # a schema; the UI renders it as a small kv block.
    input_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Markdown output from the reviewer.
    output: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Numeric verdict.
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    findings_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    severity: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)  # critical / high / medium / low / clean

    status: Mapped[str] = mapped_column(String(16), default='pending', index=True)  # pending / running / completed / failed
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
