from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_models.models.refinement_record import RefinementRecord
from agena_models.schemas.refinement import (
    RefinementAnalyzeRequest,
    RefinementAnalyzeResponse,
    RefinementItemsResponse,
    RefinementWritebackRequest,
    RefinementWritebackResponse,
)
from agena_services.services.refinement_history_indexer import (
    RefinementHistoryIndexer,
    get_backfill_job,
)
from agena_services.services.refinement_service import RefinementService

router = APIRouter(prefix='/refinement', tags=['refinement'])

# Keep strong refs to in-flight backfill tasks so asyncio doesn't GC them
# out from under us. Per-org since only one backfill runs at a time.
_BACKFILL_TASKS: dict[int, object] = {}


class RefinementHistoryItem(BaseModel):
    id: int
    provider: str
    external_item_id: str
    sprint_name: str | None = None
    item_title: str | None = None
    item_url: str | None = None
    phase: str
    status: str
    suggested_story_points: int | None = None
    confidence: int | None = None
    summary: str | None = None
    estimation_rationale: str | None = None
    comment: str | None = None
    error_message: str | None = None
    created_at: str

    class Config:
        from_attributes = True


@router.get('/history')
async def list_refinement_history(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    base = select(RefinementRecord).where(RefinementRecord.organization_id == tenant.organization_id)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(RefinementRecord.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()
    return {
        'items': [
            RefinementHistoryItem(
                id=r.id, provider=r.provider, external_item_id=r.external_item_id,
                sprint_name=r.sprint_name, item_title=r.item_title, item_url=r.item_url,
                phase=r.phase, status=r.status,
                suggested_story_points=r.suggested_story_points, confidence=r.confidence,
                summary=r.summary, estimation_rationale=r.estimation_rationale,
                comment=r.comment, error_message=r.error_message,
                created_at=r.created_at.isoformat() if r.created_at else '',
            ) for r in rows
        ],
        'total': total,
        'page': page,
        'page_size': page_size,
    }


@router.get('/items', response_model=RefinementItemsResponse)
async def list_refinement_items(
    provider: str = Query(...),
    project: str | None = Query(default=None),
    team: str | None = Query(default=None),
    sprint_path: str | None = Query(default=None),
    sprint_name: str | None = Query(default=None),
    board_id: str | None = Query(default=None),
    sprint_id: str | None = Query(default=None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> RefinementItemsResponse:
    service = RefinementService(db)
    try:
        return await service.list_items(
            tenant.organization_id,
            provider=provider,
            project=project,
            team=team,
            sprint_path=sprint_path,
            sprint_name=sprint_name,
            board_id=board_id,
            sprint_id=sprint_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post('/analyze', response_model=RefinementAnalyzeResponse)
async def analyze_refinement(
    payload: RefinementAnalyzeRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> RefinementAnalyzeResponse:
    service = RefinementService(db)
    try:
        return await service.analyze(tenant.organization_id, tenant.user_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class RefinementAskQuestionRequest(BaseModel):
    work_item_id: str  # Azure WIT id or Jira issue key
    source: str  # 'azure' | 'jira'
    question: str  # the ambiguity / question text
    mention_unique_name: str | None = None  # UPN/email to @mention
    mention_display_name: str | None = None
    project: str | None = None  # Azure project name


@router.post('/ask-question')
async def ask_refinement_question(
    payload: RefinementAskQuestionRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    """Post an ambiguity / question from a refinement suggestion as a
    comment on the originating Azure / Jira work item, optionally with
    an @mention so the assignee is notified."""
    src = (payload.source or '').strip().lower()
    qtext = (payload.question or '').strip()
    wid = (payload.work_item_id or '').strip()
    if not qtext or not wid:
        raise HTTPException(status_code=400, detail='question and work_item_id are required')

    from agena_services.services.integration_config_service import IntegrationConfigService
    cfg_service = IntegrationConfigService(db)

    if src == 'azure':
        cfg = await cfg_service.get_config(tenant.organization_id, 'azure')
        if cfg is None or not cfg.secret:
            raise HTTPException(status_code=400, detail='Azure integration not configured')
        from agena_services.integrations.azure_client import AzureDevOpsClient
        client = AzureDevOpsClient()
        # Same plain-`@upn` mention pattern the nudge service uses (the
        # Azure comment renderer auto-resolves it into a notifying anchor).
        mention_html = ''
        upn = (payload.mention_unique_name or '').strip()
        if upn and '@' in upn:
            import html as _h
            mention_html = f'@{_h.escape(upn)} '
        # Wrap question text in basic HTML, escape the question itself.
        import html as _h2
        body_html = (
            f'<div>{mention_html}<strong>Refinement sorusu:</strong> '
            f'{_h2.escape(qtext)}</div>'
        )
        try:
            await client.post_raw_html_comment(
                cfg={'org_url': cfg.base_url or '', 'pat': cfg.secret},
                work_item_id=wid,
                html_body=body_html,
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f'Azure comment failed: {exc}')
        return {'status': 'ok'}

    if src == 'jira':
        cfg = await cfg_service.get_config(tenant.organization_id, 'jira')
        if cfg is None or not cfg.secret:
            raise HTTPException(status_code=400, detail='Jira integration not configured')
        import base64, httpx
        email = (cfg.username or '').strip()
        if not email:
            raise HTTPException(status_code=400, detail='Jira email missing in integration config')
        creds = base64.b64encode(f'{email}:{cfg.secret}'.encode()).decode()
        base = (cfg.base_url or '').rstrip('/')
        url = f'{base}/rest/api/3/issue/{wid}/comment'
        # Jira ADF body — minimal paragraph. Mention requires the
        # member's accountId which we don't have here; fall back to
        # plain text "@email" prefix.
        prefix = f'@{(payload.mention_unique_name or "").strip()} ' if payload.mention_unique_name else ''
        body = {
            'body': {
                'type': 'doc', 'version': 1,
                'content': [{
                    'type': 'paragraph',
                    'content': [{
                        'type': 'text',
                        'text': f'{prefix}Refinement sorusu: {qtext}',
                    }],
                }],
            },
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, headers={
                'Authorization': f'Basic {creds}', 'Content-Type': 'application/json',
            }, json=body)
            if resp.status_code >= 400:
                raise HTTPException(status_code=502, detail=f'Jira returned {resp.status_code}: {resp.text[:200]}')
        return {'status': 'ok'}

    raise HTTPException(status_code=400, detail='source must be azure or jira')


@router.get('/file-history')
async def file_history(
    repo_mapping_id: int,
    path: str,
    limit: int = 8,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Recent commits that touched a path inside one of the org's local
    checkouts. Used by the refinement card's "blame this file" affordance
    so the user can see exactly who edited each touched file last.
    """
    import os, subprocess
    from pathlib import Path
    from agena_models.models.repo_mapping import RepoMapping

    rm = await db.get(RepoMapping, repo_mapping_id)
    if rm is None or rm.organization_id != tenant.organization_id:
        raise HTTPException(status_code=404, detail='Repo mapping not found')
    local = (rm.local_repo_path or '').strip()
    if not local:
        raise HTTPException(status_code=400, detail='Repo mapping has no local checkout')
    root = Path(local).expanduser().resolve()
    rel = path.lstrip('/')
    target = (root / rel).resolve()
    # Path-traversal guard: target must live inside the checkout root.
    try:
        target.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=400, detail='Path escapes repo root')
    if not target.exists():
        raise HTTPException(status_code=404, detail='File not found in checkout')

    env = {**os.environ, 'GIT_CONFIG_COUNT': '1',
           'GIT_CONFIG_KEY_0': 'safe.directory',
           'GIT_CONFIG_VALUE_0': str(root)}
    try:
        result = subprocess.run(
            ['git', '-C', str(root), 'log',
             f'-n', str(max(1, min(50, limit))),
             '--pretty=%h%x09%aI%x09%aN%x09%aE%x09%s',
             '--', rel],
            capture_output=True, text=True, timeout=10, env=env,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'git log failed: {exc}')
    if result.returncode != 0:
        raise HTTPException(status_code=502, detail=f'git: {result.stderr[:200]}')
    commits: list[dict] = []
    for line in (result.stdout or '').splitlines():
        parts = line.split('\t', 4)
        if len(parts) < 5:
            continue
        commits.append({
            'sha': parts[0],
            'date': parts[1],
            'author_name': parts[2],
            'author_email': parts[3],
            'subject': parts[4],
        })
    return {'path': rel, 'repo': f'{rm.provider}:{rm.owner}/{rm.repo_name}', 'commits': commits}


class RefinementAssignAuthorRequest(BaseModel):
    work_item_id: str  # Azure work item id or Jira issue key
    source: str  # 'azure' | 'jira'
    member_unique_name: str  # UPN for Azure, email for Jira
    project: str | None = None  # required for Azure (project name)


@router.post('/assign-author')
async def assign_recommended_author(
    payload: RefinementAssignAuthorRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    """Assign a work item to a refinement-recommended author. Backed by
    Azure REST PATCH (`/_apis/wit/workitems/{id}`) or Jira REST PUT
    (`/rest/api/3/issue/{key}/assignee`)."""
    src = (payload.source or '').strip().lower()
    upn = (payload.member_unique_name or '').strip()
    wid = (payload.work_item_id or '').strip()
    if not wid or not upn:
        raise HTTPException(status_code=400, detail='work_item_id and member_unique_name are required')

    from agena_services.services.integration_config_service import IntegrationConfigService
    cfg_service = IntegrationConfigService(db)

    if src == 'azure':
        cfg = await cfg_service.get_config(tenant.organization_id, 'azure')
        if cfg is None or not cfg.secret:
            raise HTTPException(status_code=400, detail='Azure integration not configured')
        org_url = (cfg.base_url or '').rstrip('/')
        project = (payload.project or '').strip()
        if not project:
            raise HTTPException(status_code=400, detail='project is required for Azure')
        import base64, httpx
        token = base64.b64encode(f':{cfg.secret}'.encode()).decode()
        url = f'{org_url}/{project}/_apis/wit/workitems/{wid}?api-version=7.1-preview.3'
        headers = {
            'Authorization': f'Basic {token}',
            'Content-Type': 'application/json-patch+json',
        }
        body = [{'op': 'add', 'path': '/fields/System.AssignedTo', 'value': upn}]
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.patch(url, headers=headers, json=body)
            if resp.status_code >= 400:
                raise HTTPException(status_code=502, detail=f'Azure returned {resp.status_code}: {resp.text[:200]}')
        return {'status': 'ok', 'assignee': upn}

    if src == 'jira':
        cfg = await cfg_service.get_config(tenant.organization_id, 'jira')
        if cfg is None or not cfg.secret:
            raise HTTPException(status_code=400, detail='Jira integration not configured')
        import base64, httpx
        email = (cfg.username or '').strip()
        if not email:
            raise HTTPException(status_code=400, detail='Jira email missing in integration config')
        creds = base64.b64encode(f'{email}:{cfg.secret}'.encode()).decode()
        base = (cfg.base_url or '').rstrip('/')
        url = f'{base}/rest/api/3/issue/{wid}/assignee'
        headers = {
            'Authorization': f'Basic {creds}',
            'Content-Type': 'application/json',
        }
        # Jira accepts {emailAddress} on Cloud; on Data Center it's {name}.
        body = {'emailAddress': upn}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.put(url, headers=headers, json=body)
            if resp.status_code >= 400:
                raise HTTPException(status_code=502, detail=f'Jira returned {resp.status_code}: {resp.text[:200]}')
        return {'status': 'ok', 'assignee': upn}

    raise HTTPException(status_code=400, detail='source must be azure or jira')


@router.post('/writeback', response_model=RefinementWritebackResponse)
async def writeback_refinement(
    payload: RefinementWritebackRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> RefinementWritebackResponse:
    service = RefinementService(db)
    try:
        return await service.writeback(tenant.organization_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class RefinementBackfillRequest(BaseModel):
    source: str = 'azure'
    project: str | None = None
    team: str | None = None
    board_id: str | None = None
    since_days: int | None = 365
    max_items: int = 500


@router.post('/history/backfill')
async def backfill_refinement_history(
    payload: RefinementBackfillRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
) -> dict:
    """Kick off a background backfill of completed work items into Qdrant.

    Returns immediately — the actual work (WIQL + embedding hundreds of items)
    can take minutes and would time out the HTTP request if run synchronously.
    Poll GET /refinement/history/backfill-status for progress.
    """
    import asyncio
    import logging as _logging
    from agena_core.database import SessionLocal
    from agena_services.services.refinement_history_indexer import _mark_job

    _log = _logging.getLogger(__name__)

    async def _runner() -> None:
        try:
            _log.info('Backfill runner starting for org=%s source=%s project=%s team=%s',
                      tenant.organization_id, payload.source, payload.project, payload.team)
            async with SessionLocal() as session:
                await RefinementHistoryIndexer.run_backfill_job(
                    session,
                    tenant.organization_id,
                    source=payload.source,
                    project=payload.project,
                    team=payload.team,
                    board_id=payload.board_id,
                    since_days=payload.since_days,
                    max_items=payload.max_items,
                )
        except Exception as exc:
            _log.exception('Backfill runner crashed for org=%s: %s', tenant.organization_id, exc)
            _mark_job(tenant.organization_id, status='failed', error=f'runner crash: {exc}'[:400])

    # Keep a strong reference so the task isn't GC'd mid-flight
    task = asyncio.create_task(_runner())
    _BACKFILL_TASKS[tenant.organization_id] = task
    return {'status': 'started', 'organization_id': tenant.organization_id}


@router.get('/history/backfill-status')
async def backfill_refinement_status(
    tenant: CurrentTenant = Depends(get_current_tenant),
) -> dict:
    """Return the current/last backfill job state for this org."""
    job = get_backfill_job(tenant.organization_id)
    if job is None:
        return {'status': 'idle'}
    return {'status': job.get('status', 'idle'), **{k: v for k, v in job.items() if k != 'status'}}


@router.get('/history/preview')
async def refinement_history_preview(
    tenant: CurrentTenant = Depends(get_current_tenant),
) -> dict:
    """Summarize what's currently in the refinement index for this org:
    total count, SP distribution, top assignees, and the most-recent samples.
    """
    from collections import Counter
    from agena_agents.memory.qdrant import QdrantMemoryStore

    store = QdrantMemoryStore()
    if not store.enabled:
        return {'enabled': False, 'total': 0, 'sp_distribution': [], 'top_assignees': [], 'samples': []}

    try:
        rows = await store.scroll_by_filters(
            organization_id=tenant.organization_id,
            extra_filters={'kind': 'completed_task'},
            limit=10000,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Qdrant scroll failed: {exc}') from exc

    total = len(rows)
    sp_counter: Counter[int] = Counter()
    assignee_counter: Counter[str] = Counter()
    type_counter: Counter[str] = Counter()
    for r in rows:
        sp = r.get('story_points')
        try:
            sp_int = int(sp) if sp is not None else 0
        except (TypeError, ValueError):
            sp_int = 0
        if sp_int > 0:
            sp_counter[sp_int] += 1
        who = str(r.get('assigned_to') or '').strip() or '(atanmadı)'
        assignee_counter[who] += 1
        wt = str(r.get('work_item_type') or '').strip() or '(bilinmiyor)'
        type_counter[wt] += 1

    samples = [
        {
            'external_id': r.get('external_id'),
            'title': r.get('title'),
            'story_points': r.get('story_points'),
            'assigned_to': r.get('assigned_to') or '',
            'url': r.get('url') or '',
            'work_item_type': r.get('work_item_type') or '',
            'source': r.get('source') or '',
            'sprint_name': r.get('sprint_name') or '',
            'sprint_path': r.get('sprint_path') or '',
            'completed_at': r.get('completed_at') or '',
            'created_at': r.get('created_at') or '',
        }
        for r in rows[:200]
    ]

    return {
        'enabled': True,
        'total': total,
        'sp_distribution': [{'sp': sp, 'count': c} for sp, c in sorted(sp_counter.items())],
        'top_assignees': [{'name': n, 'count': c} for n, c in assignee_counter.most_common(10)],
        'work_item_types': [{'type': t, 'count': c} for t, c in type_counter.most_common(10)],
        'samples': samples,
    }


@router.get('/history/items')
async def refinement_history_items(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    sp: int | None = Query(default=None),
    assignee: str | None = Query(default=None),
    q: str | None = Query(default=None),
    sort: str = Query(default='recent'),
    tenant: CurrentTenant = Depends(get_current_tenant),
) -> dict:
    """Paginated, filterable list of everything we've indexed. Filters and
    sort run in-memory over the full scroll (capped at 10k) because the
    dataset per-team is small enough that a single scroll is cheaper than
    maintaining server-side filter indexes.
    """
    from agena_agents.memory.qdrant import QdrantMemoryStore

    store = QdrantMemoryStore()
    if not store.enabled:
        return {'items': [], 'total': 0, 'page': page, 'page_size': page_size, 'total_pages': 0}

    try:
        rows = await store.scroll_by_filters(
            organization_id=tenant.organization_id,
            extra_filters={'kind': 'completed_task'},
            limit=10000,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Qdrant scroll failed: {exc}') from exc

    # Filter
    filtered = []
    q_lc = (q or '').strip().lower()
    for r in rows:
        if sp is not None:
            try:
                if int(r.get('story_points') or 0) != int(sp):
                    continue
            except (TypeError, ValueError):
                continue
        if assignee and str(r.get('assigned_to') or '') != assignee:
            continue
        if q_lc:
            hay = (
                f"{r.get('title') or ''} {r.get('external_id') or ''} "
                f"{r.get('assigned_to') or ''} {r.get('sprint_name') or ''}"
            ).lower()
            if q_lc not in hay:
                continue
        filtered.append(r)

    # Sort
    if sort == 'sp_desc':
        filtered.sort(key=lambda r: int(r.get('story_points') or 0), reverse=True)
    elif sort == 'sp_asc':
        filtered.sort(key=lambda r: int(r.get('story_points') or 0))
    elif sort == 'assignee':
        filtered.sort(key=lambda r: str(r.get('assigned_to') or '').lower())
    else:  # recent
        filtered.sort(key=lambda r: (r.get('completed_at') or r.get('created_at') or ''), reverse=True)

    total = len(filtered)
    start = (page - 1) * page_size
    page_slice = filtered[start:start + page_size]
    return {
        'items': [
            {
                'external_id': r.get('external_id'),
                'title': r.get('title'),
                'story_points': r.get('story_points'),
                'assigned_to': r.get('assigned_to') or '',
                'url': r.get('url') or '',
                'work_item_type': r.get('work_item_type') or '',
                'source': r.get('source') or '',
                'sprint_name': r.get('sprint_name') or '',
                'sprint_path': r.get('sprint_path') or '',
                'completed_at': r.get('completed_at') or '',
                'created_at': r.get('created_at') or '',
                'state': r.get('state') or '',
            }
            for r in page_slice
        ],
        'total': total,
        'page': page,
        'page_size': page_size,
        'total_pages': max(1, (total + page_size - 1) // page_size) if total else 0,
    }


@router.post('/debug/similarity')
async def debug_similarity(
    payload: dict,
    tenant: CurrentTenant = Depends(get_current_tenant),
) -> dict:
    """Diagnostic: given a work-item title+description, show the exact text
    that gets embedded and the top-10 Qdrant hits with payload snippets.
    Use this to verify whether low-quality matches come from bad embedding
    input or from genuinely missing history."""
    from agena_agents.memory.qdrant import QdrantMemoryStore
    from agena_services.services.refinement_history_indexer import RefinementHistoryIndexer

    title = str(payload.get('title') or '').strip()
    description = str(payload.get('description') or '').strip()
    if not title and not description:
        raise HTTPException(status_code=400, detail='title or description required')
    clean_desc = RefinementHistoryIndexer._clean_html(description)
    embed_input = '\n\n'.join(p for p in [title, clean_desc[:1500]] if p).strip()
    store = QdrantMemoryStore()
    if not store.enabled:
        return {'error': 'Qdrant disabled', 'embed_input': embed_input}
    rows = await store.search_similar(
        embed_input,
        limit=10,
        organization_id=tenant.organization_id,
        extra_filters={'kind': 'completed_task'},
    )
    return {
        'embed_input': embed_input[:2000],
        'embed_input_length': len(embed_input),
        'hits': [
            {
                'score': r.get('_score'),
                'external_id': r.get('external_id'),
                'title': r.get('title'),
                'story_points': r.get('story_points'),
                'assigned_to': r.get('assigned_to'),
                'work_item_type': r.get('work_item_type'),
                'branches': r.get('branches') or [],
                'pr_titles': r.get('pr_titles') or [],
            }
            for r in rows
        ],
    }


@router.get('/history/status')
async def refinement_history_status(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Expose Qdrant collection stats so the UI can show whether the
    backfill has populated data."""
    from agena_agents.memory.qdrant import QdrantMemoryStore
    _ = tenant  # tenant auth required; stats are global-level (collection-scoped)
    _ = db
    store = QdrantMemoryStore()
    try:
        status = await store.get_status()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Qdrant status failed: {exc}') from exc
    return status
