from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class NudgeHistory(Base):
    """One row per auto-nudge comment Agena posts on a blocked work item.

    Used for two things:
      1. Dedup: don't re-ping the same item over and over (48h cooldown by default).
      2. UI badge: show the user which blocked items have already been nudged.
    """

    __tablename__ = 'nudge_history'
    __table_args__ = (
        UniqueConstraint(
            'organization_id', 'provider', 'external_item_id', 'created_at',
            name='uq_nudge_history_org_item_ts',
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True)

    provider: Mapped[str] = mapped_column(String(16), index=True)  # 'azure' | 'jira'
    external_item_id: Mapped[str] = mapped_column(String(128), index=True)

    assignee: Mapped[str | None] = mapped_column(String(256), nullable=True)
    language: Mapped[str] = mapped_column(String(8), default='en')

    agent_provider: Mapped[str] = mapped_column(String(32), default='openai')
    agent_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    generated_by: Mapped[str | None] = mapped_column(String(128), nullable=True)

    comment_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_commenter: Mapped[str | None] = mapped_column(String(256), nullable=True)
    hours_silent: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
