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
    last_seen_at: str | None = None
    occurrences: int | None = None
    assigned_to: str | None = None
    created_date: str | None = None
    activated_date: str | None = None
    closed_date: str | None = None
    story_points: float | None = None
    effort: float | None = None
    work_item_type: str | None = None
    sprint_id: str | None = None
    sprint_name: str | None = None
    sprint_path: str | None = None
    web_url: str | None = None
    # Internal numeric id (Jira numeric issueId, currently unused by Azure)
    internal_id: str | None = None
    # Code-level signals (populated for completed items during refinement
    # backfill; empty for freshly-queried items until dev work starts).
    branch_names: list[str] = Field(default_factory=list)
    # Each ref is "projectId/repoId/prId" so we can resolve titles later
    linked_pr_refs: list[str] = Field(default_factory=list)
    linked_pr_titles: list[str] = Field(default_factory=list)
    linked_commit_shas: list[str] = Field(default_factory=list)
    linked_commit_subjects: list[str] = Field(default_factory=list)
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
