from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, SmallInteger, String, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class AuditLog(Base):
    """One row per state-changing request (or explicit auth event) made by
    an organization's members: who, what, on which resource, from where.

    Written by ``AuditMiddleware``. Request bodies are never stored, so the
    PATs and passwords that pass through integration endpoints cannot end
    up here. Actor email/role are snapshots — users get deleted, rows
    don't.
    """

    __tablename__ = 'audit_logs'
    __table_args__ = (
        Index('ix_audit_logs_org_created', 'organization_id', 'created_at'),
        Index('ix_audit_logs_org_action', 'organization_id', 'action'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'))
    workspace_id: Mapped[int | None] = mapped_column(ForeignKey('workspaces.id', ondelete='SET NULL'), nullable=True)

    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    actor_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    actor_role: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # `<area>.<endpoint>`, e.g. `tasks.assign_task` — see audit_actions.derive_action.
    action: Mapped[str] = mapped_column(String(96))
    method: Mapped[str] = mapped_column(String(8))
    path: Mapped[str] = mapped_column(String(512))
    # Matched path template (`/tasks/{task_id}/assign`); None for explicit events.
    route: Mapped[str | None] = mapped_column(String(255), nullable=True)
    target_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status_code: Mapped[int] = mapped_column(SmallInteger, default=0)

    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Path params, redacted query string, and whatever explicit callers add.
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
