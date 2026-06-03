from __future__ import annotations

import secrets
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


def generate_invite_token() -> str:
    return secrets.token_urlsafe(24)


class WorkspaceInviteLink(Base):
    __tablename__ = 'workspace_invite_links'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey('workspaces.id', ondelete='CASCADE'), index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    role_id: Mapped[Optional[int]] = mapped_column(ForeignKey('workspace_roles.id', ondelete='SET NULL'), nullable=True)
    max_uses: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    uses: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
