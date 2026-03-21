from pydantic import BaseModel, Field


class ExternalTask(BaseModel):
    id: str
    title: str
    description: str = ''
    source: str
    assigned_to: str | None = None
    created_date: str | None = None
    activated_date: str | None = None


class TaskListResponse(BaseModel):
    items: list[ExternalTask] = Field(default_factory=list)


class EnqueueTaskRequest(BaseModel):
    task: ExternalTask


class EnqueueTaskResponse(BaseModel):
    queued: bool
    queue_key: str
