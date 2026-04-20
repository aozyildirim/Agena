from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant, require_permission
from agena_core.database import get_db_session
from agena_models.models.repo_mapping import RepoMapping
from agena_models.models.sentry_project_mapping import SentryProjectMapping
from agena_models.models.task_record import TaskRecord
from agena_models.schemas.sentry import (
    SentryIssueEventItem,
    SentryIssueEventListResponse,
    SentryIssueItem,
    SentryIssueListResponse,
    SentryProjectItem,
    SentryProjectListResponse,
    SentryProjectMappingCreate,
    SentryProjectMappingResponse,
    SentryProjectMappingUpdate,
)
from agena_services.integrations.sentry_client import SentryClient
from agena_services.services.integration_config_service import IntegrationConfigService

router = APIRouter(prefix='/sentry', tags=['sentry'])


async def _sentry_cfg(db: AsyncSession, organization_id: int) -> dict[str, str]:
    svc = IntegrationConfigService(db)
    config = await svc.get_config(organization_id, 'sentry')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Sentry integration not configured')
    extra = config.extra_config or {}
    org_slug = str(extra.get('organization_slug') or '').strip()
    if not org_slug:
        raise HTTPException(status_code=400, detail='Sentry organization slug is not configured in integration settings')
    return {
        'api_token': config.secret,
        'base_url': config.base_url or 'https://sentry.io/api/0',
        'organization_slug': org_slug,
    }


def _extract_event_preview(event: dict) -> tuple[str | None, str | None]:
    entries = event.get('entries') or []
    if not isinstance(entries, list):
        return None, None
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if str(entry.get('type') or '') != 'exception':
            continue
        values = ((entry.get('data') or {}).get('values') or [])
        if not isinstance(values, list) or not values:
            continue
        first = values[0] or {}
        stacktrace = first.get('stacktrace') or {}
        frames = stacktrace.get('frames') or []
        if isinstance(frames, list) and frames:
            last = frames[-1] or {}
            filename = str(last.get('filename') or '').strip()
            function = str(last.get('function') or '').strip()
            lineno = last.get('lineno')
            location = filename
            if function:
                location = f'{location}:{function}' if location else function
            if lineno:
                location = f'{location}:{lineno}' if location else str(lineno)
        else:
            location = None
        ex_type = str(first.get('type') or '').strip()
        ex_value = str(first.get('value') or '').strip()
        preview = f'{ex_type}: {ex_value}'.strip(': ').strip() or None
        return location, preview
    return None, None


@router.get('/projects', response_model=SentryProjectListResponse)
async def list_sentry_projects(
    query: str = Query('', description='Search by project name/slug'),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> SentryProjectListResponse:
    cfg = await _sentry_cfg(db, tenant.organization_id)
    client = SentryClient()
    try:
        projects = await client.list_projects(cfg, organization_slug=cfg['organization_slug'])
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise HTTPException(status_code=401, detail='Sentry API token is invalid or lacks permissions') from exc
        raise HTTPException(status_code=502, detail=f'Sentry request failed ({exc.response.status_code})') from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'Sentry connection failed: {exc}') from exc

    needle = (query or '').strip().lower()
    parsed: list[SentryProjectItem] = []
    for p in projects:
        slug = str(p.get('slug') or '').strip()
        if not slug:
            continue
        name = str(p.get('name') or slug)
        if needle and needle not in slug.lower() and needle not in name.lower():
            continue
        parsed.append(SentryProjectItem(slug=slug, name=name))

    return SentryProjectListResponse(organization_slug=cfg['organization_slug'], projects=parsed)


