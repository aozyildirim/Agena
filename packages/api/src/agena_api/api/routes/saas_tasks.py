import asyncio
import json
import os
import uuid
from pathlib import Path
import httpx
from datetime import datetime, timedelta

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant, require_permission
from agena_core.database import get_db_session
from agena_models.schemas.saas_task import (
    AssignTaskRequest,
    AssignTaskResponse,
    TaskUpdateRequest,
    AzureImportRequest,
    JiraImportRequest,
    NewRelicImportRequest,
    SentryImportRequest,
    DatadogImportRequest,
    AppDynamicsImportRequest,
    ImportTasksResponse,
    RepoAssignmentResponse,
    TaskAttachmentResponse,
    TaskListResponse,
    QueueTaskItem,
    TaskDependencyUpdateRequest,
    TaskCreateRequest,
    TaskLogItem,
    RunItem,
    UsageEventItem,
    TaskResponse,
)
from agena_services.services.integration_config_service import IntegrationConfigService
from agena_services.services.notification_service import NotificationService
from agena_services.services.task_service import TaskService

router = APIRouter(prefix='/tasks', tags=['saas-tasks'])

# Task attachments config
ATTACHMENT_ROOT = Path(os.getenv('TASK_ATTACHMENT_ROOT', '/app/data/uploads/tasks'))
ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024  # 20 MB per file
ATTACHMENT_MAX_PER_REQUEST = 10


async def _get_repo_mapping_name(db: AsyncSession, mapping_id: int | None) -> str | None:
    if not mapping_id:
        return None
    from agena_models.models.repo_mapping import RepoMapping
    row = await db.get(RepoMapping, mapping_id)
    return row.repo_name if row else None


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
        external_id=task.external_id,
        priority=getattr(task, 'priority', None),
        fixability_score=getattr(task, 'fixability_score', None),
        is_unhandled=getattr(task, 'is_unhandled', None),
        substatus=getattr(task, 'substatus', None),
        first_seen_at=getattr(task, 'first_seen_at', None),
        last_seen_at=getattr(task, 'last_seen_at', None),
        occurrences=getattr(task, 'occurrences', None),
        external_work_item_id=getattr(task, 'external_work_item_id', None),
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
        sprint_name=getattr(task, 'sprint_name', None),
        sprint_path=getattr(task, 'sprint_path', None),
        repo_mapping_id=getattr(task, 'repo_mapping_id', None),
        repo_mapping_name=await _get_repo_mapping_name(service.db, getattr(task, 'repo_mapping_id', None)),
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
            source=request.source,
            external_id=request.external_id,
            assigned_to=request.assigned_to,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc

    # Set dependencies if provided at creation time
    if request.depends_on_task_ids:
        try:
            await service.set_dependencies(tenant.organization_id, task.id, request.depends_on_task_ids)
        except ValueError:
            pass  # non-critical: task created, dependency setting failed silently

    # Pre-select repo mappings if provided at creation time
    if request.repo_mapping_ids:
        from agena_models.models.repo_mapping import RepoMapping
        from agena_models.models.task_repo_assignment import TaskRepoAssignment
        valid_ids = (await db.execute(
            select(RepoMapping.id).where(
                RepoMapping.id.in_(request.repo_mapping_ids),
                RepoMapping.organization_id == tenant.organization_id,
                RepoMapping.is_active.is_(True),
            )
        )).scalars().all()
        if valid_ids:
            # Set first mapping as the task's primary repo_mapping_id
            task.repo_mapping_id = valid_ids[0]
            # Create assignment rows for all selected repos
            for mid in valid_ids:
                db.add(TaskRepoAssignment(
                    task_id=task.id,
                    organization_id=tenant.organization_id,
                    repo_mapping_id=mid,
                    status='pending',
                ))
            await db.commit()
            await db.refresh(task)

    response = await _to_task_response(service, tenant.organization_id, task)
    response.was_existing = bool(getattr(task, '_was_existing', False))
    return response


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


