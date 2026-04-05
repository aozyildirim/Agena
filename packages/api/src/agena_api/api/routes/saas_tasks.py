import asyncio
import json
import httpx
from datetime import datetime, timedelta

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant, require_permission
from agena_core.database import get_db_session
from agena_models.schemas.saas_task import (
    AssignTaskRequest,
    AssignTaskResponse,
    AzureImportRequest,
    JiraImportRequest,
    ImportTasksResponse,
    RepoAssignmentResponse,
    TaskListResponse,
    QueueTaskItem,
    TaskDependencyUpdateRequest,
    TaskCreateRequest,
    TaskLogItem,
    RunItem,
    UsageEventItem,
    TaskResponse,
)
from agena_services.services.notification_service import NotificationService
from agena_services.services.task_service import TaskService

router = APIRouter(prefix='/tasks', tags=['saas-tasks'])


async def _to_task_response(service: TaskService, organization_id: int, task) -> TaskResponse:
    insights = await service.get_task_insights(organization_id, task)
    preferred_agent_model, preferred_agent_provider = service._extract_preferred_agent_selection(task.description)

    # Load multi-repo assignments if any
    from agena_models.models.task_repo_assignment import TaskRepoAssignment
    from agena_models.models.repo_mapping import RepoMapping
    assign_rows = (await service.db.execute(
        select(TaskRepoAssignment, RepoMapping)
        .outerjoin(RepoMapping, TaskRepoAssignment.repo_mapping_id == RepoMapping.id)
        .where(TaskRepoAssignment.task_id == task.id, TaskRepoAssignment.organization_id == organization_id)
        .order_by(TaskRepoAssignment.id)
    )).all()
    repo_assignments = [
        RepoAssignmentResponse(
            id=a.id,
            repo_mapping_id=a.repo_mapping_id,
            repo_display_name=f"{m.provider}:{m.owner}/{m.repo_name}" if m else '',
            status=a.status,
            pr_url=a.pr_url,
            branch_name=a.branch_name,
            failure_reason=a.failure_reason,
        )
        for a, m in assign_rows
    ]

    return TaskResponse(
        id=task.id,
        title=task.title,
        description=task.description,
        preferred_agent_model=preferred_agent_model,
        preferred_agent_provider=preferred_agent_provider,
        story_context=task.story_context,
        acceptance_criteria=task.acceptance_criteria,
        edge_cases=task.edge_cases,
        max_tokens=task.max_tokens,
        max_cost_usd=task.max_cost_usd,
        source=task.source,
        status=task.status,
        pr_url=task.pr_url,
        branch_name=task.branch_name,
        failure_reason=task.failure_reason,
        created_at=task.created_at,
        duration_sec=insights['duration_sec'],
        run_duration_sec=insights['run_duration_sec'],
        queue_wait_sec=insights['queue_wait_sec'],
        retry_count=insights['retry_count'],
        queue_position=insights['queue_position'],
        estimated_start_sec=insights['estimated_start_sec'],
        lock_scope=insights['lock_scope'],
        blocked_by_task_id=insights['blocked_by_task_id'],
        blocked_by_task_title=insights['blocked_by_task_title'],
        dependency_blockers=insights['dependency_blockers'],
        dependent_task_ids=insights['dependent_task_ids'],
        pr_risk_score=insights['pr_risk_score'],
        pr_risk_level=insights['pr_risk_level'],
        pr_risk_reason=insights['pr_risk_reason'],
        total_tokens=insights['total_tokens'],
        repo_assignments=repo_assignments,
    )


