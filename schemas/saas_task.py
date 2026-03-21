from datetime import datetime

from pydantic import BaseModel


class TaskCreateRequest(BaseModel):
    title: str
    description: str


class TaskResponse(BaseModel):
    id: int
    title: str
    description: str
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
