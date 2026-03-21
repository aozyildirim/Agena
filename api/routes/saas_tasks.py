import httpx
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentTenant, get_current_tenant
from core.database import get_db_session
from schemas.saas_task import (
    AssignTaskResponse,
    AzureImportRequest,
    ImportTasksResponse,
    QueueTaskItem,
    TaskDependencyUpdateRequest,
    TaskCreateRequest,
    TaskLogItem,
    TaskResponse,
)
from services.task_service import TaskService

router = APIRouter(prefix='/tasks', tags=['saas-tasks'])


async def _to_task_response(service: TaskService, organization_id: int, task) -> TaskResponse:
    insights = await service.get_task_insights(organization_id, task)
    return TaskResponse(
        id=task.id,
        title=task.title,
        description=task.description,
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
    )


@router.post('', response_model=TaskResponse)
async def create_task(
    request: TaskCreateRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
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
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[TaskResponse]:
    service = TaskService(db)
    tasks = await service.list_tasks(tenant.organization_id)
    response: list[TaskResponse] = []
    for t in tasks:
        response.append(await _to_task_response(service, tenant.organization_id, t))
    return response


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
        raise HTTPException(
            status_code=502,
            detail=f'Azure request failed ({exc.response.status_code}). Check org URL/project/team/sprint settings.',
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'Azure connection failed: {exc}') from exc
    return ImportTasksResponse(imported=imported, skipped=skipped)


@router.post('/import/jira', response_model=ImportTasksResponse)
async def import_jira_tasks(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> ImportTasksResponse:
    service = TaskService(db)
    try:
        imported, skipped = await service.import_from_jira(tenant.organization_id, tenant.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ImportTasksResponse(imported=imported, skipped=skipped)


@router.get('/{task_id}', response_model=TaskResponse)
async def get_task(
    task_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
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
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> AssignTaskResponse:
    service = TaskService(db)
    try:
        queue_key = await service.assign_task_to_ai(
            tenant.organization_id,
            task_id,
            create_pr=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return AssignTaskResponse(queued=True, queue_key=queue_key)


@router.post('/{task_id}/cancel', response_model=TaskResponse)
async def cancel_task(
    task_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> TaskResponse:
    service = TaskService(db)
    try:
        task = await service.cancel_task(tenant.organization_id, task_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return await _to_task_response(service, tenant.organization_id, task)


@router.get('/{task_id}/logs', response_model=list[TaskLogItem])
async def task_logs(
    task_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[TaskLogItem]:
    service = TaskService(db)
    logs = await service.get_logs(tenant.organization_id, task_id)
    return [TaskLogItem(stage=l.stage, message=l.message, created_at=l.created_at) for l in logs]


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
