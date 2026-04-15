from __future__ import annotations

from pydantic import BaseModel


class SentryIssueItem(BaseModel):
    id: str
    short_id: str | None = None
    title: str
    level: str
    status: str | None = None
    culprit: str | None = None
    count: int = 0
    user_count: int = 0
    last_seen: str | None = None
    permalink: str | None = None


class SentryIssueListResponse(BaseModel):
    organization_slug: str
    project_slug: str
    issues: list[SentryIssueItem] = []


class SentryProjectItem(BaseModel):
    slug: str
    name: str


class SentryProjectListResponse(BaseModel):
    organization_slug: str
    projects: list[SentryProjectItem] = []


class SentryIssueEventItem(BaseModel):
    event_id: str
    title: str
    message: str | None = None
    timestamp: str | None = None
    level: str | None = None
    location: str | None = None
    trace_preview: str | None = None


class SentryIssueEventListResponse(BaseModel):
    issue_id: str
    events: list[SentryIssueEventItem] = []


class SentryProjectMappingCreate(BaseModel):
    project_slug: str
    project_name: str
    repo_mapping_id: int | None = None
    flow_id: str | None = None
    auto_import: bool = False
    import_interval_minutes: int = 60


class SentryProjectMappingUpdate(BaseModel):
    repo_mapping_id: int | None = None
    flow_id: str | None = None
    auto_import: bool | None = None
    import_interval_minutes: int | None = None
    is_active: bool | None = None


class SentryProjectMappingResponse(BaseModel):
    id: int
    project_slug: str
    project_name: str
    repo_mapping_id: int | None = None
    repo_display_name: str | None = None
    flow_id: str | None = None
    auto_import: bool
    import_interval_minutes: int
    last_import_at: str | None = None
    is_active: bool

    class Config:
        from_attributes = True
