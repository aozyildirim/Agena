from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class FlowSchedule(Base):
    """A cron schedule for one of a user's flows (flows live in
    UserPreference.flows_json, so a schedule points at the flow by id and
    runs as the user who created it).

    `next_run_at` is UTC and is the claim token: the worker advances it in
    a single conditional UPDATE, so two workers can never run the same
    tick. Missed ticks (worker down) are skipped, not replayed.
    """

    __tablename__ = 'flow_schedules'
    __table_args__ = (
        Index('ix_flow_schedules_due', 'enabled', 'next_run_at'),
        Index('ix_flow_schedules_org_user', 'organization_id', 'user_id'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'))
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))

    flow_id: Mapped[str] = mapped_column(String(64))
    flow_name: Mapped[str] = mapped_column(String(255))
    cron: Mapped[str] = mapped_column(String(120))
    timezone: Mapped[str] = mapped_column(String(64), default='UTC', server_default='UTC')
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default='1')
    # The `task` dict handed to run_flow; what the flow's trigger node sees.
    task_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    next_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_run_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    run_count: Mapped[int] = mapped_column(Integer, default=0, server_default='0')

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
