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
    SentryAIFixPreviewRequest,
    SentryAIFixPreviewResponse,
    SentryEnvironmentItem,
    SentryIssueEventItem,
    SentryIssueEventListResponse,
    SentryIssueItem,
    SentryIssueListResponse,
    SentryIssuePreview,
    SentryProjectItem,
    SentryProjectListResponse,
    SentryProjectMappingCreate,
    SentryProjectMappingResponse,
    SentryProjectMappingUpdate,
    SentryReleaseItem,
    SentryStackFrame,
)
from agena_services.integrations.sentry_client import SentryClient
from agena_services.services.integration_config_service import IntegrationConfigService
from agena_services.services.llm.provider import LLMProvider

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
    environment: str | None = Query(None),
    release: str | None = Query(None),
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
            environment=environment,
            release=release,
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise HTTPException(status_code=401, detail='Sentry API token is invalid or lacks permissions') from exc
        raise HTTPException(status_code=502, detail=f'Sentry request failed ({exc.response.status_code})') from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'Sentry connection failed: {exc}') from exc

    project_key = project_slug.strip()
    external_ids = [f"{project_key}:{i.get('id')}" for i in issues if i.get('id')]
    imported_map: dict[str, tuple[int, str | None, str | None]] = {}
    if external_ids:
        rows = (await db.execute(
            select(TaskRecord.id, TaskRecord.external_id, TaskRecord.external_work_item_id, TaskRecord.status).where(
                TaskRecord.organization_id == tenant.organization_id,
                TaskRecord.source == 'sentry',
                TaskRecord.external_id.in_(external_ids),
            )
        )).all()
        imported_map = {ext_id: (task_id, wi_id, status) for task_id, ext_id, wi_id, status in rows}

    from agena_api.api.routes._work_item_url import build_work_item_url_resolver
    wi_resolver = await build_work_item_url_resolver(db, tenant.organization_id)

    parsed: list[SentryIssueItem] = []
    for i in issues:
        issue_id = str(i.get('id') or '')
        task_id, wi_id, task_status = imported_map.get(f'{project_key}:{issue_id}', (None, None, None))

        fixability_score: float | None = None
        raw_score = i.get('seerFixabilityScore')
        if raw_score is not None:
            try:
                fixability_score = round(float(raw_score), 2)
            except (ValueError, TypeError):
                fixability_score = None

        stats_24h: list[int] = []
        stats_obj = i.get('stats') or {}
        if isinstance(stats_obj, dict):
            for bucket_key in ('24h', '14d', '30d'):
                series = stats_obj.get(bucket_key)
                if isinstance(series, list) and series:
                    for entry in series:
                        if isinstance(entry, list) and len(entry) >= 2:
                            try:
                                stats_24h.append(int(entry[1]))
                            except (ValueError, TypeError):
                                stats_24h.append(0)
                    break

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
                first_seen=str(i.get('firstSeen') or '') or None,
                permalink=str(i.get('permalink') or '') or None,
                is_unhandled=bool(i.get('isUnhandled')),
                substatus=str(i.get('substatus') or '') or None,
                fixability_score=fixability_score,
                platform=str(i.get('platform') or '') or None,
                stats_24h=stats_24h,
                imported_task_id=task_id,
                imported_task_status=task_status,
                imported_work_item_url=wi_resolver(wi_id) if wi_id else None,
            )
        )

    return SentryIssueListResponse(
        organization_slug=cfg['organization_slug'],
        project_slug=project_slug.strip(),
        issues=parsed,
    )


