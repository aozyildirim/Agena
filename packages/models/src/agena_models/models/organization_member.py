from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from agena_core.db.base import Base


class OrganizationMember(Base):
    __tablename__ = 'organization_members'
    __table_args__ = (UniqueConstraint('organization_id', 'user_id', name='uq_org_member'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'))
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    role: Mapped[str] = mapped_column(String(32), default='member')
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    organization = relationship('Organization', back_populates='members')
    user = relationship('User', back_populates='org_memberships')
