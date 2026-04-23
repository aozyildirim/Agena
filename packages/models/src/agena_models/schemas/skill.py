from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SkillCreate(BaseModel):
    name: str
    description: str = ''
    pattern_type: str = 'other'
    tags: list[str] = Field(default_factory=list)
    touched_files: list[str] = Field(default_factory=list)
    approach_summary: str = ''
    prompt_fragment: str = ''
    source_task_id: int | None = None


class SkillUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    pattern_type: str | None = None
    tags: list[str] | None = None
    touched_files: list[str] | None = None
    approach_summary: str | None = None
    prompt_fragment: str | None = None


class SkillResponse(BaseModel):
    id: int
    organization_id: int
    source_task_id: int | None = None
    name: str
    description: str = ''
    pattern_type: str = 'other'
    tags: list[str] = Field(default_factory=list)
    touched_files: list[str] = Field(default_factory=list)
    approach_summary: str = ''
    prompt_fragment: str = ''
    usage_count: int = 0
    last_used_at: str | None = None
    created_at: str
    updated_at: str


class SkillHit(BaseModel):
    """A skill returned from vector search, with the relevance score."""
    id: int
    name: str
    description: str = ''
    pattern_type: str = 'other'
    tags: list[str] = Field(default_factory=list)
    touched_files: list[str] = Field(default_factory=list)
    approach_summary: str = ''
    prompt_fragment: str = ''
    score: float = 0.0
    tier: str = 'related'  # 'strong' | 'related' | 'weak'
    usage_count: int = 0
