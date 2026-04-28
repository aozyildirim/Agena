from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant, require_permission
from agena_core.database import get_db_session
from agena_models.models.user_preference import UserPreference
from agena_services.services.analytics_service import AnalyticsService
from agena_services.services.dora_service import DoraService
from agena_services.services.git_sync_service import GitSyncService
from agena_services.services.integration_config_service import IntegrationConfigService

router = APIRouter(prefix='/analytics', tags=['analytics'])


# ── Git Analytics (File Activities) response schemas ─────────────────────────


class GitKPI(BaseModel):
    active_days: int
    total_commits: int
    contributors: int
    coding_days_per_week: float
    total_additions: int
    total_deletions: int


class GitDailyStatItem(BaseModel):
    date: str
    commits: int
    additions: int
    deletions: int
    files_changed: int


class GitCommitsByDayItem(BaseModel):
    day: str
    commits: int


class GitCommitsByHourItem(BaseModel):
    hour: int
    commits: int


class GitContributorItem(BaseModel):
    author: str
    email: str
    commits: int
    additions: int
    deletions: int
    files_changed: int
    efficiency: float
    impact: float
    new_pct: float
    refactor_pct: float
    help_others_pct: float
    churn_pct: float


class GitRecentCommitItem(BaseModel):
    sha: str
    date: str
    message: str
    author: str
    additions: int
    deletions: int
    files_changed: int


class GitCodingDaysSparklineItem(BaseModel):
    week: str
    days: int


class GitAnalyticsResponse(BaseModel):
    kpi: GitKPI
    coding_days_sparkline: list[GitCodingDaysSparklineItem]
    daily_stats: list[GitDailyStatItem]
    commits_by_day: list[GitCommitsByDayItem]
    commits_by_hour: list[GitCommitsByHourItem]
    contributors: list[GitContributorItem]
    recent_commits: list[GitRecentCommitItem]


# ── Deployments (DORA) response schemas ──────────────────────────────────────


class DeploymentsKPI(BaseModel):
    lead_time_hours: float
    deploy_frequency: float
    change_failure_rate: float
    mttr_hours: float


class LeadTimeTrendItem(BaseModel):
    date: str
    hours: float


class DeployFreqTrendItem(BaseModel):
    date: str
    deploys: int


class CfrTrendItem(BaseModel):
    date: str
    rate: float


class DeploymentListItem(BaseModel):
    environment: str
    status: str
    sha: str
    deployed_at: str
    duration_sec: int


class DeploymentsAnalyticsResponse(BaseModel):
    kpi: DeploymentsKPI
    lead_time_trend: list[LeadTimeTrendItem]
    deploy_freq_trend: list[DeployFreqTrendItem]
    cfr_trend: list[CfrTrendItem]
    deployments: list[DeploymentListItem]


# ── Response schemas ──────────────────────────────────────────────────────────


class DailyStatItem(BaseModel):
    date: str
    count: int
    total_tokens: int
    cost_usd: float
    avg_duration_ms: int


class TaskVelocityItem(BaseModel):
    date: str
    completed: int
    failed: int
    queued: int
    total: int


class DailyResponse(BaseModel):
    daily_usage: list[DailyStatItem]
    task_velocity: list[TaskVelocityItem]


class ModelBreakdownItem(BaseModel):
    model: str
    count: int
    total_tokens: int
    cost_usd: float


class ModelBreakdownResponse(BaseModel):
    models: list[ModelBreakdownItem]


class SummaryResponse(BaseModel):
    period: str
    ai_call_count: int
    total_tokens: int
    cost_usd: float
    avg_duration_ms: int
    task_total: int
    task_completed: int
    task_failed: int
    completion_rate: float


class ProjectKPI(BaseModel):
    predictability: float
    productivity: float
    delivery_rate: float
    planning_accuracy: float


class ProjectTotals(BaseModel):
    planned: int
    completed: int
    failed: int
    # External (Azure WIQL) source adds these; internal source leaves them None.
    removed: int | None = None
    in_progress: int | None = None


class GitActivityBlock(BaseModel):
    prs_opened: int = 0
    prs_merged: int = 0
    prs_open: int = 0
    avg_pr_lead_time_hours: float | None = None
    commits: int = 0
    contributors: int = 0
    deployments_total: int = 0
    deployments_success: int = 0
    deployments_failed: int = 0


