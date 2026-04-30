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
    first_seen: str | None = None
    permalink: str | None = None
    is_unhandled: bool = False
    substatus: str | None = None
    fixability_score: float | None = None
    platform: str | None = None
    stats_24h: list[int] = []
    imported_task_id: int | None = None
    imported_task_status: str | None = None
    imported_work_item_url: str | None = None


class SentryIssueListResponse(BaseModel):
    organization_slug: str
    project_slug: str
    issues: list[SentryIssueItem] = []


class SentryStackFrame(BaseModel):
    filename: str | None = None
    function: str | None = None
    lineno: int | None = None
    abs_path: str | None = None
    in_app: bool = False
    context_line: str | None = None
    pre_context: list[str] = []
    post_context: list[str] = []
    repo_url: str | None = None  # GitHub/Azure deeplink to file:line, when project has a RepoMapping


class SentryIssuePreview(BaseModel):
    issue_id: str
    event_id: str | None = None
    title: str | None = None
    exception_type: str | None = None
    exception_value: str | None = None
    platform: str | None = None
    environment: str | None = None
    release: str | None = None
    transaction: str | None = None
    request_method: str | None = None
    request_url: str | None = None
    frames: list[SentryStackFrame] = []
    breadcrumbs: list[dict] = []
    permalink: str | None = None


class SentryAIFixPreviewRequest(BaseModel):
    issue_id: str


class SentryAIFixPreviewResponse(BaseModel):
    summary: str
    suggested_fix: str
    files_to_change: list[str] = []
    confidence: int = 0  # 0-100
    cached: bool = False


class SentryEnvironmentItem(BaseModel):
    name: str
    is_hidden: bool = False


class SentryReleaseItem(BaseModel):
    version: str
    short_version: str | None = None
    date_released: str | None = None
    last_event: str | None = None


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
