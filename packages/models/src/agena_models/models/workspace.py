from __future__ import annotations

import secrets
import string
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from agena_core.db.base import Base


def generate_invite_code(length: int = 6) -> str:
    """Generate a short uppercase alphanumeric invite code."""
    alphabet = string.ascii_uppercase + string.digits
    # Avoid ambiguous chars: O, 0, I, 1
    alphabet = ''.join(c for c in alphabet if c not in 'O0I1')
    return ''.join(secrets.choice(alphabet) for _ in range(length))


class Workspace(Base):
    __tablename__ = 'workspaces'
    __table_args__ = (UniqueConstraint('organization_id', 'slug', name='uq_workspace_org_slug'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), index=True)
    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    invite_code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    members = relationship('WorkspaceMember', back_populates='workspace', cascade='all, delete-orphan')


class WorkspaceMember(Base):
    __tablename__ = 'workspace_members'
    __table_args__ = (UniqueConstraint('workspace_id', 'user_id', name='uq_workspace_member'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey('workspaces.id', ondelete='CASCADE'), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    role: Mapped[str] = mapped_column(String(32), default='member')
    title: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    workspace = relationship('Workspace', back_populates='members')