class WeeklyTrendItem(BaseModel):
    week: str
    planned: int
    completed: int
    failed: int


class TimeTrendItem(BaseModel):
    date: str
    avg_lead_time_hours: float
    avg_cycle_time_hours: float


class ThroughputTrendItem(BaseModel):
    week: str
    throughput: int


class ProjectAnalyticsResponse(BaseModel):
    period_days: int
    source: str = 'internal'  # 'internal' (task_records) | 'external' (Azure WIQL)
    project: str | None = None
    team: str | None = None
    error: str | None = None
    kpi: ProjectKPI
    totals: ProjectTotals
    avg_cycle_time_hours: float
    avg_lead_time_hours: float
    wip_count: int
    weekly_trend: list[WeeklyTrendItem]
    time_trend: list[TimeTrendItem]
    throughput_trend: list[ThroughputTrendItem]
    git_activity: GitActivityBlock | None = None


class AgentPerformanceItem(BaseModel):
    role: str
    tasks: int
    success_rate: float
    avg_duration_ms: int


class ModelPerformanceItem(BaseModel):
    model: str
    tasks: int
    total_tokens: int
    cost_usd: float
    success_rate: float
    avg_duration_ms: int


class CostPerTaskTrendItem(BaseModel):
    date: str
    cost_per_task: float


class TokenUsageTrendItem(BaseModel):
    date: str
    total_tokens: int


class DoraDevelopmentResponse(BaseModel):
    coding_efficiency: float
    rework_rate: float
    avg_cost_per_task: float
    avg_completion_minutes: float
    total_tasks: int
    completed_tasks: int
    failed_tasks: int
    avg_tokens_per_task: int
    agent_performance: list[AgentPerformanceItem]
    model_performance: list[ModelPerformanceItem]
    cost_per_task_trend: list[CostPerTaskTrendItem]
    token_usage_trend: list[TokenUsageTrendItem]


class DoraDailyItem(BaseModel):
    date: str
    completed: int
    failed: int
    lead_time_hours: float | None
    mttr_hours: float | None


class DoraOverviewResponse(BaseModel):
    lead_time_hours: float | None
    deploy_frequency: float | None
    change_failure_rate: float | None
    mttr_hours: float | None
    data_source: str = 'tasks'
    daily: list[DoraDailyItem]


# ── DORA Quality schemas ─────────────────────────────────────────────────────


class QualityDailyTrendItem(BaseModel):
    date: str
    success_rate: float
    completed: int
    settled: int


class FailureCategoryItem(BaseModel):
    reason: str
    count: int


class DoraQualityResponse(BaseModel):
    success_rate: float
    first_time_rate: float
    completed: int
    failed: int
    benchmark: str
    daily_trend: list[QualityDailyTrendItem]
    failure_categories: list[FailureCategoryItem]


# ── DORA Bug Report schemas ──────────────────────────────────────────────────


class FailedTaskItem(BaseModel):
    id: int
    title: str
    failure_reason: str
    source: str
    created_at: str
    updated_at: str
    duration_sec: int


class FailureTrendItem(BaseModel):
    date: str
    failed: int
    failure_rate: float


class FailureReasonItem(BaseModel):
    reason: str
    count: int


class StaleTaskItem(BaseModel):
    id: int
    title: str
    source: str
    created_at: str
    running_minutes: int


class DoraBugsResponse(BaseModel):
    total_failed: int
    failure_rate: float
    mttr_minutes: float
    stale_count: int
    recent_failed: list[FailedTaskItem]
    failure_trend: list[FailureTrendItem]
    top_failure_reasons: list[FailureReasonItem]
    stale_tasks: list[StaleTaskItem]


# ── Sprint Detail (Oobeya-style) schemas ─────────────────────────────────────


class SprintAssigneeItem(BaseModel):
    name: str
    assigned_count: int
    total_effort: float
    delivery_rate_count: float
    delivery_rate_effort: float
    delivered_effort: float


class SprintWorkItem(BaseModel):
    id: int
    key: str
    assignee: str
    assignee_id: int
    summary: str
    work_item_type: str
    priority: str
    status: str
    reopen_count: int
    effort: float


