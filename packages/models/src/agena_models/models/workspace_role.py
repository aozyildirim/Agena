"""Org-level role catalog with custom permission sets.

A workspace member's role_id points at a row here. Built-in roles
(owner/admin/member/viewer) are seeded for every org and cannot be
deleted; their permission lists may be tweaked by the org owner. Custom
roles ("Tech Lead", "Senior Dev", "QA Lead") are added by the org owner
and live alongside the built-ins.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class WorkspaceRole(Base):
    __tablename__ = 'workspace_roles'
    __table_args__ = (UniqueConstraint('organization_id', 'name', name='uq_workspace_role_name'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), index=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # JSON-encoded list of permission keys (e.g. ["tasks:create", "code:write"]).
    permissions_json: Mapped[str] = mapped_column(Text, default='[]')
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_default_for_new_members: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
