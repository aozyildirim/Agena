from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from agena_core.db.base import Base


class GitCommit(Base):
    __tablename__ = 'git_commits'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True)
    repo_mapping_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    sha: Mapped[str] = mapped_column(String(64), nullable=False)
    author_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    author_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    committed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    additions: Mapped[int] = mapped_column(Integer, default=0)
    deletions: Mapped[int] = mapped_column(Integer, default=0)
    files_changed: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    organization = relationship('Organization')

    __table_args__ = (
        UniqueConstraint('organization_id', 'repo_mapping_id', 'sha'),
    )