@router.post('/import/newrelic', response_model=ImportTasksResponse)
async def import_newrelic_errors(
    request: NewRelicImportRequest = Body(default_factory=NewRelicImportRequest),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> ImportTasksResponse:
    service = TaskService(db)
    try:
        result = await service.import_from_newrelic(
            tenant.organization_id,
            tenant.user_id,
            entity_guid=request.entity_guid,
            since=request.since,
            min_occurrences=request.min_occurrences,
            fingerprints=request.fingerprints,
            mirror_target=request.mirror_target,
            story_points=request.story_points,
            iteration_path=request.iteration_path,
        )
        imported, skipped, manual_urls = result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            notifier = NotificationService(db)
            await notifier.notify_event(
                organization_id=tenant.organization_id,
                user_id=tenant.user_id,
                event_type='integration_auth_expired',
                title='New Relic authorization expired',
                message='Please update your New Relic API key in Integrations.',
                severity='error',
            )
            raise HTTPException(status_code=401, detail='New Relic API key is invalid or expired') from exc
        raise HTTPException(status_code=502, detail=f'New Relic request failed ({exc.response.status_code})') from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'New Relic connection failed: {exc}') from exc
    return ImportTasksResponse(imported=imported, skipped=skipped, manual_azure_urls=manual_urls)


