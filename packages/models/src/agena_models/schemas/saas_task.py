from datetime import datetime

from pydantic import BaseModel, Field


class TaskCreateRequest(BaseModel):
    title: str
    description: str
    story_context: str | None = None
    acceptance_criteria: str | None = None
    edge_cases: str | None = None
    max_tokens: int | None = None
    max_cost_usd: float | None = None
    depends_on_task_ids: list[int] | None = None  # set dependencies at creation time
    repo_mapping_ids: list[int] | None = None  # pre-select target repos at creation time
    source: str | None = None  # tag with external system (azure|jira|…) for dedup
    external_id: str | None = None  # e.g. Azure/Jira work item id — used with source
    assigned_to: str | None = None  # original assignee on the source platform (Azure displayName / Jira name)


class TaskUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    story_context: str | None = None
    acceptance_criteria: str | None = None
    edge_cases: str | None = None
    max_tokens: int | None = None
    max_cost_usd: float | None = None


class TaskResponse(BaseModel):
    id: int
    title: str
    description: str
    preferred_agent_model: str | None = None
    preferred_agent_provider: str | None = None
    story_context: str | None = None
    acceptance_criteria: str | None = None
    edge_cases: str | None = None
    max_tokens: int | None = None
    max_cost_usd: float | None = None
    source: str
    external_id: str | None = None
    priority: str | None = None
    fixability_score: float | None = None
    is_unhandled: bool | None = None
    substatus: str | None = None
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    occurrences: int | None = None
    external_work_item_id: str | None = None
    status: str
    pr_url: str | None = None
    branch_name: str | None = None
    failure_reason: str | None = None
    last_mode: str | None = None
    created_at: datetime
    duration_sec: float | None = None
    run_duration_sec: float | None = None
    queue_wait_sec: int | None = None
    retry_count: int | None = None
    queue_position: int | None = None
    estimated_start_sec: int | None = None
    lock_scope: str | None = None
    blocked_by_task_id: int | None = None
    blocked_by_task_title: str | None = None
    dependency_blockers: list[int] = Field(default_factory=list)
    dependent_task_ids: list[int] = Field(default_factory=list)
    pr_risk_score: int | None = None
    pr_risk_level: str | None = None
    pr_risk_reason: str | None = None
    total_tokens: int | None = None
    cached_tokens: int | None = None
    cache_savings_usd: float | None = None
    answer_summary: str | None = None
    runtime_id: int | None = None
    runtime_name: str | None = None
    sprint_name: str | None = None
    sprint_path: str | None = None
    repo_mapping_id: int | None = None
    repo_mapping_name: str | None = None
    repo_assignments: list['RepoAssignmentResponse'] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    was_existing: bool = False  # set by POST /tasks when source+external_id matched a pre-existing task


class AssignTaskResponse(BaseModel):
    queued: bool
    queue_key: str


class TaskAttachmentResponse(BaseModel):
    id: int
    filename: str
    content_type: str
    size_bytes: int
    created_at: datetime


class RepoAssignmentResponse(BaseModel):
    id: int
    repo_mapping_id: int
    repo_display_name: str = ''
    status: str = 'pending'
    pr_url: str | None = None
    branch_name: str | None = None
    failure_reason: str | None = None
    # Filled in by /tasks/{id}/revisions and the task detail load so
    # the UI knows whether to show the "Revize iste" button (hidden
    # once the PR is merged — that's a fresh-task situation).
    revision_count: int = 0
    pr_merged: bool = False


class ReviseTaskRequest(BaseModel):
    """Body of POST /tasks/{id}/revise — the user-facing follow-up
    request that lands an extra commit on the existing branch instead
    of opening a brand-new PR."""
    instruction: str  # required, non-empty after .strip()
    # Subset of assignments to revise. None = "every completed,
    # non-merged assignment on this task" (the common case for
    # single-repo tasks where the user doesn't even see a picker).
    repo_assignment_ids: list[int] | None = None
    agent_model: str | None = None
    agent_provider: str | None = None


