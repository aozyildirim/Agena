from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class RepoMapping(Base):
    """Organization-level repository mapping for multi-repo orchestration."""
    __tablename__ = 'repo_mappings'
    __table_args__ = (
        UniqueConstraint('organization_id', 'provider', 'owner', 'repo_name', name='uq_org_repo_mapping'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), index=True)
    workspace_id: Mapped[int | None] = mapped_column(ForeignKey('workspaces.id', ondelete='SET NULL'), nullable=True, index=True)
    provider: Mapped[str] = mapped_column(String(32), index=True)  # github, azure
    owner: Mapped[str] = mapped_column(String(255))  # GitHub org/user or Azure project
    repo_name: Mapped[str] = mapped_column(String(255))
    base_branch: Mapped[str] = mapped_column(String(255), default='main')
    local_repo_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    playbook: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
