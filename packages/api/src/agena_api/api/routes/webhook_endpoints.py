"""Outbound webhooks (owner / admin): endpoints, test pings, delivery log."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, require_permission
from agena_core.database import get_db_session
from agena_services.services.notification_service import DEFAULT_EVENT_PREFS
from agena_services.services.webhook_service import WebhookService

router = APIRouter(prefix='/webhook-endpoints', tags=['webhook-endpoints'])


class EndpointIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=8, max_length=1024)
    events: list[str] = ['*']
    enabled: bool = True


class EndpointUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    url: str | None = Field(default=None, max_length=1024)
    events: list[str] | None = None
    enabled: bool | None = None


class EndpointOut(BaseModel):
    id: int
    name: str
    url: str
    events: list[str] | None = None
    enabled: bool
    failure_count: int
    last_delivery_at: datetime | None = None
    last_status: str | None = None
    created_at: datetime


class EndpointWithSecret(EndpointOut):
    # Shown on create / rotate only.
    secret: str


class DeliveryOut(BaseModel):
    id: int
    event_type: str
    status: str
    attempts: int
    response_status: int | None = None
    last_error: str | None = None
    next_attempt_at: datetime | None = None
    delivered_at: datetime | None = None
    created_at: datetime
    payload: dict[str, Any] | None = None


def _out(row) -> EndpointOut:
    return EndpointOut.model_validate(row, from_attributes=True)


def _with_secret(row) -> EndpointWithSecret:
    return EndpointWithSecret(**_out(row).model_dump(), secret=row.secret)


@router.get('/event-types', response_model=list[str])
async def list_event_types(tenant: CurrentTenant = Depends(require_permission('integrations:manage'))) -> list[str]:
    return sorted(set(DEFAULT_EVENT_PREFS) | {'ping'})


@router.get('', response_model=list[EndpointOut])
async def list_endpoints(
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> list[EndpointOut]:
    return [_out(r) for r in await WebhookService(db).list(tenant.organization_id)]


@router.post('', response_model=EndpointWithSecret, status_code=201)
async def create_endpoint(
    payload: EndpointIn,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> EndpointWithSecret:
    try:
        row = await WebhookService(db).create(
            organization_id=tenant.organization_id, user_id=tenant.user_id,
            name=payload.name, url=payload.url, events=payload.events, enabled=payload.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _with_secret(row)


@router.put('/{endpoint_id}', response_model=EndpointOut)
async def update_endpoint(
    endpoint_id: int,
    payload: EndpointUpdate,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> EndpointOut:
    svc = WebhookService(db)
    row = await svc.get_owned(tenant.organization_id, endpoint_id)
    if row is None:
        raise HTTPException(status_code=404, detail='Webhook endpoint not found')
    try:
        row = await svc.update(row, name=payload.name, url=payload.url, events=payload.events, enabled=payload.enabled)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _out(row)


@router.post('/{endpoint_id}/rotate-secret', response_model=EndpointWithSecret)
async def rotate_secret(
    endpoint_id: int,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> EndpointWithSecret:
    svc = WebhookService(db)
    row = await svc.get_owned(tenant.organization_id, endpoint_id)
    if row is None:
        raise HTTPException(status_code=404, detail='Webhook endpoint not found')
    return _with_secret(await svc.rotate_secret(row))


@router.post('/{endpoint_id}/test', response_model=DeliveryOut)
async def test_endpoint(
    endpoint_id: int,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> DeliveryOut:
    svc = WebhookService(db)
    row = await svc.get_owned(tenant.organization_id, endpoint_id)
    if row is None:
        raise HTTPException(status_code=404, detail='Webhook endpoint not found')
    delivery = await svc.send_test(row)
    return DeliveryOut.model_validate(delivery, from_attributes=True)


@router.get('/{endpoint_id}/deliveries', response_model=list[DeliveryOut])
async def list_deliveries(
    endpoint_id: int,
    limit: int = Query(default=30, ge=1, le=200),
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> list[DeliveryOut]:
    svc = WebhookService(db)
    row = await svc.get_owned(tenant.organization_id, endpoint_id)
    if row is None:
        raise HTTPException(status_code=404, detail='Webhook endpoint not found')
    return [DeliveryOut.model_validate(d, from_attributes=True) for d in await svc.list_deliveries(tenant.organization_id, endpoint_id, limit)]


@router.delete('/{endpoint_id}')
async def delete_endpoint(
    endpoint_id: int,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    svc = WebhookService(db)
    row = await svc.get_owned(tenant.organization_id, endpoint_id)
    if row is None:
        raise HTTPException(status_code=404, detail='Webhook endpoint not found')
    await svc.delete(row)
    return {'deleted': True}
