from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class ApiKey(Base):
    """A long-lived credential for the SDK and automation, scoped to one
    organization and acting as the member who created it (never above their
    role, never above admin). Only the SHA-256 of the key is stored; the
    plaintext is shown once at creation.
    """

    __tablename__ = 'api_keys'
    __table_args__ = (
        Index('ix_api_keys_org_created', 'organization_id', 'created_at'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'))
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), nullable=True)

    name: Mapped[str] = mapped_column(String(120))
    # `agena_` + 8 chars, enough to recognise a key in a list or a log.
    key_prefix: Mapped[str] = mapped_column(String(16))
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(16), default='member')

    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    @property
    def status(self) -> str:
        if self.revoked_at is not None:
            return 'revoked'
        if self.expires_at is not None and self.expires_at <= datetime.utcnow():
            return 'expired'
        return 'active'
