from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class Skill(Base):
    """A reusable pattern extracted from a completed task. Agents pull the
    most relevant skills into their system prompt when a new task comes in,
    so previous solutions compound rather than getting lost."""

    __tablename__ = 'skills'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey('organizations.id', ondelete='CASCADE'), index=True
    )
    # Null when the skill was created manually or extracted from an external
    # source. Set on ON DELETE to null so deleting a task doesn't lose the
    # skill knowledge.
    source_task_id: Mapped[int | None] = mapped_column(
        ForeignKey('task_records.id', ondelete='SET NULL'), nullable=True, index=True
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )

    name: Mapped[str] = mapped_column(String(256), index=True)
    # MySQL TEXT columns don't accept DEFAULT values, so keep them nullable
    # at the schema level; application code treats None as empty string.
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # One of: 'fix-bug', 'refactor', 'add-feature', 'config', 'migration',
    # 'perf', 'test', 'docs', 'other'. Free text so users can add custom
    # buckets without a migration.
    pattern_type: Mapped[str] = mapped_column(String(48), default='other', index=True)
    # Free-form tags (language, framework, module names, etc.)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Files that were touched when this skill was first applied. Helps
    # surface skills relevant to files the new task mentions.
    touched_files: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Concise "how we solved it" summary that goes into agent prompts.
    approach_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Reusable prompt fragment — an agent sees this verbatim in its system
    # prompt when this skill is retrieved. Crafted to be generic.
    prompt_fragment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The Qdrant point id key used when upserting this skill's vector. We
    # derive it deterministically from skill id so re-embedding after edits
    # overwrites cleanly.
    qdrant_key: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)

    # Lifetime stats — bumped when the skill is retrieved above threshold
    # for a new task's context.
    usage_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
