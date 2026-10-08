from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class WebhookEndpoint(Base):
    """A customer URL that receives signed POSTs for the organization's
    events. The secret is stored in clear because every delivery is signed
    with it; it is shown once at creation and can be rotated."""

    __tablename__ = 'webhook_endpoints'
    __table_args__ = (Index('ix_webhook_endpoints_org_enabled', 'organization_id', 'enabled'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'))
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), nullable=True)

    name: Mapped[str] = mapped_column(String(120))
    url: Mapped[str] = mapped_column(String(1024))
    secret: Mapped[str] = mapped_column(String(128))
    # Event types to send; ['*'] for everything, prefixes like 'task_*' allowed.
    events: Mapped[list | None] = mapped_column(JSON, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default='1')

    # Consecutive failed deliveries; reset on success, auto-disable past a cap.
    failure_count: Mapped[int] = mapped_column(Integer, default=0, server_default='0')
    last_delivery_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_status: Mapped[str | None] = mapped_column(String(16), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class WebhookDelivery(Base):
    """One attempt-tracked delivery of one event to one endpoint."""

    __tablename__ = 'webhook_deliveries'
    __table_args__ = (
        Index('ix_webhook_deliveries_due', 'status', 'next_attempt_at'),
        Index('ix_webhook_deliveries_endpoint_created', 'endpoint_id', 'created_at'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'))
    endpoint_id: Mapped[int] = mapped_column(ForeignKey('webhook_endpoints.id', ondelete='CASCADE'))

    event_type: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # pending → sending → delivered | failed
    status: Mapped[str] = mapped_column(String(16), default='pending', server_default='pending')
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default='0')
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
