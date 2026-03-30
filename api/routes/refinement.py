from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentTenant, get_current_tenant
from core.database import get_db_session
from schemas.refinement import (
    RefinementAnalyzeRequest,
    RefinementAnalyzeResponse,
    RefinementItemsResponse,
    RefinementWritebackRequest,
    RefinementWritebackResponse,
)
from services.refinement_service import RefinementService

router = APIRouter(prefix='/refinement', tags=['refinement'])


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