class SprintTypeDistItem(BaseModel):
    type: str
    count: int


class SprintScopeChangeItem(BaseModel):
    date: str
    added: int
    removed: int


class SprintDetailResponse(BaseModel):
    sprint_velocity: int = 0
    total_items: int = 0
    planned_items: int = 0
    delivery_rate_pct: float = 0.0
    planning_accuracy_pct: float = 0.0
    total_task_count: int = 0
    total_bug_count: int = 0
    completed_task_count: int = 0
    completed_bug_count: int = 0
    total_effort: float = 0.0
    completed_effort: float = 0.0
    assignees: list[SprintAssigneeItem]
    completed_items: list[SprintWorkItem]
    incomplete_items: list[SprintWorkItem]
    removed_items: list[SprintWorkItem]
    type_distribution: list[SprintTypeDistItem]
    scope_change: list[SprintScopeChangeItem]


# ── Git Analytics schemas ────────────────────────────────────────────────────


class GitKPI(BaseModel):
    active_days: int
    total_commits: int
    contributors: int
    coding_days_per_week: float
    total_additions: int
    total_deletions: int


class GitDailyStat(BaseModel):
    date: str
    commits: int
    additions: int
    deletions: int
    files_changed: int


class GitCommitsByDay(BaseModel):
    day: str
    commits: int


class GitCommitsByHour(BaseModel):
    hour: int
    commits: int


class GitContributor(BaseModel):
    author: str
    email: str
    commits: int
    additions: int
    deletions: int
    files_changed: int
    efficiency: float
    impact: float
    new_pct: float
    refactor_pct: float
    help_others_pct: float
    churn_pct: float


class GitRecentCommit(BaseModel):
    sha: str
    date: str
    message: str
    author: str
    additions: int
    deletions: int
    files_changed: int


class CodingDaysSparkline(BaseModel):
    week: str
    days: int


class GitAnalyticsResponse(BaseModel):
    kpi: GitKPI
    coding_days_sparkline: list[CodingDaysSparkline]
    daily_stats: list[GitDailyStat]
    commits_by_day: list[GitCommitsByDay]
    commits_by_hour: list[GitCommitsByHour]
    contributors: list[GitContributor]
    recent_commits: list[GitRecentCommit]


# ── PR Analytics schemas ─────────────────────────────────────────────────────


class PrKPI(BaseModel):
    pct_merged_within_goal: float
    merge_goal_hours: float
    avg_merge_hours: float
    merged_count: int


class PrTimeTrendItem(BaseModel):
    date: str
    pr_title: str
    hours: float


class PrSizeTrendItem(BaseModel):
    date: str
    pr_title: str
    lines_changed: int
    additions: int
    deletions: int


class PrOpenItem(BaseModel):
    id: int
    title: str
    risks: list[str]
    author: str
    age_days: float
    comments: int
    coding_time_hours: float | None
    source_branch: str
    lines_changed: int


class PrReviewerStatItem(BaseModel):
    reviewer: str
    avg_review_hours: float
    max_review_hours: float
    reviewed_count: int
    reviewed_pct: float


class PrListItem(BaseModel):
    id: int
    title: str
    risks: list[str]
    status: str
    author: str
    source_branch: str
    target_branch: str
    approvals: int
    lines_changed: int
    created_at: str


class PrAnalyticsResponse(BaseModel):
    kpi: PrKPI
    merge_time_trend: list[PrTimeTrendItem]
    coding_time_trend: list[PrTimeTrendItem]
    pr_size_trend: list[PrSizeTrendItem]
    open_prs: list[PrOpenItem]
    reviewer_stats: list[PrReviewerStatItem]
    pr_list: list[PrListItem]


# ── Team Symptoms (Oobeya-style) response schemas ─────────────────────────────


class SymptomItem(BaseModel):
    id: str
    name: str
    category: str
    active: bool
    severity: str
    value: float
    unit: str
    detail: str
    threshold: float | None = None
    trend: list[float] | None = None
    trend_labels: list[str] | None = None
    stale_count: int | None = None
    total_merged: int | None = None
    unreviewed_count: int | None = None
    lightning_count: int | None = None
    oversize_count: int | None = None
    total_prs: int | None = None
    overloaded_members: list[dict] | None = None
    avg_impact: float | None = None
    weekend_commits: int | None = None
    weekend_prs: int | None = None
    deploy_count: int | None = None
    failed_deploys: int | None = None
    all_deploys: int | None = None


