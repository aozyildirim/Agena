from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class TeamMemberType(Base):
    """Org-level product/developer classification for a sprint team member.

    Members come from external providers (Azure/Jira/YouTrack) and carry no
    role field, so we persist the classification here keyed by org + email
    (the member's uniqueName). `member_type` is the resolved bucket and
    `source` records whether it was auto-derived from assigned work-item
    types or manually overridden by a user. A manual override always wins
    over a later auto pass.

    This is the foundation the upcoming "business requests" feature queries
    against — e.g. "fetch business requests owned by product members" or
    "tasks assigned to developers" — via assigned_to + member_type.
    """

    __tablename__ = 'team_member_types'
    __table_args__ = (
        UniqueConstraint('organization_id', 'email', name='uq_team_member_type'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey('organizations.id', ondelete='CASCADE'), index=True
    )
    # Member's uniqueName / email — the stable cross-page identifier.
    email: Mapped[str] = mapped_column(String(320))
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Which provider the member was last seen under (informational).
    provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 'product' | 'developer'
    member_type: Mapped[str] = mapped_column(String(16))
    # 'auto' | 'manual' — manual override survives later auto passes.
    source: Mapped[str] = mapped_column(String(16), default='manual')
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