class RevisionItem(BaseModel):
    """One element of ReviseTaskResponse — describes the outcome of
    queueing a single (revision, assignment) pair so the frontend can
    show per-row status (some queued, some skipped because PR
    already merged, etc.)."""
    id: int
    assignment_id: int | None
    repo_display_name: str = ''
    status: str  # queued | skipped_merged | skipped_running


class ReviseTaskResponse(BaseModel):
    queued: bool
    revisions: list[RevisionItem]


class TaskRevisionRecord(BaseModel):
    """Used by GET /tasks/{id}/revisions to render the revision
    history strip on the task detail page."""
    id: int
    assignment_id: int | None
    instruction: str
    status: str
    failure_reason: str | None = None
    requested_by_user_id: int | None = None
    run_record_id: int | None = None
    created_at: datetime


class AssignTaskRequest(BaseModel):
    create_pr: bool = False
    mode: str = 'flow'  # 'flow' = PM + Developer, 'ai' = Developer only
    agent_role: str | None = None
    agent_model: str | None = None
    agent_provider: str | None = None
    extra_description: str | None = None  # appended to task description before assign
    repo_mapping_ids: list[int] | None = None  # multi-repo: assign to multiple repos
    flow_id: str | None = None  # if set, run this flow instead of default pipeline
    force_queue: bool = False  # skip repo conflict check, queue anyway
    runtime_id: int | None = None  # route to a specific compute runtime; null = auto/default


class TaskLogItem(BaseModel):
    id: int
    stage: str
    message: str
    created_at: datetime


class ImportTasksResponse(BaseModel):
    imported: int
    skipped: int
    manual_azure_urls: list[str] = Field(default_factory=list)


class AzureImportRequest(BaseModel):
    project: str | None = None
    team: str | None = None
    sprint_path: str | None = None
    state: str | None = 'New'


class JiraImportRequest(BaseModel):
    project_key: str | None = None
    board_id: str | None = None
    sprint_id: str | None = None
    state: str | None = None


class NewRelicImportRequest(BaseModel):
    entity_guid: str | None = None
    since: str = '24 hours ago'
    min_occurrences: int = 1
    fingerprints: list[str] | None = None
    mirror_target: str | None = None  # 'azure' | 'jira' | 'none' | None (auto)
    story_points: int | None = 2
    iteration_path: str | None = None


class SentryImportRequest(BaseModel):
    project_slug: str | None = None
    query: str = 'is:unresolved'
    limit: int = 50
    issue_ids: list[str] | None = None
    stats_period: str | None = None
    environment: str | None = None
    release: str | None = None
    mirror_target: str | None = None
    story_points: int | None = 2
    iteration_path: str | None = None


class DatadogImportRequest(BaseModel):
    query: str = 'status:open'
    limit: int = 50
    time_from: str = '-24h'
    mirror_target: str | None = None
    story_points: int | None = 2
    iteration_path: str | None = None


class AppDynamicsImportRequest(BaseModel):
    app_name: str | None = None
    limit: int = 50
    duration_minutes: int = 1440
    mirror_target: str | None = None


class TaskDependencyUpdateRequest(BaseModel):
    depends_on_task_ids: list[int]


class QueueTaskItem(BaseModel):
    task_id: int
    title: str
    status: str
    position: int
    create_pr: bool
    source: str
    created_at: datetime


class TaskListResponse(BaseModel):
    items: list[TaskResponse]
    total: int
    page: int
    page_size: int


class RunItem(BaseModel):
    id: int
    task_id: int
    source: str
    usage_prompt_tokens: float = 0
    usage_completion_tokens: float = 0
    usage_total_tokens: float = 0
    estimated_cost_usd: float = 0
    pr_url: str | None = None
    created_at: datetime


class UsageEventItem(BaseModel):
    id: int
    operation_type: str
    provider: str
    model: str | None = None
    status: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float
    duration_ms: int | None = None
    cache_hit: bool = False
    local_repo_path: str | None = None
    profile_version: int | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    created_at: datetime