@router.post('', response_model=TaskResponse)
async def create_task(
    request: TaskCreateRequest,
    tenant: CurrentTenant = Depends(require_permission('tasks:write')),
    db: AsyncSession = Depends(get_db_session),
) -> TaskResponse:
    service = TaskService(db)
    try:
        task = await service.create_task(
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            title=request.title,
            description=request.description,
            story_context=request.story_context,
            acceptance_criteria=request.acceptance_criteria,
            edge_cases=request.edge_cases,
            max_tokens=request.max_tokens,
            max_cost_usd=request.max_cost_usd,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc
    return await _to_task_response(service, tenant.organization_id, task)


@router.get('', response_model=list[TaskResponse])
async def list_tasks(
    tenant: CurrentTenant = Depends(require_permission('tasks:read')),
    db: AsyncSession = Depends(get_db_session),
) -> list[TaskResponse]:
    service = TaskService(db)
    tasks = await service.list_tasks(tenant.organization_id)
    response: list[TaskResponse] = []
    for t in tasks:
        response.append(await _to_task_response(service, tenant.organization_id, t))
    return response


@router.get('/search', response_model=TaskListResponse)
async def search_tasks(
    status: str = Query(default='all'),
    source: str = Query(default='all'),
    q: str = Query(default=''),
    created_from: str | None = Query(default=None),
    created_to: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=100),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> TaskListResponse:
    service = TaskService(db)

    from_dt: datetime | None = None
    to_dt: datetime | None = None
    try:
        if created_from:
            from_dt = datetime.fromisoformat(created_from)
        if created_to:
            to_dt = datetime.fromisoformat(created_to) + timedelta(days=1) - timedelta(seconds=1)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Invalid date format. Use YYYY-MM-DD') from exc

    tasks, total = await service.search_tasks(
        tenant.organization_id,
        status=status,
        source=source,
        q=q,
        created_from=from_dt,
        created_to=to_dt,
        page=page,
        page_size=page_size,
    )
    items: list[TaskResponse] = []
    for t in tasks:
        items.append(await _to_task_response(service, tenant.organization_id, t))
    return TaskListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get('/queue', response_model=list[QueueTaskItem])
async def list_queue(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[QueueTaskItem]:
    service = TaskService(db)
    rows = await service.list_queue_tasks(tenant.organization_id)
    return [QueueTaskItem(**row) for row in rows]


@router.post('/import/azure', response_model=ImportTasksResponse)
async def import_azure_tasks(
    request: AzureImportRequest = Body(default_factory=AzureImportRequest),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> ImportTasksResponse:
    service = TaskService(db)
    try:
        imported, skipped = await service.import_from_azure(
            tenant.organization_id,
            tenant.user_id,
            project=request.project,
            team=request.team,
            sprint_path=request.sprint_path,
            state=request.state,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            notifier = NotificationService(db)
            await notifier.notify_event(
                organization_id=tenant.organization_id,
                user_id=tenant.user_id,
                event_type='integration_auth_expired',
                title='Azure DevOps authorization expired',
                message='Please update your Azure PAT in Integrations.',
                severity='error',
            )
            raise HTTPException(status_code=401, detail='Azure PAT is invalid or expired') from exc
        raise HTTPException(
            status_code=502,
            detail=f'Azure request failed ({exc.response.status_code}). Check org URL/project/team/sprint settings.',
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'Azure connection failed: {exc}') from exc
    return ImportTasksResponse(imported=imported, skipped=skipped)


@router.post('/import/jira', response_model=ImportTasksResponse)
async def import_jira_tasks(
    request: JiraImportRequest = Body(default_factory=JiraImportRequest),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> ImportTasksResponse:
    service = TaskService(db)
    try:
        imported, skipped = await service.import_from_jira(
            tenant.organization_id,
            tenant.user_id,
            project_key=request.project_key,
            board_id=request.board_id,
            sprint_id=request.sprint_id,
            state=request.state,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            notifier = NotificationService(db)
            await notifier.notify_event(
                organization_id=tenant.organization_id,
                user_id=tenant.user_id,
                event_type='integration_auth_expired',
                title='Jira authorization expired',
                message='Please update your Jira token in Integrations.',
                severity='error',
            )
            raise HTTPException(status_code=401, detail='Jira API token is invalid or expired') from exc
        raise HTTPException(status_code=502, detail=f'Jira request failed ({exc.response.status_code})') from exc
    return ImportTasksResponse(imported=imported, skipped=skipped)


@router.get('/{task_id}', response_model=TaskResponse)
async def get_task(
    task_id: int,
    tenant: CurrentTenant = Depends(require_permission('tasks:read')),
    db: AsyncSession = Depends(get_db_session),
) -> TaskResponse:
    service = TaskService(db)
    task = await service.get_task(tenant.organization_id, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail='Task not found')
    return await _to_task_response(service, tenant.organization_id, task)


@router.post('/{task_id}/assign', response_model=AssignTaskResponse)
async def assign_task(
    task_id: int,
    payload: AssignTaskRequest = Body(default_factory=AssignTaskRequest),
    tenant: CurrentTenant = Depends(require_permission('tasks:write')),
    db: AsyncSession = Depends(get_db_session),
) -> AssignTaskResponse:
    service = TaskService(db)
    # Append extra config (remote repo, agent info) to description before assign
    if payload.extra_description:
        from sqlalchemy import select
        from agena_models.models.task_record import TaskRecord
        result = await db.execute(
            select(TaskRecord).where(
                TaskRecord.id == task_id,
                TaskRecord.organization_id == tenant.organization_id,
            )
        )
        task_record = result.scalar_one_or_none()
        if task_record:
            import re
            desc = task_record.description or ''
            extra = payload.extra_description
            # If a new Remote Repo is being set, remove stale repo metadata
            if 'Remote Repo:' in extra:
                stale_keys = [
                    'Local Repo Path', 'Local Repo Mapping', 'Azure Repo', 'Remote Repo',
                ]
                for key in stale_keys:
                    desc = re.sub(rf'^{re.escape(key)}:.*$', '', desc, flags=re.MULTILINE)
                # Clean up leftover blank lines from removal
                desc = re.sub(r'\n{3,}', '\n\n', desc).strip()
            task_record.description = desc + '\n\n---\n' + extra
            await db.commit()
    # Multi-repo: create assignments and fan-out to queue
    mapping_ids = payload.repo_mapping_ids or []
    if len(mapping_ids) > 1:
        from agena_models.models.repo_mapping import RepoMapping
        from agena_models.models.task_repo_assignment import TaskRepoAssignment
        from agena_models.models.task_record import TaskRecord

        task_record = (await db.execute(
            select(TaskRecord).where(TaskRecord.id == task_id, TaskRecord.organization_id == tenant.organization_id)
        )).scalar_one_or_none()
        if not task_record:
            raise HTTPException(404, 'Task not found')

        # Validate all mapping IDs
        mappings = (await db.execute(
            select(RepoMapping).where(
                RepoMapping.id.in_(mapping_ids),
                RepoMapping.organization_id == tenant.organization_id,
                RepoMapping.is_active.is_(True),
            )
        )).scalars().all()
        if len(mappings) != len(mapping_ids):
            raise HTTPException(400, 'One or more repo mappings not found or inactive')

        # Create assignments
        assignments = []
        for m in mappings:
            a = TaskRepoAssignment(
                task_id=task_id,
                organization_id=tenant.organization_id,
                repo_mapping_id=m.id,
                status='queued',
            )
            db.add(a)
            assignments.append(a)
        await db.flush()

        # Enqueue each assignment separately
        from agena_services.services.queue_service import QueueService
        queue = QueueService()
        first_key = ''
        for a in assignments:
            key = await queue.enqueue({
                'organization_id': tenant.organization_id,
                'task_id': task_id,
                'assignment_id': a.id,
                'create_pr': payload.create_pr,
                'mode': payload.mode,
                'agent_model': payload.agent_model or '',
                'agent_provider': payload.agent_provider or '',
            })
            if not first_key:
                first_key = key

        task_record.status = 'queued'
        await db.commit()
        return AssignTaskResponse(queued=True, queue_key=first_key)

    # Single-repo or legacy flow
    try:
        queue_key = await service.assign_task_to_ai(
            tenant.organization_id,
            task_id,
            create_pr=payload.create_pr,
            mode=payload.mode,
            agent_role=payload.agent_role,
            agent_model=payload.agent_model,
            agent_provider=payload.agent_provider,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return AssignTaskResponse(queued=True, queue_key=queue_key)


@router.post('/{task_id}/cancel', response_model=TaskResponse)
async def cancel_task(
    task_id: int,
    tenant: CurrentTenant = Depends(require_permission('tasks:write')),
    db: AsyncSession = Depends(get_db_session),
) -> TaskResponse:
    service = TaskService(db)
    try:
        task = await service.cancel_task(tenant.organization_id, task_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return await _to_task_response(service, tenant.organization_id, task)


@router.delete('/{task_id}')
async def delete_task(
    task_id: int,
    tenant: CurrentTenant = Depends(require_permission('tasks:write')),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    from agena_models.models.task_record import TaskRecord
    from agena_models.models.agent_log import AgentLog
    result = await db.execute(
        select(TaskRecord).where(
            TaskRecord.id == task_id,
            TaskRecord.organization_id == tenant.organization_id,
        )
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail='Task not found')
    if task.status == 'running':
        raise HTTPException(status_code=409, detail='Cannot delete a running task')
    # Delete all related records (foreign keys)
    try:
        await db.execute(sa_delete(AgentLog).where(AgentLog.task_id == task_id))
        from agena_models.models.ai_usage_event import AIUsageEvent
        await db.execute(sa_delete(AIUsageEvent).where(AIUsageEvent.task_id == task_id))
    except Exception:
        pass  # tables might not have task_id FK
    try:
        from agena_models.models.run_record import RunRecord
        await db.execute(sa_delete(RunRecord).where(RunRecord.task_id == task_id))
    except Exception:
        pass
    try:
        from agena_models.models.task_dependency import TaskDependency
        await db.execute(sa_delete(TaskDependency).where(
            (TaskDependency.task_id == task_id) | (TaskDependency.depends_on_task_id == task_id)
        ))
    except Exception:
        pass
    await db.delete(task)
    await db.commit()
    return {'status': 'deleted', 'task_id': str(task_id)}


@router.get('/{task_id}/runs', response_model=list[RunItem])
async def task_runs(
    task_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[RunItem]:
    service = TaskService(db)
    runs = await service.get_runs(tenant.organization_id, task_id)
    return [
        RunItem(
            id=r.id,
            task_id=r.task_id,
            source=r.source,
            usage_prompt_tokens=r.usage_prompt_tokens or 0,
            usage_completion_tokens=r.usage_completion_tokens or 0,
            usage_total_tokens=r.usage_total_tokens or 0,
            estimated_cost_usd=r.estimated_cost_usd or 0,
            pr_url=r.pr_url,
            created_at=r.created_at,
        )
        for r in runs
    ]


@router.get('/{task_id}/logs', response_model=list[TaskLogItem])
async def task_logs(
    task_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[TaskLogItem]:
    service = TaskService(db)
    logs = await service.get_logs(tenant.organization_id, task_id)
    return [TaskLogItem(id=l.id, stage=l.stage, message=l.message, created_at=l.created_at) for l in logs]


@router.get('/{task_id}/logs/stream')
async def task_logs_stream(
    task_id: int,
    since_id: int = Query(default=0, ge=0),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    service = TaskService(db)
    task = await service.get_task(tenant.organization_id, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail='Task not found')

    async def event_generator():
        last_id = since_id
        # keepalive + retry hint for reconnecting clients
        yield 'retry: 2000\n\n'
        while True:
            logs = await service.get_logs_since(tenant.organization_id, task_id, last_id)
            if logs:
                for item in logs:
                    last_id = max(last_id, int(item.id))
                    payload = {
                        'id': item.id,
                        'stage': item.stage,
                        'message': item.message,
                        'created_at': item.created_at.isoformat(),
                    }
                    yield f"event: log\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
            else:
                yield 'event: ping\ndata: {}\n\n'
            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    )


@router.get('/{task_id}/usage-events', response_model=list[UsageEventItem])
async def task_usage_events(
    task_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[UsageEventItem]:
    service = TaskService(db)
    task = await service.get_task(tenant.organization_id, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail='Task not found')
    events = await service.get_usage_events(tenant.organization_id, task_id)
    return [
        UsageEventItem(
            id=e.id,
            operation_type=e.operation_type,
            provider=e.provider,
            model=e.model,
            status=e.status,
            prompt_tokens=e.prompt_tokens,
            completion_tokens=e.completion_tokens,
            total_tokens=e.total_tokens,
            cost_usd=e.cost_usd,
            duration_ms=e.duration_ms,
            cache_hit=e.cache_hit,
            local_repo_path=e.local_repo_path,
            profile_version=e.profile_version,
            error_message=e.error_message,
            started_at=e.started_at,
            ended_at=e.ended_at,
            created_at=e.created_at,
        )
        for e in events
    ]


@router.get('/{task_id}/dependencies')
async def get_task_dependencies(
    task_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, list[int]]:
    service = TaskService(db)
    task = await service.get_task(tenant.organization_id, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail='Task not found')
    deps = await service.get_dependencies(tenant.organization_id, task_id)
    dependents = await service.get_dependents(tenant.organization_id, task_id)
    blockers = await service.get_dependency_blockers(tenant.organization_id, task_id)
    return {'depends_on_task_ids': deps, 'dependent_task_ids': dependents, 'blocker_task_ids': blockers}


@router.put('/{task_id}/dependencies')
async def set_task_dependencies(
    task_id: int,
    payload: TaskDependencyUpdateRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, list[int]]:
    service = TaskService(db)
    try:
        deps = await service.set_dependencies(
            organization_id=tenant.organization_id,
            task_id=task_id,
            depends_on_task_ids=payload.depends_on_task_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    dependents = await service.get_dependents(tenant.organization_id, task_id)
    blockers = await service.get_dependency_blockers(tenant.organization_id, task_id)
    return {'depends_on_task_ids': deps, 'dependent_task_ids': dependents, 'blocker_task_ids': blockers}
