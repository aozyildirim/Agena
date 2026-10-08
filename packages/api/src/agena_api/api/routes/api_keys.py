"""Organization API keys (owner / admin, interactive sessions only)."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, require_permission
from agena_core.database import get_db_session
from agena_services.services.api_key_service import ApiKeyService

router = APIRouter(prefix='/api-keys', tags=['api-keys'])


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: str = 'member'
    expires_in_days: int | None = Field(default=None, ge=1, le=3650)


class ApiKeyItem(BaseModel):
    id: int
    name: str
    key_prefix: str
    role: str
    status: str
    created_by_user_id: int | None = None
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime | None = None
    revoked_at: datetime | None = None


class ApiKeyCreated(ApiKeyItem):
    # Plaintext, returned exactly once.
    key: str


def _interactive_only(tenant: CurrentTenant) -> None:
    # A key that could mint further keys would outlive its own revocation.
    if tenant.api_key_id is not None:
        raise HTTPException(status_code=403, detail='API keys cannot be managed with an API key')


@router.post('', response_model=ApiKeyCreated, status_code=201)
async def create_api_key(
    payload: ApiKeyCreateRequest,
    tenant: CurrentTenant = Depends(require_permission('api_keys:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> ApiKeyCreated:
    _interactive_only(tenant)
    try:
        row, plain = await ApiKeyService(db).create(
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            creator_role=tenant.role,
            name=payload.name,
            role=payload.role,
            expires_in_days=payload.expires_in_days,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    item = ApiKeyItem.model_validate(row, from_attributes=True)
    return ApiKeyCreated(**item.model_dump(), key=plain)


@router.get('', response_model=list[ApiKeyItem])
async def list_api_keys(
    tenant: CurrentTenant = Depends(require_permission('api_keys:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> list[ApiKeyItem]:
    rows = await ApiKeyService(db).list(tenant.organization_id)
    return [ApiKeyItem.model_validate(r, from_attributes=True) for r in rows]


@router.delete('/{key_id}', response_model=ApiKeyItem)
async def revoke_api_key(
    key_id: int,
    tenant: CurrentTenant = Depends(require_permission('api_keys:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> ApiKeyItem:
    _interactive_only(tenant)
    row = await ApiKeyService(db).revoke(tenant.organization_id, key_id)
    if row is None:
        raise HTTPException(status_code=404, detail='API key not found')
    return ApiKeyItem.model_validate(row, from_attributes=True)
