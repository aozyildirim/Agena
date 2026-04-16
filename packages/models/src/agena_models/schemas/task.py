from pydantic import BaseModel, Field


class ExternalTask(BaseModel):
    id: str
    title: str
    description: str = ''
    source: str
    state: str | None = None
    priority: str | None = None
    fixability_score: float | None = None
    is_unhandled: bool | None = None
    substatus: str | None = None
    first_seen_at: str | None = None
    assigned_to: str | None = None
    created_date: str | None = None
    activated_date: str | None = None
    story_points: float | None = None
    effort: float | None = None
    work_item_type: str | None = None
    sprint_id: str | None = None
    sprint_name: str | None = None
    sprint_path: str | None = None
    web_url: str | None = None
    refined_before: bool = False
    refinement_count: int = 0
    last_refined_at: str | None = None
    last_refinement_comment: str | None = None
    last_suggested_story_points: float | None = None


class TaskListResponse(BaseModel):
    items: list[ExternalTask] = Field(default_factory=list)


class EnqueueTaskRequest(BaseModel):
    task: ExternalTask


class EnqueueTaskResponse(BaseModel):
    queued: bool
    queue_key: str
