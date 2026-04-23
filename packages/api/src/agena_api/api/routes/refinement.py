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
    from agena_core.database import SessionLocal

    async def _runner() -> None:
        # Use a fresh session bound to the background task's event loop
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

    asyncio.create_task(_runner())
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
