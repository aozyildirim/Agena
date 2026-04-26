from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from agena_models.schemas.task import ExternalTask


class RefinementItemsResponse(BaseModel):
    provider: Literal['azure', 'jira']
    sprint_name: str
    sprint_ref: str
    items: list[ExternalTask] = Field(default_factory=list)
    unestimated_count: int = 0
    pointed_count: int = 0


class RefinementAnalyzeRequest(BaseModel):
    provider: Literal['azure', 'jira']
    language: str = 'Turkish'
    project: str | None = None
    team: str | None = None
    sprint_path: str | None = None
    sprint_name: str | None = None
    board_id: str | None = None
    sprint_id: str | None = None
    agent_provider: str | None = None
    agent_model: str | None = None
    item_ids: list[str] = Field(default_factory=list)
    point_scale: list[int] = Field(default_factory=lambda: [1, 2, 3, 5, 8, 13])
    max_items: int = 12


class SimilarPastItem(BaseModel):
    external_id: str
    title: str
    story_points: int
    assigned_to: str = ''
    url: str = ''
    source: str = ''
    score: float = 0.0
    # Relative tier: "strong" (within 0.02 of best), "related" (within 0.05
    # of best), "weak" (further). Used for UI colour coding + LLM prompt
    # hedging instead of raw cosine %, since short-text embedding scores
    # cluster tightly and raw % misleads the eye.
    tier: str = 'weak'
    branches: list[str] = Field(default_factory=list)
    pr_titles: list[str] = Field(default_factory=list)
    pr_count: int = 0
    commit_count: int = 0


class TouchedFile(BaseModel):
    """A file the LLM thinks needs editing for this task."""
    file: str
    action: str = 'modify'  # modify | create | delete
    reason: str = ''
    repo_mapping_name: str = ''


class RecommendedAuthor(BaseModel):
    """A team member who recently worked on the touched files. Surfaced
    so the planner can hand the task to whoever has the most context."""
    name: str
    email: str = ''
    commit_count: int = 0
    files_touched: int = 0
    reason: str = ''  # human-readable "5 commits in app/Foo since 2026-02"
    # Filled in when the git author email matches a member in the user's
    # `my_team` list. Lets the UI show a clean "Ali (ali@flo.com.tr)"
    # row + an "Assign" button that hits Azure / Jira with a real id.
    member_id: str = ''
    member_display_name: str = ''
    member_unique_name: str = ''  # Azure UPN or Jira email
    member_source: str = ''  # 'azure' | 'jira'


class RefinementSuggestion(BaseModel):
    item_id: str
    title: str
    item_url: str | None = None
    current_story_points: float | None = None
    suggested_story_points: int = 0
    estimation_rationale: str = ''
    confidence: int = 0
    summary: str = ''
    comment: str = ''
    ambiguities: list[str] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)
    ready_for_planning: bool = False
    fallback_applied: bool = False
    fallback_note: str = ''
    model: str | None = None
    provider: str | None = None
    error: str | None = None
    similar_items: list[SimilarPastItem] = Field(default_factory=list)
    # Code-aware analysis fields (populated when refinement runs against a
    # repo that has a local_repo_path). The LLM lists files it would
    # touch; the service then runs `git log` per-file to surface recent
    # authors as candidate assignees.
    touched_files: list[TouchedFile] = Field(default_factory=list)
    recommended_authors: list[RecommendedAuthor] = Field(default_factory=list)


class RefinementAnalyzeResponse(BaseModel):
    provider: Literal['azure', 'jira']
    sprint_name: str
    sprint_ref: str
    language: str
    agent_provider: str
    agent_model: str
    analyzed_count: int
    skipped_count: int
    total_items: int
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0
    results: list[RefinementSuggestion] = Field(default_factory=list)


class RefinementWritebackItem(BaseModel):
    item_id: str
    suggested_story_points: int = 0
    comment: str = ''


class RefinementWritebackRequest(BaseModel):
    provider: Literal['azure', 'jira']
    project: str | None = None
    team: str | None = None
    sprint_path: str | None = None
    sprint_name: str | None = None
    board_id: str | None = None
    sprint_id: str | None = None
    comment_signature: str | None = None
    items: list[RefinementWritebackItem] = Field(default_factory=list)


class RefinementWritebackResult(BaseModel):
    item_id: str
    success: bool
    message: str = ''


class RefinementWritebackResponse(BaseModel):
    provider: Literal['azure', 'jira']
    total: int
    success_count: int
    failure_count: int
    results: list[RefinementWritebackResult] = Field(default_factory=list)
