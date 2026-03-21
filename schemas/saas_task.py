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
    created_at: datetime
    duration_sec: float | None = None
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