@router.post('/import/sentry', response_model=ImportTasksResponse)
async def import_sentry_issues(
    request: SentryImportRequest = Body(default_factory=SentryImportRequest),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> ImportTasksResponse:
    service = TaskService(db)
    try:
        imported, skipped, sentry_manual_urls = await service.import_from_sentry(
            tenant.organization_id,
            tenant.user_id,
            project_slug=request.project_slug,
            query=request.query,
            limit=request.limit,
            issue_ids=request.issue_ids,
            stats_period=request.stats_period,
            environment=request.environment,
            release=request.release,
            mirror_target=request.mirror_target,
            story_points=request.story_points,
            iteration_path=request.iteration_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            notifier = NotificationService(db)
            await notifier.notify_event(
                organization_id=tenant.organization_id,
                user_id=tenant.user_id,
                event_type='integration_auth_expired',
                title='Sentry authorization expired',
                message='Please update your Sentry API token in Integrations.',
                severity='error',
            )
            raise HTTPException(status_code=401, detail='Sentry API token is invalid or expired') from exc
        raise HTTPException(status_code=502, detail=f'Sentry request failed ({exc.response.status_code})') from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'Sentry connection failed: {exc}') from exc
    return ImportTasksResponse(imported=imported, skipped=skipped, manual_azure_urls=sentry_manual_urls)


@router.post('/import/datadog', response_model=ImportTasksResponse)
async def import_datadog_issues(
    request: DatadogImportRequest = Body(default_factory=DatadogImportRequest),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> ImportTasksResponse:
    service = TaskService(db)
    try:
        imported, skipped, dd_manual_urls = await service.import_from_datadog(
            tenant.organization_id,
            tenant.user_id,
            query=request.query,
            limit=request.limit,
            time_from=request.time_from,
            mirror_target=request.mirror_target,
            story_points=request.story_points,
            iteration_path=request.iteration_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise HTTPException(status_code=401, detail='Datadog API key is invalid or expired') from exc
        raise HTTPException(status_code=502, detail=f'Datadog request failed ({exc.response.status_code})') from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'Datadog connection failed: {exc}') from exc
    return ImportTasksResponse(imported=imported, skipped=skipped, manual_azure_urls=dd_manual_urls)


@router.post('/import/appdynamics', response_model=ImportTasksResponse)
async def import_appdynamics_errors(
    request: AppDynamicsImportRequest = Body(default_factory=AppDynamicsImportRequest),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> ImportTasksResponse:
    service = TaskService(db)
    try:
        imported, skipped, ad_manual_urls = await service.import_from_appdynamics(
            tenant.organization_id,
            tenant.user_id,
            app_name=request.app_name,
            limit=request.limit,
            duration_minutes=request.duration_minutes,
            mirror_target=request.mirror_target,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise HTTPException(status_code=401, detail='AppDynamics API token is invalid or expired') from exc
        raise HTTPException(status_code=502, detail=f'AppDynamics request failed ({exc.response.status_code})') from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'AppDynamics connection failed: {exc}') from exc
    return ImportTasksResponse(imported=imported, skipped=skipped, manual_azure_urls=ad_manual_urls)


# NOTE: this static-path route MUST be registered before `/{task_id}`
# below — otherwise FastAPI tries to coerce "proxy-image" into an int
# task_id and returns a 422.
@router.get('/proxy-image')
async def proxy_image(
    url: str = Query(..., description='Azure / Jira attachment URL to fetch with stored PAT'),
    tenant: CurrentTenant = Depends(require_permission('tasks:read')),
    db: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    """Fetch a remote attachment image with the org's stored credentials and
    stream the bytes back. Used by the task detail page + Create modal so
    Azure DevOps work-item screenshots actually render in the browser
    (the direct URL needs Basic auth via PAT, which a plain `<img>` tag
    can't supply). SSRF guard: the URL must point at the org's
    integration base host."""
    target = (url or '').strip()
    if not target.startswith('https://'):
        raise HTTPException(status_code=400, detail='URL must start with https://')

    from urllib.parse import urlparse
    try:
        parsed_host = urlparse(target).netloc.lower()
    except Exception:
        raise HTTPException(status_code=400, detail='Bad URL')
    if not parsed_host:
        raise HTTPException(status_code=400, detail='Bad URL host')

    cfg_service = IntegrationConfigService(db)
    azure_cfg = await cfg_service.get_config(tenant.organization_id, 'azure')
    jira_cfg = await cfg_service.get_config(tenant.organization_id, 'jira')

    auth_header: str | None = None
    matched = False
    import base64 as _b64
    if azure_cfg and azure_cfg.secret:
        try:
            az_host = urlparse((azure_cfg.base_url or '').rstrip('/')).netloc.lower()
        except Exception:
            az_host = ''
        if (az_host and az_host in parsed_host) or 'dev.azure.com' in parsed_host:
            token = _b64.b64encode(f':{azure_cfg.secret}'.encode()).decode()
            auth_header = f'Basic {token}'
            matched = True
    if not matched and jira_cfg and jira_cfg.secret:
        try:
            jira_host = urlparse((jira_cfg.base_url or '').rstrip('/')).netloc.lower()
        except Exception:
            jira_host = ''
        if (jira_host and jira_host in parsed_host) or 'atlassian.net' in parsed_host:
            email = (jira_cfg.username or '').strip()
            tok = (jira_cfg.secret or '').strip()
            if email and tok:
                creds = _b64.b64encode(f'{email}:{tok}'.encode()).decode()
                auth_header = f'Basic {creds}'
                matched = True
    if not matched:
        raise HTTPException(status_code=403, detail='URL does not match any configured integration')

    headers = {'Authorization': auth_header} if auth_header else {}
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(target, headers=headers)
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f'Upstream returned {exc.response.status_code}') from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'Upstream fetch failed: {exc}') from exc

    content_type = resp.headers.get('content-type', 'application/octet-stream').split(';', 1)[0].strip()
    if not content_type.startswith('image/'):
        raise HTTPException(status_code=415, detail=f'Upstream is not an image (got {content_type})')

    body = resp.content
    async def _stream():
        yield body
    return StreamingResponse(
        _stream(),
        media_type=content_type,
        headers={'Cache-Control': 'private, max-age=300'},
    )


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


@router.put('/{task_id}', response_model=TaskResponse)
async def update_task(
    task_id: int,
    payload: TaskUpdateRequest,
    tenant: CurrentTenant = Depends(require_permission('tasks:write')),
    db: AsyncSession = Depends(get_db_session),
) -> TaskResponse:
    service = TaskService(db)
    task = await service.get_task(tenant.organization_id, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail='Task not found')
    if payload.title is not None:
        task.title = payload.title
    if payload.description is not None:
        task.description = payload.description
    if payload.story_context is not None:
        task.story_context = payload.story_context or None
    if payload.acceptance_criteria is not None:
        task.acceptance_criteria = payload.acceptance_criteria or None
    if payload.edge_cases is not None:
        task.edge_cases = payload.edge_cases or None
    if payload.max_tokens is not None:
        task.max_tokens = max(1, payload.max_tokens) if payload.max_tokens > 0 else None
    if payload.max_cost_usd is not None:
        task.max_cost_usd = payload.max_cost_usd if payload.max_cost_usd > 0 else None
    await db.commit()
    return await _to_task_response(service, tenant.organization_id, task)


class LinkWorkItemRequest(BaseModel):
    external_work_item_id: str | None = None


@router.post('/{task_id}/link-work-item', response_model=TaskResponse)
async def link_work_item(
    task_id: int,
    payload: LinkWorkItemRequest,
    tenant: CurrentTenant = Depends(require_permission('tasks:write')),
    db: AsyncSession = Depends(get_db_session),
) -> TaskResponse:
    service = TaskService(db)
    task = await service.get_task(tenant.organization_id, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail='Task not found')
    value = (payload.external_work_item_id or '').strip() or None
    task.external_work_item_id = value
    await db.commit()
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

    # Single mapping selected → inject repo info into description and set repo_mapping_id
    if len(mapping_ids) == 1:
        from agena_models.models.repo_mapping import RepoMapping
        from agena_models.models.task_record import TaskRecord
        import re as _re

        mapping = (await db.execute(
            select(RepoMapping).where(
                RepoMapping.id == mapping_ids[0],
                RepoMapping.organization_id == tenant.organization_id,
                RepoMapping.is_active.is_(True),
            )
        )).scalar_one_or_none()
        if mapping:
            task_record = (await db.execute(
                select(TaskRecord).where(TaskRecord.id == task_id, TaskRecord.organization_id == tenant.organization_id)
            )).scalar_one_or_none()
            if task_record:
                desc = task_record.description or ''
                # Remove stale repo metadata
                for key in ['Local Repo Path', 'Local Repo Mapping', 'Azure Repo', 'Remote Repo', 'Project']:
                    desc = _re.sub(rf'^{_re.escape(key)}:.*$', '', desc, flags=_re.MULTILINE)
                desc = _re.sub(r'\n{3,}', '\n\n', desc).strip()
                # Inject new repo info
                repo_lines = []
                if mapping.local_repo_path:
                    repo_lines.append(f'Local Repo Path: {mapping.local_repo_path}')
                repo_lines.append(f'Local Repo Mapping: {mapping.repo_name}')
                if mapping.provider == 'azure':
                    repo_lines.append(f'Project: {mapping.owner}')
                task_record.description = desc + '\n\n---\n' + '\n'.join(repo_lines)
                task_record.repo_mapping_id = mapping.id
                await db.commit()

    # ── Flow mode: enqueue to Redis so worker runs it (survives restarts) ──
    if payload.flow_id:
        from agena_models.models.user_preference import UserPreference
        pref_result = await db.execute(
            select(UserPreference).where(UserPreference.user_id == tenant.user_id)
        )
        pref = pref_result.scalar_one_or_none()
        flow = None
        if pref and pref.flows_json:
            import json as _json
            for f in _json.loads(pref.flows_json):
                if f.get('id') == payload.flow_id:
                    flow = f
                    break
        if not flow:
            raise HTTPException(status_code=404, detail=f'Flow not found: {payload.flow_id}')

        # Queue flow via same Redis path as regular tasks — worker handles it
        try:
            queue_key = await service.assign_task_to_ai(
                tenant.organization_id,
                task_id,
                create_pr=payload.create_pr,
                mode='flow_run',
                agent_model=payload.agent_model,
                agent_provider=payload.agent_provider,
                force_queue=getattr(payload, 'force_queue', False),
            )
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

        # Store flow definition in Redis alongside the task payload
        from agena_services.services.queue_service import QueueService
        import json as _json
        qs = QueueService()
        await qs.client.set(
            f'flow_def:{task_id}',
            _json.dumps({'flow': flow, 'user_id': tenant.user_id}),
            ex=86400,  # 24 hour TTL
        )
        return AssignTaskResponse(queued=True, queue_key=queue_key)

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
            force_queue=getattr(payload, 'force_queue', False),
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

    # Kill active CLI stream on bridge so the process stops immediately
    import os
    bridge_url = os.getenv('CLI_BRIDGE_URL', 'http://host.docker.internal:9876')
    try:
        repo_path = None
        if task.repo_mapping_id:
            from agena_models.models.repo_mapping import RepoMapping
            rm = await db.get(RepoMapping, task.repo_mapping_id)
            if rm and rm.local_path:
                repo_path = rm.local_path
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                f'{bridge_url}/kill-stream',
                json={'task_id': str(task_id), 'repo_path': repo_path or ''},
            )
    except Exception:
        pass  # best effort — task is already cancelled in DB

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
    # Clean up attachment files from disk (DB rows cascade via FK)
    try:
        from agena_models.models.task_attachment import TaskAttachment
        att_rows = (await db.execute(
            select(TaskAttachment).where(TaskAttachment.task_id == task_id)
        )).scalars().all()
        for att in att_rows:
            try:
                Path(att.storage_path).unlink(missing_ok=True)
            except OSError:
                pass
        task_dir = ATTACHMENT_ROOT / str(tenant.organization_id) / str(task_id)
        try:
            task_dir.rmdir()  # only removes if empty
        except OSError:
            pass
    except Exception:
        pass
    await db.delete(task)
    await db.commit()
    return {'status': 'deleted', 'task_id': str(task_id)}


# ─── Task repo assignments ──────────────────────────────────────────────────

class TaskRepoAssignmentUpdateRequest(BaseModel):
    repo_mapping_ids: list[int]  # full replacement set; deletes anything missing


@router.put('/{task_id}/repo-assignments', response_model=list[RepoAssignmentResponse])
async def update_task_repo_assignments(
    task_id: int,
    payload: TaskRepoAssignmentUpdateRequest,
    tenant: CurrentTenant = Depends(require_permission('tasks:write')),
    db: AsyncSession = Depends(get_db_session),
) -> list[RepoAssignmentResponse]:
    """Replace the set of repo mappings attached to a task. Removes any
    assignments not in the new list (only when they're not running) and
    creates rows for any new mapping ids. Used by the task detail page's
    edit-assignments UI."""
    from agena_models.models.task_record import TaskRecord
    from agena_models.models.task_repo_assignment import TaskRepoAssignment
    from agena_models.models.repo_mapping import RepoMapping

    task = (await db.execute(
        select(TaskRecord).where(
            TaskRecord.id == task_id,
            TaskRecord.organization_id == tenant.organization_id,
        )
    )).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail='Task not found')

    requested = list({int(x) for x in (payload.repo_mapping_ids or []) if int(x) > 0})

    # Validate all requested mappings belong to this org and are active.
    if requested:
        valid = (await db.execute(
            select(RepoMapping.id).where(
                RepoMapping.id.in_(requested),
                RepoMapping.organization_id == tenant.organization_id,
                RepoMapping.is_active.is_(True),
            )
        )).scalars().all()
        if len(valid) != len(requested):
            raise HTTPException(status_code=400, detail='One or more repo mappings not found or inactive')

    existing_rows = (await db.execute(
        select(TaskRepoAssignment).where(
            TaskRepoAssignment.task_id == task_id,
            TaskRepoAssignment.organization_id == tenant.organization_id,
        )
    )).scalars().all()
    existing_by_mapping = {r.repo_mapping_id: r for r in existing_rows}
    requested_set = set(requested)
    existing_set = set(existing_by_mapping.keys())

    # Delete assignments the user removed, but refuse to drop one that's
    # actively running so we don't orphan an in-flight worker job.
    for mid in existing_set - requested_set:
        row = existing_by_mapping[mid]
        if (row.status or '').lower() == 'running':
            raise HTTPException(status_code=409, detail=f'Cannot remove assignment {row.id}: still running')
        await db.delete(row)

    # Create rows for newly added mappings.
    for mid in requested_set - existing_set:
        db.add(TaskRepoAssignment(
            task_id=task_id,
            organization_id=tenant.organization_id,
            repo_mapping_id=mid,
            status='pending',
        ))

    # If the task's primary repo_mapping_id was on a removed assignment,
    # rotate it to the first remaining mapping (or clear it).
    if task.repo_mapping_id and task.repo_mapping_id not in requested_set:
        task.repo_mapping_id = next(iter(requested_set), None)

    await db.commit()

    # Re-load with display info.
    rows = (await db.execute(
        select(TaskRepoAssignment, RepoMapping)
        .outerjoin(RepoMapping, TaskRepoAssignment.repo_mapping_id == RepoMapping.id)
        .where(TaskRepoAssignment.task_id == task_id, TaskRepoAssignment.organization_id == tenant.organization_id)
        .order_by(TaskRepoAssignment.id)
    )).all()
    return [
        RepoAssignmentResponse(
            id=a.id,
            repo_mapping_id=a.repo_mapping_id,
            repo_display_name=f"{m.provider}:{m.owner}/{m.repo_name}" if m else '',
            status=a.status,
            pr_url=a.pr_url,
            branch_name=a.branch_name,
            failure_reason=a.failure_reason,
        )
        for a, m in rows
    ]