class SymptomsSummary(BaseModel):
    total_symptoms: int
    active_count: int
    critical_count: int
    warning_count: int
    healthy_count: int
    total_commits: int
    total_prs: int
    total_merged: int
    contributors: int
    period_days: int


class TeamSymptomsResponse(BaseModel):
    git_analytics: list[SymptomItem]
    pr_delivery: list[SymptomItem]
    summary: SymptomsSummary


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get('/daily', response_model=DailyResponse)
async def get_daily_analytics(
    days: int = Query(default=30, ge=1, le=365),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> DailyResponse:
    service = AnalyticsService(db)
    daily_usage = await service.daily_stats(tenant.organization_id, days=days)
    task_velocity = await service.task_velocity(tenant.organization_id, days=days)
    return DailyResponse(
        daily_usage=[DailyStatItem(**d) for d in daily_usage],
        task_velocity=[TaskVelocityItem(**t) for t in task_velocity],
    )


@router.get('/summary', response_model=SummaryResponse)
async def get_summary(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> SummaryResponse:
    service = AnalyticsService(db)
    data = await service.summary(tenant.organization_id)
    return SummaryResponse(**data)


@router.get('/models', response_model=ModelBreakdownResponse)
async def get_model_breakdown(
    days: int = Query(default=30, ge=1, le=365),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> ModelBreakdownResponse:
    service = AnalyticsService(db)
    items = await service.model_breakdown(tenant.organization_id, days=days)
    return ModelBreakdownResponse(models=[ModelBreakdownItem(**m) for m in items])


@router.get('/dora/project', response_model=ProjectAnalyticsResponse)
async def get_project_analytics(
    days: int = Query(default=30, ge=1, le=365),
    repo_mapping_id: str | None = Query(default=None),
    source: str = Query(default='internal', pattern='^(internal|external)$'),
    project: str | None = Query(default=None),
    team: str | None = Query(default=None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> ProjectAnalyticsResponse:
    service = AnalyticsService(db)
    if source == 'external':
        data = await service.project_analytics_external(
            tenant.organization_id, days=days, project=project, team=team,
            repo_mapping_id=repo_mapping_id,
        )
    else:
        data = await service.project_analytics(
            tenant.organization_id, days=days, repo_mapping_id=repo_mapping_id,
        )
    return ProjectAnalyticsResponse(**data)


@router.get('/dora/development', response_model=DoraDevelopmentResponse)
async def get_dora_development(
    days: int = Query(default=30, ge=1, le=365),
    repo_mapping_id: str | None = Query(default=None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> DoraDevelopmentResponse:
    service = AnalyticsService(db)
    data = await service.dora_development(tenant.organization_id, days=days, repo_mapping_id=repo_mapping_id)
    return DoraDevelopmentResponse(**data)


@router.get('/dora/development/git', response_model=GitAnalyticsResponse)
async def get_git_analytics(
    days: int = Query(default=30, ge=1, le=365),
    repo_mapping_id: str | None = Query(default=None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> GitAnalyticsResponse:
    service = AnalyticsService(db)
    data = await service.git_analytics(tenant.organization_id, days=days, repo_mapping_id=repo_mapping_id)
    return GitAnalyticsResponse(**data)


@router.get('/dora/development/prs', response_model=PrAnalyticsResponse)
async def get_pr_analytics(
    days: int = Query(default=30, ge=1, le=365),
    repo_mapping_id: str | None = Query(default=None),
    merge_goal_hours: float = Query(default=36.0, ge=1, le=720),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> PrAnalyticsResponse:
    service = AnalyticsService(db)
    data = await service.pr_analytics(
        tenant.organization_id, days=days,
        repo_mapping_id=repo_mapping_id,
        merge_goal_hours=merge_goal_hours,
    )
    return PrAnalyticsResponse(**data)


@router.get('/dora/development/deployments', response_model=DeploymentsAnalyticsResponse)
async def get_deployments_analytics(
    days: int = Query(default=30, ge=1, le=365),
    repo_mapping_id: str | None = Query(default=None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> DeploymentsAnalyticsResponse:
    service = DoraService(db)
    data = await service.deployments_analytics(tenant.organization_id, days=days, repo_mapping_id=repo_mapping_id)
    return DeploymentsAnalyticsResponse(**data)


@router.get('/dora/quality', response_model=DoraQualityResponse)
async def get_dora_quality(
    days: int = Query(default=30, ge=1, le=365),
    repo_mapping_id: str | None = Query(default=None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> DoraQualityResponse:
    service = AnalyticsService(db)
    data = await service.dora_quality(tenant.organization_id, days=days, repo_mapping_id=repo_mapping_id)
    return DoraQualityResponse(**data)


@router.get('/dora/bugs', response_model=DoraBugsResponse)
async def get_dora_bugs(
    days: int = Query(default=30, ge=1, le=365),
    repo_mapping_id: str | None = Query(default=None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> DoraBugsResponse:
    service = AnalyticsService(db)
    data = await service.dora_bugs(tenant.organization_id, days=days, repo_mapping_id=repo_mapping_id)
    return DoraBugsResponse(**data)


@router.get('/dora/project/sprint', response_model=SprintDetailResponse)
async def get_sprint_detail(
    days: int = Query(default=30, ge=1, le=365),
    repo_mapping_id: str | None = Query(default=None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> SprintDetailResponse:
    service = AnalyticsService(db)
    data = await service.sprint_detail(tenant.organization_id, days=days, repo_mapping_id=repo_mapping_id)
    return SprintDetailResponse(**data)


@router.get('/dora', response_model=DoraOverviewResponse)
async def get_dora_overview(
    days: int = Query(default=30, ge=1, le=365),
    repo_mapping_id: str | None = Query(default=None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> DoraOverviewResponse:
    service = DoraService(db)
    data = await service.overview(tenant.organization_id, days=days, repo_mapping_id=repo_mapping_id)
    return DoraOverviewResponse(**data)


# ── DORA Git Sync schemas ───────────────────────────────────────────────────


class DoraSyncRequest(BaseModel):
    # The repo_mappings.id of an org-managed repo. DORA does NOT auto-
    # create mappings — the user manages the canonical list in
    # /dashboard/integrations/repo-mappings, and DORA syncs whichever
    # of those they ask it to.
    repo_mapping_id: str


class DoraSyncResponse(BaseModel):
    commits_synced: int
    prs_synced: int
    deployments_synced: int


class SyncStatusItem(BaseModel):
    repo_mapping_id: str
    commits: int
    prs: int
    deployments: int
    last_sync: str | None


class DoraSyncStatusResponse(BaseModel):
    repos: list[SyncStatusItem]


# ── DORA Git Sync endpoints ─────────────────────────────────────────────────


def _parse_repo_mappings_json(val: str | None) -> list[dict]:
    if not val:
        return []
    try:
        parsed = json.loads(val)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


@router.get('/dora/team-symptoms', response_model=TeamSymptomsResponse)
async def get_team_symptoms(
    days: int = Query(default=90, ge=7, le=365),
    repo_mapping_id: str | None = Query(default=None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> TeamSymptomsResponse:
    service = AnalyticsService(db)
    data = await service.team_symptoms(tenant.organization_id, days, repo_mapping_id)
    return TeamSymptomsResponse(**data)


# Process-local registry of "currently syncing" repos, keyed by
# (org_id, repo_mapping_id). Lets the UI render a "syncing" badge that
# survives a page reload — the alternative is "user clicked sync, then
# refreshed, then sat looking at stale numbers wondering if anything's
# happening". Cleared in a finally block; on worker crash the next sync
# call simply overwrites the entry.
_DORA_SYNC_IN_FLIGHT: dict[tuple[int, int], float] = {}

# Hold strong references to the background sync coroutines so the GC
# doesn't reap them mid-run. asyncio.create_task() only keeps a weakref
# to the task, so without this set Python is free to cancel an orphan
# task at any GC tick — which is exactly what we hit on the first
# fire-and-forget rollout (sync stopped after one HTTP call).
_DORA_SYNC_TASKS: set = set()


@router.get('/dora/sync-active')
async def get_dora_sync_active(
    tenant: CurrentTenant = Depends(get_current_tenant),
) -> dict[str, list[int]]:
    """List repo_mapping_ids whose sync is currently running for this org."""
    org_id = tenant.organization_id
    active = [rm_id for (o, rm_id) in _DORA_SYNC_IN_FLIGHT if o == org_id]
    return {'repo_mapping_ids': active}


@router.post('/dora/sync', response_model=DoraSyncResponse)
async def sync_dora_data(
    payload: DoraSyncRequest,
    tenant: CurrentTenant = Depends(require_permission('tasks:write')),
    db: AsyncSession = Depends(get_db_session),
) -> DoraSyncResponse:
    """Sync a repo's git activity (commits/PRs/deploys) into the local
    git_* tables. The repo must already exist in the org's
    `repo_mappings` table — DORA does not own the canonical list of
    repos, it just consumes it.
    """
    from agena_models.models.repo_mapping import RepoMapping

    try:
        rm_id = int(payload.repo_mapping_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail='repo_mapping_id must be a numeric repo_mappings.id')

    row = (await db.execute(
        select(RepoMapping).where(
            RepoMapping.id == rm_id,
            RepoMapping.organization_id == tenant.organization_id,
            RepoMapping.is_active.is_(True),
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail='Repo mapping not found')

    provider = (row.provider or '').lower()
    if provider == 'github':
        repo_mapping = {
            'id': str(row.id),
            'provider': 'github',
            'github_owner': row.owner,
            'github_repo': row.repo_name,
        }
    elif provider == 'azure':
        cfg_service = IntegrationConfigService(db)
        azure_cfg = await cfg_service.get_config(tenant.organization_id, 'azure')
        base = (azure_cfg.base_url if azure_cfg else '') or ''
        azure_repo_url = (
            f"{base.rstrip('/')}/{row.owner}/_git/{row.repo_name}"
            if base else ''
        )
        repo_mapping = {
            'id': str(row.id),
            'provider': 'azure',
            'azure_project': row.owner,
            'azure_repo_url': azure_repo_url,
            'azure_repo_name': row.repo_name,
        }
    else:
        raise HTTPException(status_code=400, detail=f'Unsupported provider: {row.provider}')

    # Fire-and-forget: kicking off git fetches inline holds the request's
    # DB connection (and event-loop quanta) for 5-30s per repo, which
    # backs up unrelated GETs (menu, notifications, etc.) and ends up
    # looking like the whole UI froze. Spawn the work on a fresh session
    # via asyncio.Task and return 202 immediately; the in-flight registry
    # is the source of truth for "still running".
    import asyncio
    import logging as _logging
    import time as _time
    from agena_core.database import SessionLocal

    bg_logger = _logging.getLogger(__name__)
    org_id = tenant.organization_id
    rm_id = row.id
    in_flight_key = (org_id, rm_id)
    _DORA_SYNC_IN_FLIGHT[in_flight_key] = _time.time()

    async def _run() -> None:
        try:
            async with SessionLocal() as bg_db:
                bg_service = GitSyncService(bg_db)
                await bg_service.sync_repo(org_id, repo_mapping)
        except Exception as exc:
            bg_logger.exception('background sync failed for repo_mapping_id=%s: %s', rm_id, exc)
        finally:
            _DORA_SYNC_IN_FLIGHT.pop(in_flight_key, None)

    bg_task = asyncio.create_task(_run())
    _DORA_SYNC_TASKS.add(bg_task)
    bg_task.add_done_callback(_DORA_SYNC_TASKS.discard)

    # Return zeros — real counts land in /analytics/dora/sync-status once
    # the background task finishes and the in-flight entry clears.
    return DoraSyncResponse(commits_synced=0, prs_synced=0, deployments_synced=0)


@router.get('/dora/sync-status', response_model=DoraSyncStatusResponse)
async def get_dora_sync_status(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> DoraSyncStatusResponse:
    """Return last sync time and record counts per repo mapping."""
    service = GitSyncService(db)
    items = await service.get_sync_status(tenant.organization_id)
    return DoraSyncStatusResponse(repos=[SyncStatusItem(**item) for item in items])
