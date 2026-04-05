from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class TaskRepoAssignment(Base):
    """Links a task to one or more repo mappings for multi-repo orchestration.

    Each assignment tracks its own execution status, PR URL, and branch name,
    enabling a single task to produce PRs in multiple repositories.
    """
    __tablename__ = 'task_repo_assignments'
    __table_args__ = (
        UniqueConstraint('task_id', 'repo_mapping_id', name='uq_task_repo_assignment'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey('task_records.id', ondelete='CASCADE'), index=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), index=True)
    repo_mapping_id: Mapped[int] = mapped_column(ForeignKey('repo_mappings.id', ondelete='SET NULL'), index=True)
    status: Mapped[str] = mapped_column(String(64), default='pending', index=True)
    pr_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    branch_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    run_record_id: Mapped[int | None] = mapped_column(ForeignKey('run_records.id', ondelete='SET NULL'), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