@router.delete('/{task_id}/repo-assignments/{assignment_id}')
async def delete_task_repo_assignment(
    task_id: int,
    assignment_id: int,
    tenant: CurrentTenant = Depends(require_permission('tasks:write')),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    """Single-row delete used by the task detail page's "remove this repo"
    button. Refuses to drop an assignment that's still running."""
    from agena_models.models.task_record import TaskRecord
    from agena_models.models.task_repo_assignment import TaskRepoAssignment
    row = (await db.execute(
        select(TaskRepoAssignment).where(
            TaskRepoAssignment.id == assignment_id,
            TaskRepoAssignment.task_id == task_id,
            TaskRepoAssignment.organization_id == tenant.organization_id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail='Assignment not found')
    if (row.status or '').lower() == 'running':
        raise HTTPException(status_code=409, detail='Cannot remove an assignment that is currently running')
    removed_mapping_id = row.repo_mapping_id
    await db.delete(row)

    # Rotate the task's primary repo if it was the deleted one.
    task = await db.get(TaskRecord, task_id)
    if task and task.repo_mapping_id == removed_mapping_id:
        survivor = (await db.execute(
            select(TaskRepoAssignment.repo_mapping_id)
            .where(
                TaskRepoAssignment.task_id == task_id,
                TaskRepoAssignment.organization_id == tenant.organization_id,
            )
            .limit(1)
        )).scalar_one_or_none()
        task.repo_mapping_id = survivor

    await db.commit()
    return {'status': 'deleted', 'assignment_id': str(assignment_id)}


# ─── Task attachments ────────────────────────────────────────────────────────

async def _load_task_for_org(db: AsyncSession, organization_id: int, task_id: int):
    from agena_models.models.task_record import TaskRecord
    row = (await db.execute(
        select(TaskRecord).where(TaskRecord.id == task_id, TaskRecord.organization_id == organization_id)
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail='Task not found')
    return row


@router.post('/{task_id}/attachments', response_model=list[TaskAttachmentResponse])
async def upload_task_attachments(
    task_id: int,
    files: list[UploadFile] = File(...),
    tenant: CurrentTenant = Depends(require_permission('tasks:write')),
    db: AsyncSession = Depends(get_db_session),
) -> list[TaskAttachmentResponse]:
    if not files:
        raise HTTPException(status_code=400, detail='No files provided')
    if len(files) > ATTACHMENT_MAX_PER_REQUEST:
        raise HTTPException(status_code=400, detail=f'Too many files (max {ATTACHMENT_MAX_PER_REQUEST} per upload)')

    await _load_task_for_org(db, tenant.organization_id, task_id)

    from agena_models.models.task_attachment import TaskAttachment

    target_dir = ATTACHMENT_ROOT / str(tenant.organization_id) / str(task_id)
    target_dir.mkdir(parents=True, exist_ok=True)

    saved: list[TaskAttachment] = []
    for upload in files:
        data = await upload.read()
        size = len(data)
        if size == 0:
            continue
        if size > ATTACHMENT_MAX_BYTES:
            raise HTTPException(status_code=413, detail=f'{upload.filename}: file exceeds {ATTACHMENT_MAX_BYTES // (1024 * 1024)} MB limit')

        original = (upload.filename or 'file').strip() or 'file'
        ext = Path(original).suffix[:32]
        disk_name = f'{uuid.uuid4().hex}{ext}'
        disk_path = target_dir / disk_name
        disk_path.write_bytes(data)

        row = TaskAttachment(
            task_id=task_id,
            organization_id=tenant.organization_id,
            uploaded_by_user_id=tenant.user_id,
            filename=original[:512],
            content_type=(upload.content_type or 'application/octet-stream')[:128],
            size_bytes=size,
            storage_path=str(disk_path),
        )
        db.add(row)
        saved.append(row)

    if not saved:
        raise HTTPException(status_code=400, detail='No non-empty files')

    await db.commit()
    for row in saved:
        await db.refresh(row)

    return [
        TaskAttachmentResponse(
            id=r.id, filename=r.filename, content_type=r.content_type,
            size_bytes=r.size_bytes, created_at=r.created_at,
        )
        for r in saved
    ]


@router.get('/{task_id}/attachments', response_model=list[TaskAttachmentResponse])
async def list_task_attachments(
    task_id: int,
    tenant: CurrentTenant = Depends(require_permission('tasks:read')),
    db: AsyncSession = Depends(get_db_session),
) -> list[TaskAttachmentResponse]:
    await _load_task_for_org(db, tenant.organization_id, task_id)
    from agena_models.models.task_attachment import TaskAttachment
    rows = (await db.execute(
        select(TaskAttachment)
        .where(TaskAttachment.task_id == task_id, TaskAttachment.organization_id == tenant.organization_id)
        .order_by(TaskAttachment.id)
    )).scalars().all()
    return [
        TaskAttachmentResponse(
            id=r.id, filename=r.filename, content_type=r.content_type,
            size_bytes=r.size_bytes, created_at=r.created_at,
        )
        for r in rows
    ]


@router.get('/{task_id}/attachments/{attachment_id}/download')
async def download_task_attachment(
    task_id: int,
    attachment_id: int,
    tenant: CurrentTenant = Depends(require_permission('tasks:read')),
    db: AsyncSession = Depends(get_db_session),
) -> FileResponse:
    from agena_models.models.task_attachment import TaskAttachment
    row = (await db.execute(
        select(TaskAttachment).where(
            TaskAttachment.id == attachment_id,
            TaskAttachment.task_id == task_id,
            TaskAttachment.organization_id == tenant.organization_id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail='Attachment not found')
    path = Path(row.storage_path)
    if not path.is_file():
        raise HTTPException(status_code=410, detail='Attachment file missing on server')
    return FileResponse(path=str(path), media_type=row.content_type, filename=row.filename)


@router.delete('/{task_id}/attachments/{attachment_id}')
async def delete_task_attachment(
    task_id: int,
    attachment_id: int,
    tenant: CurrentTenant = Depends(require_permission('tasks:write')),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    from agena_models.models.task_attachment import TaskAttachment
    row = (await db.execute(
        select(TaskAttachment).where(
            TaskAttachment.id == attachment_id,
            TaskAttachment.task_id == task_id,
            TaskAttachment.organization_id == tenant.organization_id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail='Attachment not found')
    try:
        Path(row.storage_path).unlink(missing_ok=True)
    except OSError:
        pass
    await db.delete(row)
    await db.commit()
    return {'status': 'deleted', 'attachment_id': str(attachment_id)}


@router.post('/{task_id}/sentry-resolve')
async def sentry_resolve_task(
    task_id: int,
    tenant: CurrentTenant = Depends(require_permission('tasks:write')),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    """Resolve or unresolve the linked Sentry issue for this task."""
    from agena_models.models.task_record import TaskRecord
    task = (await db.execute(
        select(TaskRecord).where(TaskRecord.id == task_id, TaskRecord.organization_id == tenant.organization_id)
    )).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail='Task not found')
    if task.source != 'sentry' or not task.external_id:
        raise HTTPException(status_code=400, detail='Task is not linked to a Sentry issue')

    config = await IntegrationConfigService(db).get_config(tenant.organization_id, 'sentry')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Sentry integration not configured')

    extra = config.extra_config or {}
    org_slug = str(extra.get('organization_slug') or '').strip()
    if not org_slug:
        raise HTTPException(status_code=400, detail='Sentry organization slug missing')

    # external_id format: "project_slug:issue_id"
    parts = task.external_id.split(':', 1)
    issue_id = parts[1] if len(parts) > 1 else parts[0]

    from agena_services.integrations.sentry_client import SentryClient
    client = SentryClient()
    sentry_cfg = {'api_token': config.secret, 'base_url': config.base_url or 'https://sentry.io/api/0'}

    # Toggle: if description says "resolved", unresolve; otherwise resolve
    new_status = 'resolved'
    if 'Status: resolved' in (task.description or ''):
        new_status = 'unresolved'

    await client.update_issue_status(sentry_cfg, organization_slug=org_slug, issue_id=issue_id, status=new_status)

    # Update task description to reflect new status
    if task.description:
        import re
        task.description = re.sub(r'Status: \w+', f'Status: {new_status}', task.description, count=1)
    await db.commit()

    return {'status': new_status, 'issue_id': issue_id}


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


# --- Share-link endpoints --------------------------------------------------

class CreateShareTokenRequest(BaseModel):
    expires_in_days: int = 7
    max_uses: int = 3


class ShareTokenResponse(BaseModel):
    id: int
    token: str
    url: str
    expires_at: str | None
    max_uses: int
    use_count: int
    revoked_at: str | None


@router.post('/{task_id}/share', response_model=ShareTokenResponse)
async def create_share_link(
    task_id: int,
    payload: CreateShareTokenRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> ShareTokenResponse:
    from agena_services.services.task_share_service import TaskShareService
    service = TaskService(db)
    task = await service.get_task(tenant.organization_id, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail='Task not found')
    share_service = TaskShareService(db)
    row = await share_service.create_token(
        organization_id=tenant.organization_id,
        task_id=task_id,
        user_id=tenant.user_id,
        expires_in_days=payload.expires_in_days,
        max_uses=payload.max_uses,
    )
    return ShareTokenResponse(
        id=row.id,
        token=row.token,
        url=f'/share/{row.token}',
        expires_at=row.expires_at.isoformat() if row.expires_at else None,
        max_uses=row.max_uses,
        use_count=row.use_count,
        revoked_at=row.revoked_at.isoformat() if row.revoked_at else None,
    )


@router.get('/{task_id}/share', response_model=list[ShareTokenResponse])
async def list_share_links(
    task_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[ShareTokenResponse]:
    from agena_services.services.task_share_service import TaskShareService
    service = TaskService(db)
    task = await service.get_task(tenant.organization_id, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail='Task not found')
    rows = await TaskShareService(db).list_for_task(tenant.organization_id, task_id)
    return [
        ShareTokenResponse(
            id=r.id,
            token=r.token,
            url=f'/share/{r.token}',
            expires_at=r.expires_at.isoformat() if r.expires_at else None,
            max_uses=r.max_uses,
            use_count=r.use_count,
            revoked_at=r.revoked_at.isoformat() if r.revoked_at else None,
        )
        for r in rows
    ]


@router.delete('/{task_id}/share/{token_id}')
async def revoke_share_link(
    task_id: int,
    token_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    from agena_services.services.task_share_service import TaskShareService
    ok = await TaskShareService(db).revoke(tenant.organization_id, token_id)
    if not ok:
        raise HTTPException(status_code=404, detail='Share token not found')
    return {'revoked': True}


@router.post('/share/{token}/import', response_model=TaskResponse)
async def import_shared_task(
    token: str,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> TaskResponse:
    """Copy a shared task into the recipient's organization. Consumes one
    `use_count` slot of the share token. Description / source are kept;
    repo mapping is *not* carried across (IDs are tenant-scoped).
    Existing TaskAttachment files are duplicated into the recipient's
    storage tree."""
    from agena_services.services.task_share_service import TaskShareService
    from agena_models.models.task_attachment import TaskAttachment
    from agena_models.models.task_record import TaskRecord
    import shutil

    share_service = TaskShareService(db)
    share = await share_service.resolve(token)
    if share is None:
        raise HTTPException(status_code=404, detail='Share link is invalid, expired, or used up')

    src_task = await db.get(TaskRecord, share.task_id)
    if src_task is None or src_task.organization_id != share.organization_id:
        raise HTTPException(status_code=404, detail='Underlying task no longer exists')

    existing = (await db.execute(
        select(TaskRecord.id).where(
            TaskRecord.organization_id == tenant.organization_id,
            TaskRecord.imported_from_share_id == share.id,
        ).limit(1)
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f'This share has already been imported into your organization (task #{existing})',
        )

    service = TaskService(db)
    new_task = await service.create_task(
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        title=src_task.title or 'Imported task',
        description=src_task.description or '',
        source=getattr(src_task, 'source', None) or 'shared',
        external_id=None,
    )
    new_task.imported_from_share_id = share.id
    await db.commit()
    await db.refresh(new_task)

    src_atts = (await db.execute(
        select(TaskAttachment).where(
            TaskAttachment.task_id == src_task.id,
            TaskAttachment.organization_id == src_task.organization_id,
        )
    )).scalars().all()
    if src_atts:
        dest_root = Path('/app/data/uploads/tasks') / str(tenant.organization_id) / str(new_task.id)
        dest_root.mkdir(parents=True, exist_ok=True)
        for a in src_atts:
            try:
                src_path = Path(a.storage_path)
                if not src_path.is_file():
                    continue
                dest_path = dest_root / src_path.name
                shutil.copyfile(src_path, dest_path)
                db.add(TaskAttachment(
                    task_id=new_task.id,
                    organization_id=tenant.organization_id,
                    uploaded_by_user_id=tenant.user_id,
                    filename=a.filename,
                    content_type=a.content_type,
                    size_bytes=a.size_bytes,
                    storage_path=str(dest_path),
                ))
            except Exception:
                continue
        await db.commit()
        await db.refresh(new_task)

    await share_service.consume(share)
    return await _to_task_response(service, tenant.organization_id, new_task)
