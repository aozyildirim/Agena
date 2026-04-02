from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class TaskDependency(Base):
    __tablename__ = 'task_dependencies'
    __table_args__ = (
        UniqueConstraint('organization_id', 'task_id', 'depends_on_task_id', name='uq_task_dependency'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), index=True)
    task_id: Mapped[int] = mapped_column(ForeignKey('task_records.id', ondelete='CASCADE'), index=True)
    depends_on_task_id: Mapped[int] = mapped_column(ForeignKey('task_records.id', ondelete='CASCADE'), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
