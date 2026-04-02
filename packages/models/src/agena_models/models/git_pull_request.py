from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from agena_core.db.base import Base


class GitPullRequest(Base):
    __tablename__ = 'git_pull_requests'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True)
    repo_mapping_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    provider: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    external_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    title: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    author: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    source_branch: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    target_branch: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at_ext: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    merged_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    additions: Mapped[int] = mapped_column(Integer, default=0)
    deletions: Mapped[int] = mapped_column(Integer, default=0)
    commits_count: Mapped[int] = mapped_column(Integer, default=0)
    review_comments: Mapped[int] = mapped_column(Integer, default=0)
    first_commit_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    organization = relationship('Organization')

    __table_args__ = (
        UniqueConstraint('organization_id', 'repo_mapping_id', 'provider', 'external_id'),
    )