@router.get('/projects/{project_slug}/environments', response_model=list[SentryEnvironmentItem])
async def list_sentry_environments(
    project_slug: str,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[SentryEnvironmentItem]:
    cfg = await _sentry_cfg(db, tenant.organization_id)
    client = SentryClient()
    try:
        envs = await client.list_environments(cfg, organization_slug=cfg['organization_slug'], project_slug=project_slug.strip())
    except httpx.HTTPError:
        return []
    out: list[SentryEnvironmentItem] = []
    for e in envs:
        name = str(e.get('name') or '').strip()
        if not name:
            continue
        out.append(SentryEnvironmentItem(name=name, is_hidden=bool(e.get('isHidden'))))
    return out


@router.get('/projects/{project_slug}/releases', response_model=list[SentryReleaseItem])
async def list_sentry_releases(
    project_slug: str,
    limit: int = Query(30, ge=1, le=100),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[SentryReleaseItem]:
    cfg = await _sentry_cfg(db, tenant.organization_id)
    client = SentryClient()
    try:
        rels = await client.list_releases(cfg, organization_slug=cfg['organization_slug'], project_slug=project_slug.strip(), limit=limit)
    except httpx.HTTPError:
        return []
    out: list[SentryReleaseItem] = []
    for r in rels:
        version = str(r.get('version') or '').strip()
        if not version:
            continue
        out.append(SentryReleaseItem(
            version=version,
            short_version=str(r.get('shortVersion') or '') or None,
            date_released=str(r.get('dateReleased') or '') or None,
            last_event=str(r.get('lastEvent') or '') or None,
        ))
    return out


def _build_repo_deeplink(repo: RepoMapping | None, filename: str | None, lineno: int | None) -> str | None:
    if repo is None or not filename:
        return None
    fn = filename.lstrip('/').lstrip('./')
    branch = (repo.base_branch or 'main').strip() or 'main'
    line_anchor = f'#L{lineno}' if lineno else ''
    if (repo.provider or '').lower() == 'github':
        return f'https://github.com/{repo.owner}/{repo.repo_name}/blob/{branch}/{fn}{line_anchor}'
    if (repo.provider or '').lower() == 'azure':
        # Azure DevOps: https://dev.azure.com/{org}/{project}/_git/{repo}?path=/{file}&version=GB{branch}&line=N
        line_q = f'&line={lineno}&lineEnd={lineno}&lineStartColumn=1&lineEndColumn=1' if lineno else ''
        return (
            f'https://dev.azure.com/{repo.owner}/{repo.owner}/_git/{repo.repo_name}'
            f'?path=/{fn}&version=GB{branch}{line_q}'
        )
    return None


async def _resolve_project_repo(db: AsyncSession, organization_id: int, issue_id: str) -> RepoMapping | None:
    """Best-effort: find the RepoMapping for the Sentry issue's project via SentryProjectMapping."""
    from agena_models.models.task_record import TaskRecord as _TaskRecord
    # First try: find an imported task for this issue → repo_mapping_id
    rows = (await db.execute(
        select(_TaskRecord.repo_mapping_id, _TaskRecord.external_id).where(
            _TaskRecord.organization_id == organization_id,
            _TaskRecord.source == 'sentry',
            _TaskRecord.external_id.like(f'%:{issue_id}'),
        ).limit(1)
    )).first()
    if rows and rows[0]:
        repo = (await db.execute(
            select(RepoMapping).where(RepoMapping.id == rows[0], RepoMapping.is_active.is_(True))
        )).scalar_one_or_none()
        if repo:
            return repo
    return None


@router.get('/issues/{issue_id}/preview', response_model=SentryIssuePreview)
async def get_sentry_issue_preview(
    issue_id: str,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> SentryIssuePreview:
    cfg = await _sentry_cfg(db, tenant.organization_id)
    client = SentryClient()
    try:
        event = await client.get_latest_event(cfg, organization_slug=cfg['organization_slug'], issue_id=issue_id.strip())
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'Sentry request failed: {exc}') from exc

    if not event:
        return SentryIssuePreview(issue_id=issue_id)

    repo = await _resolve_project_repo(db, tenant.organization_id, issue_id.strip())

    # Extract exception + frames
    exc_type: str | None = None
    exc_value: str | None = None
    frames: list[SentryStackFrame] = []
    entries = event.get('entries') or []
    if isinstance(entries, list):
        for entry in entries:
            if not isinstance(entry, dict) or str(entry.get('type') or '') != 'exception':
                continue
            values = ((entry.get('data') or {}).get('values') or [])
            if not isinstance(values, list) or not values:
                continue
            first = values[0] or {}
            exc_type = str(first.get('type') or '').strip() or None
            exc_value = str(first.get('value') or '').strip() or None
            raw_frames = ((first.get('stacktrace') or {}).get('frames') or [])
            if isinstance(raw_frames, list):
                # Sentry orders frames oldest-first; we want newest first, prefer in_app.
                ordered = list(reversed(raw_frames))
                in_app = [f for f in ordered if isinstance(f, dict) and f.get('inApp')]
                preferred = in_app if in_app else ordered
                for fr in preferred[:6]:
                    if not isinstance(fr, dict):
                        continue
                    fn = str(fr.get('filename') or '') or None
                    ln = int(fr.get('lineNo') or fr.get('lineno') or 0) or None
                    frames.append(SentryStackFrame(
                        filename=fn,
                        function=str(fr.get('function') or '') or None,
                        lineno=ln,
                        abs_path=str(fr.get('absPath') or '') or None,
                        in_app=bool(fr.get('inApp')),
                        context_line=str(fr.get('context_line') or fr.get('contextLine') or '') or None,
                        pre_context=[str(x) for x in (fr.get('pre_context') or fr.get('preContext') or []) if x is not None][-5:],
                        post_context=[str(x) for x in (fr.get('post_context') or fr.get('postContext') or []) if x is not None][:5],
                        repo_url=_build_repo_deeplink(repo, fn, ln) if bool(fr.get('inApp')) else None,
                    ))
            break

    # Tags → environment / release
    environment_tag: str | None = None
    release_tag: str | None = None
    tags_raw = event.get('tags') or []
    if isinstance(tags_raw, list):
        for tag in tags_raw:
            if isinstance(tag, dict):
                k = str(tag.get('key') or '').strip().lower()
                v = str(tag.get('value') or '').strip()
                if k == 'environment' and v:
                    environment_tag = v
                elif k == 'release' and v:
                    release_tag = v

    # Breadcrumbs (latest 8)
    breadcrumbs_out: list[dict] = []
    breadcrumb_entry = next((e for e in entries if isinstance(e, dict) and str(e.get('type') or '') == 'breadcrumbs'), None)
    if isinstance(breadcrumb_entry, dict):
        bvals = (breadcrumb_entry.get('data') or {}).get('values') or []
        if isinstance(bvals, list):
            for b in bvals[-8:]:
                if not isinstance(b, dict):
                    continue
                breadcrumbs_out.append({
                    'timestamp': str(b.get('timestamp') or '')[:19],
                    'category': str(b.get('category') or ''),
                    'level': str(b.get('level') or ''),
                    'message': str(b.get('message') or '')[:200],
                    'type': str(b.get('type') or ''),
                })

    request = event.get('request') or {}
    request_method = None
    request_url = None
    if isinstance(request, dict):
        request_method = str(request.get('method') or '') or None
        request_url = str(request.get('url') or '') or None

    event_id = str(event.get('eventID') or event.get('id') or '') or None

    return SentryIssuePreview(
        issue_id=issue_id,
        event_id=event_id,
        title=str(event.get('title') or '') or None,
        exception_type=exc_type,
        exception_value=exc_value,
        platform=str(event.get('platform') or '') or None,
        environment=environment_tag,
        release=release_tag,
        transaction=str(event.get('transaction') or '') or None,
        request_method=request_method,
        request_url=request_url,
        frames=frames,
        breadcrumbs=breadcrumbs_out,
        permalink=None,
    )


_AI_PREVIEW_CACHE: dict[str, SentryAIFixPreviewResponse] = {}


@router.post('/issues/{issue_id}/ai-preview', response_model=SentryAIFixPreviewResponse)
async def get_sentry_ai_fix_preview(
    issue_id: str,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> SentryAIFixPreviewResponse:
    cache_key = f'{tenant.organization_id}:{issue_id.strip()}'
    if cache_key in _AI_PREVIEW_CACHE:
        cached = _AI_PREVIEW_CACHE[cache_key]
        return SentryAIFixPreviewResponse(
            summary=cached.summary,
            suggested_fix=cached.suggested_fix,
            files_to_change=cached.files_to_change,
            confidence=cached.confidence,
            cached=True,
        )

    cfg = await _sentry_cfg(db, tenant.organization_id)
    client = SentryClient()
    try:
        event = await client.get_latest_event(cfg, organization_slug=cfg['organization_slug'], issue_id=issue_id.strip())
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'Sentry request failed: {exc}') from exc
    if not event:
        raise HTTPException(status_code=404, detail='No event data found for this issue')

    summary, stack_lines = client._extract_exception_summary(event)
    title = str(event.get('title') or '').strip()
    transaction = str(event.get('transaction') or '').strip()
    platform = str(event.get('platform') or '').strip()

    snippet = '\n'.join(stack_lines[:8]) if stack_lines else '(no stack trace available)'
    user_prompt = (
        f"Sentry issue title: {title or summary or '(unknown)'}\n"
        f"Exception: {summary or '(unknown)'}\n"
        f"Platform: {platform or 'unknown'}\n"
        f"Transaction: {transaction or 'n/a'}\n"
        f"Top stack frames (most recent first):\n{snippet}\n\n"
        "Return STRICT JSON with keys: summary (1-2 sentences explaining the bug), "
        "suggested_fix (3-6 sentences describing what to change), "
        "files_to_change (array of likely file paths from the stack), "
        "confidence (0-100 integer estimating how fixable this is from the available info). "
        "No markdown fences. Pure JSON only."
    )
    system_prompt = (
        "You are a senior engineer reviewing a production exception captured by Sentry. "
        "Read the stack trace and produce a concise root-cause hypothesis and a concrete fix plan. "
        "Respond with strict JSON; no prose, no code fences."
    )

    provider = LLMProvider()
    try:
        output, _usage, _model, _cached = await provider.generate(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            complexity_hint='normal',
            max_output_tokens=600,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'LLM call failed: {exc}') from exc

    import json as _json
    cleaned = (output or '').strip()
    if cleaned.startswith('```'):
        cleaned = cleaned.strip('`')
        if cleaned.lower().startswith('json'):
            cleaned = cleaned[4:].lstrip()
    try:
        parsed = _json.loads(cleaned)
    except Exception:
        parsed = {
            'summary': (cleaned[:280] or 'Could not parse AI output.'),
            'suggested_fix': '',
            'files_to_change': [],
            'confidence': 0,
        }

    files_raw = parsed.get('files_to_change') or []
    if not isinstance(files_raw, list):
        files_raw = []

    response = SentryAIFixPreviewResponse(
        summary=str(parsed.get('summary') or '')[:600],
        suggested_fix=str(parsed.get('suggested_fix') or '')[:1200],
        files_to_change=[str(f) for f in files_raw if str(f).strip()][:8],
        confidence=int(parsed.get('confidence') or 0),
        cached=False,
    )
    _AI_PREVIEW_CACHE[cache_key] = response
    if len(_AI_PREVIEW_CACHE) > 256:
        # Drop oldest entries; cheap eviction
        for k in list(_AI_PREVIEW_CACHE.keys())[:64]:
            _AI_PREVIEW_CACHE.pop(k, None)
    return response


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
