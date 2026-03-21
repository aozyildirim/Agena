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


class TaskLogItem(BaseModel):
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
