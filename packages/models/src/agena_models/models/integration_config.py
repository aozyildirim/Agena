from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class IntegrationConfig(Base):
    __tablename__ = 'integration_configs'
    __table_args__ = (UniqueConstraint('organization_id', 'provider', name='uq_org_provider_integration'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), index=True)
    provider: Mapped[str] = mapped_column(String(32), index=True)
    base_url: Mapped[str] = mapped_column(String(512))
    project: Mapped[str | None] = mapped_column(String(255), nullable=True)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    secret: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
