from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class TaskShareToken(Base):
    """Time-limited, use-capped public token that lets a non-member
    read a task and import it into their own organization."""

    __tablename__ = 'task_share_tokens'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), index=True)
    task_id: Mapped[int] = mapped_column(ForeignKey('task_records.id', ondelete='CASCADE'), index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), nullable=True)

    # 32-byte urlsafe-base64 string. Indexed unique so token-only resolution stays O(1).
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)

    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    max_uses: Mapped[int] = mapped_column(Integer, default=3)
    use_count: Mapped[int] = mapped_column(Integer, default=0)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
