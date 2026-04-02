from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class Invite(Base):
    __tablename__ = 'invites'
    __table_args__ = (
        # Prevent duplicate invites for same email in same org
        {'mysql_engine': 'InnoDB'},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), index=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    token: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default='pending')
    invited_by: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
