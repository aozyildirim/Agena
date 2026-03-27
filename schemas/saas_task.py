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


class TaskResponse(BaseModel):
    id: int
    title: str
    description: str
    story_context: str | None = None
    acceptance_criteria: str | None = None
    edge_cases: str | None = None
    max_tokens: int | None = None
    max_cost_usd: float | None = None
    source: str
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


class AssignTaskResponse(BaseModel):
    queued: bool
    queue_key: str


class AssignTaskRequest(BaseModel):
    create_pr: bool = False
    mode: str = 'flow'  # 'flow' = PM + Developer, 'ai' = Developer only
    agent_role: str | None = None
    agent_model: str | None = None
    agent_provider: str | None = None


class TaskLogItem(BaseModel):
    id: int
    stage: str
    message: str
    created_at: datetime


class ImportTasksResponse(BaseModel):
    imported: int
    skipped: int


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
