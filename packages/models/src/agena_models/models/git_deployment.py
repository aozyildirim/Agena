from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from agena_core.db.base import Base


class GitDeployment(Base):
    __tablename__ = 'git_deployments'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True)
    repo_mapping_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    provider: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    external_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    environment: Mapped[str] = mapped_column(String(64), default='production')
    status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    deployed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    sha: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    duration_sec: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    organization = relationship('Organization')

    __table_args__ = (
        UniqueConstraint('organization_id', 'repo_mapping_id', 'provider', 'external_id'),
    )
