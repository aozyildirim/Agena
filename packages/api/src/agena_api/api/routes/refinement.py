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
