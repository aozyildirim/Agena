from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class RefinementRecord(Base):
    __tablename__ = 'refinement_records'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True)

    provider: Mapped[str] = mapped_column(String(32), index=True)
    external_item_id: Mapped[str] = mapped_column(String(128), index=True)
    sprint_ref: Mapped[str | None] = mapped_column(String(512), nullable=True)
    sprint_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    item_title: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    item_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    phase: Mapped[str] = mapped_column(String(32), default='analysis', index=True)  # analysis | writeback
    status: Mapped[str] = mapped_column(String(16), default='completed', index=True)  # completed | failed

    suggested_story_points: Mapped[int | None] = mapped_column(Integer, nullable=True)
    confidence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    estimation_rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    signature: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