@router.get('/projects/{project_slug}/issues', response_model=SentryIssueListResponse)
async def list_sentry_project_issues(
    project_slug: str,
    query: str = Query('is:unresolved'),
    limit: int = Query(50, ge=1, le=100),
    stats_period: str | None = Query(None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> SentryIssueListResponse:
    cfg = await _sentry_cfg(db, tenant.organization_id)
    client = SentryClient()
    try:
        issues = await client.list_issues(
            cfg,
            organization_slug=cfg['organization_slug'],
            project_slug=project_slug.strip(),
            query=query,
            limit=limit,
            stats_period=stats_period,
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise HTTPException(status_code=401, detail='Sentry API token is invalid or lacks permissions') from exc
        raise HTTPException(status_code=502, detail=f'Sentry request failed ({exc.response.status_code})') from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'Sentry connection failed: {exc}') from exc

    project_key = project_slug.strip()
    external_ids = [f"{project_key}:{i.get('id')}" for i in issues if i.get('id')]
    imported_map: dict[str, tuple[int, str | None]] = {}
    if external_ids:
        rows = (await db.execute(
            select(TaskRecord.id, TaskRecord.external_id, TaskRecord.external_work_item_id).where(
                TaskRecord.organization_id == tenant.organization_id,
                TaskRecord.source == 'sentry',
                TaskRecord.external_id.in_(external_ids),
            )
        )).all()
        imported_map = {ext_id: (task_id, wi_id) for task_id, ext_id, wi_id in rows}

    from agena_api.api.routes._work_item_url import build_work_item_url_resolver
    wi_resolver = await build_work_item_url_resolver(db, tenant.organization_id)

    parsed: list[SentryIssueItem] = []
    for i in issues:
        issue_id = str(i.get('id') or '')
        task_id, wi_id = imported_map.get(f'{project_key}:{issue_id}', (None, None))
        parsed.append(
            SentryIssueItem(
                id=issue_id,
                short_id=str(i.get('shortId') or '') or None,
                title=str(i.get('title') or 'Sentry issue'),
                level=str(i.get('level') or 'error'),
                status=str(i.get('status') or '') or None,
                culprit=str(i.get('culprit') or '') or None,
                count=int(i.get('count') or 0),
                user_count=int(i.get('userCount') or 0),
                last_seen=str(i.get('lastSeen') or '') or None,
                permalink=str(i.get('permalink') or '') or None,
                imported_task_id=task_id,
                imported_work_item_url=wi_resolver(wi_id) if wi_id else None,
            )
        )

    return SentryIssueListResponse(
        organization_slug=cfg['organization_slug'],
        project_slug=project_slug.strip(),
        issues=parsed,
    )


@router.get('/issues/{issue_id}/events', response_model=SentryIssueEventListResponse)
async def list_sentry_issue_events(
    issue_id: str,
    limit: int = Query(10, ge=1, le=50),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> SentryIssueEventListResponse:
    cfg = await _sentry_cfg(db, tenant.organization_id)
    client = SentryClient()
    try:
        events = await client.list_issue_events(
            cfg,
            organization_slug=cfg['organization_slug'],
            issue_id=issue_id,
            limit=limit,
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise HTTPException(status_code=401, detail='Sentry API token is invalid or lacks permissions') from exc
        raise HTTPException(status_code=502, detail=f'Sentry request failed ({exc.response.status_code})') from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'Sentry connection failed: {exc}') from exc

    items: list[SentryIssueEventItem] = []
    for ev in events:
        event_id = str(ev.get('eventID') or ev.get('id') or '').strip()
        title = str(ev.get('title') or ev.get('message') or 'Sentry event')
        message = str(ev.get('message') or '') or None
        timestamp = str(ev.get('dateCreated') or ev.get('timestamp') or '') or None
        level = str(ev.get('level') or '') or None
        location, trace_preview = _extract_event_preview(ev)
        items.append(
            SentryIssueEventItem(
                event_id=event_id,
                title=title,
                message=message,
                timestamp=timestamp,
                level=level,
                location=location,
                trace_preview=trace_preview,
            )
        )

    return SentryIssueEventListResponse(issue_id=issue_id, events=items)


@router.get('/mappings', response_model=list[SentryProjectMappingResponse])
async def list_mappings(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[SentryProjectMappingResponse]:
    stmt = (
        select(SentryProjectMapping, RepoMapping.owner, RepoMapping.repo_name)
        .outerjoin(RepoMapping, SentryProjectMapping.repo_mapping_id == RepoMapping.id)
        .where(SentryProjectMapping.organization_id == tenant.organization_id)
        .order_by(SentryProjectMapping.project_name)
    )
    rows = (await db.execute(stmt)).all()
    result: list[SentryProjectMappingResponse] = []
    for m, owner, repo_name in rows:
        repo_display = f'{owner}/{repo_name}' if owner and repo_name else None
        result.append(
            SentryProjectMappingResponse(
                id=m.id,
                project_slug=m.project_slug,
                project_name=m.project_name,
                repo_mapping_id=m.repo_mapping_id,
                repo_display_name=repo_display,
                flow_id=m.flow_id,
                auto_import=m.auto_import,
                import_interval_minutes=m.import_interval_minutes,
                last_import_at=m.last_import_at.isoformat() if m.last_import_at else None,
                is_active=m.is_active,
            )
        )
    return result


@router.post('/mappings', response_model=SentryProjectMappingResponse, status_code=201)
async def create_mapping(
    body: SentryProjectMappingCreate,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> SentryProjectMappingResponse:
    slug = body.project_slug.strip()
    if not slug:
        raise HTTPException(status_code=400, detail='project_slug is required')
    existing = (await db.execute(
        select(SentryProjectMapping).where(
            SentryProjectMapping.organization_id == tenant.organization_id,
            SentryProjectMapping.project_slug == slug,
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail='Project mapping already exists')

    m = SentryProjectMapping(
        organization_id=tenant.organization_id,
        project_slug=slug,
        project_name=body.project_name.strip() or slug,
        repo_mapping_id=body.repo_mapping_id,
        flow_id=body.flow_id,
        auto_import=body.auto_import,
        import_interval_minutes=body.import_interval_minutes,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)

    repo_display = None
    if m.repo_mapping_id:
        repo = (await db.execute(select(RepoMapping).where(RepoMapping.id == m.repo_mapping_id))).scalar_one_or_none()
        if repo:
            repo_display = f'{repo.owner}/{repo.repo_name}'

    return SentryProjectMappingResponse(
        id=m.id,
        project_slug=m.project_slug,
        project_name=m.project_name,
        repo_mapping_id=m.repo_mapping_id,
        repo_display_name=repo_display,
        flow_id=m.flow_id,
        auto_import=m.auto_import,
        import_interval_minutes=m.import_interval_minutes,
        last_import_at=None,
        is_active=m.is_active,
    )


@router.put('/mappings/{mapping_id}', response_model=SentryProjectMappingResponse)
async def update_mapping(
    mapping_id: int,
    body: SentryProjectMappingUpdate,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> SentryProjectMappingResponse:
    m = (await db.execute(
        select(SentryProjectMapping).where(
            SentryProjectMapping.id == mapping_id,
            SentryProjectMapping.organization_id == tenant.organization_id,
        )
    )).scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=404, detail='Mapping not found')

    if body.repo_mapping_id is not None:
        m.repo_mapping_id = body.repo_mapping_id
    if body.flow_id is not None:
        m.flow_id = body.flow_id
    if body.auto_import is not None:
        m.auto_import = body.auto_import
    if body.import_interval_minutes is not None:
        m.import_interval_minutes = body.import_interval_minutes
    if body.is_active is not None:
        m.is_active = body.is_active

    await db.commit()
    await db.refresh(m)

    repo_display = None
    if m.repo_mapping_id:
        repo = (await db.execute(select(RepoMapping).where(RepoMapping.id == m.repo_mapping_id))).scalar_one_or_none()
        if repo:
            repo_display = f'{repo.owner}/{repo.repo_name}'

    return SentryProjectMappingResponse(
        id=m.id,
        project_slug=m.project_slug,
        project_name=m.project_name,
        repo_mapping_id=m.repo_mapping_id,
        repo_display_name=repo_display,
        flow_id=m.flow_id,
        auto_import=m.auto_import,
        import_interval_minutes=m.import_interval_minutes,
        last_import_at=m.last_import_at.isoformat() if m.last_import_at else None,
        is_active=m.is_active,
    )


@router.delete('/mappings/{mapping_id}')
async def delete_mapping(
    mapping_id: int,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    m = (await db.execute(
        select(SentryProjectMapping).where(
            SentryProjectMapping.id == mapping_id,
            SentryProjectMapping.organization_id == tenant.organization_id,
        )
    )).scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=404, detail='Mapping not found')
    await db.delete(m)
    await db.commit()
    return {'ok': True}
