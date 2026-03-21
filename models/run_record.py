from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


class RunRecord(Base):
    __tablename__ = 'run_records'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey('task_records.id', ondelete='CASCADE'), index=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), index=True)
    source: Mapped[str] = mapped_column(String(32), index=True)
    spec: Mapped[dict] = mapped_column(JSON)
    generated_code: Mapped[str] = mapped_column(Text)
    reviewed_code: Mapped[str] = mapped_column(Text)
    usage_prompt_tokens: Mapped[float] = mapped_column(Float, default=0)
    usage_completion_tokens: Mapped[float] = mapped_column(Float, default=0)
    usage_total_tokens: Mapped[float] = mapped_column(Float, default=0)
    estimated_cost_usd: Mapped[float] = mapped_column(Float, default=0)
    pr_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
