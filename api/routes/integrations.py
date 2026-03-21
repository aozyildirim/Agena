from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentTenant, get_current_tenant
from core.database import get_db_session
from schemas.integration import IntegrationConfigResponse, IntegrationConfigUpsertRequest
from services.integration_config_service import IntegrationConfigService

router = APIRouter(prefix='/integrations', tags=['integrations'])


@router.get('', response_model=list[IntegrationConfigResponse])
async def list_integrations(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[IntegrationConfigResponse]:
    service = IntegrationConfigService(db)
    items = await service.list_configs(tenant.organization_id)
    return [IntegrationConfigResponse(**service.to_public_dict(item)) for item in items]


@router.get('/{provider}', response_model=IntegrationConfigResponse)
async def get_integration(
    provider: str,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> IntegrationConfigResponse:
    service = IntegrationConfigService(db)
    try:
        item = await service.get_config(tenant.organization_id, provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if item is None:
        raise HTTPException(status_code=404, detail='Integration config not found')

    return IntegrationConfigResponse(**service.to_public_dict(item))


@router.put('/{provider}', response_model=IntegrationConfigResponse)
async def upsert_integration(
    provider: str,
    payload: IntegrationConfigUpsertRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> IntegrationConfigResponse:
    service = IntegrationConfigService(db)
    try:
        item = await service.upsert_config(
            organization_id=tenant.organization_id,
            provider=provider,
            base_url=payload.base_url,
            project=payload.project,
            username=payload.username,
            secret=payload.secret,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return IntegrationConfigResponse(**service.to_public_dict(item))
