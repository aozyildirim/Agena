from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from agena_core.db.base import Base


class TaskRecord(Base):
    __tablename__ = 'task_records'
    __table_args__ = (
        UniqueConstraint('organization_id', 'source', 'external_id', name='uq_task_org_source_external'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), index=True)
    workspace_id: Mapped[int | None] = mapped_column(ForeignKey('workspaces.id', ondelete='SET NULL'), nullable=True, index=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    source: Mapped[str] = mapped_column(String(32), default='internal', index=True)
    external_id: Mapped[str] = mapped_column(String(128))
    title: Mapped[str] = mapped_column(String(512))
    description: Mapped[str] = mapped_column(Text)
    story_context: Mapped[str | None] = mapped_column(Text, nullable=True)
    acceptance_criteria: Mapped[str | None] = mapped_column(Text, nullable=True)
    edge_cases: Mapped[str | None] = mapped_column(Text, nullable=True)
    max_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(64), default='queued', index=True)
    branch_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pr_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    repo_mapping_id: Mapped[int | None] = mapped_column(ForeignKey('repo_mappings.id', ondelete='SET NULL'), nullable=True, index=True)
    last_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    priority: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    fixability_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_unhandled: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    substatus: Mapped[str | None] = mapped_column(String(32), nullable=True)
    first_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    occurrences: Mapped[int | None] = mapped_column(Integer, nullable=True)
    external_work_item_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    sprint_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sprint_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    imported_from_share_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # The original assignee on the source platform (Azure DevOps
    # ``System.AssignedTo`` displayName / Jira assignee). Distinct from
    # ``created_by_user_id`` which is the Agena user that imported the
    # task — they can be different humans entirely.
    assigned_to: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    # JSON-encoded list of tag strings; populated by the IntegrationRule
    # engine on import (e.g. ['security_review']) and surfaced as pills /
    # filters in the UI.
    tags_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    organization = relationship('Organization', back_populates='tasks')
