from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class SentryProjectMapping(Base):
    """Maps a Sentry project to an Agena repo mapping for import flow."""

    __tablename__ = 'sentry_project_mappings'
    __table_args__ = (
        UniqueConstraint('organization_id', 'project_slug', name='uq_org_sentry_project'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), index=True)
    project_slug: Mapped[str] = mapped_column(String(255), index=True)
    project_name: Mapped[str] = mapped_column(String(512))
    repo_mapping_id: Mapped[int | None] = mapped_column(ForeignKey('repo_mappings.id', ondelete='SET NULL'), nullable=True, index=True)
    flow_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    auto_import: Mapped[bool] = mapped_column(Boolean, default=False)
    import_interval_minutes: Mapped[int] = mapped_column(Integer, default=60)
    last_import_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
