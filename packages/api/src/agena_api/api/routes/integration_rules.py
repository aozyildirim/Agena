from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant, require_permission
from agena_core.database import get_db_session
from agena_models.models.integration_rule import IntegrationRule
from agena_models.schemas.integration_rule import (
    IntegrationRuleCreate,
    IntegrationRuleResponse,
    IntegrationRuleUpdate,
)

router = APIRouter(prefix='/integration-rules', tags=['integration-rules'])

_ALLOWED_PROVIDERS = {'jira', 'azure'}


def _to_response(row: IntegrationRule) -> IntegrationRuleResponse:
    try:
        match = json.loads(row.match_json or '{}')
    except (json.JSONDecodeError, TypeError):
        match = {}
    try:
        action = json.loads(row.action_json or '{}')
    except (json.JSONDecodeError, TypeError):
        action = {}
    return IntegrationRuleResponse(
        id=row.id,
        provider=row.provider,
        name=row.name,
        match=match if isinstance(match, dict) else {},
        action=action if isinstance(action, dict) else {},
        is_active=row.is_active,
        sort_order=row.sort_order,
    )


def _strip_empty(d: dict) -> dict:
    out: dict = {}
    for k, v in d.items():
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        if isinstance(v, list) and not v:
            continue
        out[k] = v
    return out


@router.get('', response_model=list[IntegrationRuleResponse])
async def list_rules(
    provider: str | None = Query(None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[IntegrationRuleResponse]:
    stmt = select(IntegrationRule).where(IntegrationRule.organization_id == tenant.organization_id)
    if provider:
        if provider not in _ALLOWED_PROVIDERS:
            raise HTTPException(status_code=400, detail='provider must be jira or azure')
        stmt = stmt.where(IntegrationRule.provider == provider)
    stmt = stmt.order_by(IntegrationRule.provider, IntegrationRule.sort_order, IntegrationRule.id)
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_response(r) for r in rows]


@router.post('', response_model=IntegrationRuleResponse, status_code=201)
async def create_rule(
    body: IntegrationRuleCreate,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> IntegrationRuleResponse:
    if body.provider not in _ALLOWED_PROVIDERS:
        raise HTTPException(status_code=400, detail='provider must be jira or azure')
    if not body.name.strip():
        raise HTTPException(status_code=400, detail='name is required')
    match = _strip_empty(body.match.model_dump())
    action = _strip_empty(body.action.model_dump())
    if not match:
        raise HTTPException(status_code=400, detail='match must contain at least one criterion')
    if not action:
        raise HTTPException(status_code=400, detail='action must contain at least one effect')

    row = IntegrationRule(
        organization_id=tenant.organization_id,
        provider=body.provider,
        name=body.name.strip(),
        match_json=json.dumps(match, ensure_ascii=False),
        action_json=json.dumps(action, ensure_ascii=False),
        is_active=body.is_active,
        sort_order=body.sort_order,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _to_response(row)


@router.put('/{rule_id}', response_model=IntegrationRuleResponse)
async def update_rule(
    rule_id: int,
    body: IntegrationRuleUpdate,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> IntegrationRuleResponse:
    row = (await db.execute(
        select(IntegrationRule).where(
            IntegrationRule.id == rule_id,
            IntegrationRule.organization_id == tenant.organization_id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail='Rule not found')
    if body.name is not None:
        row.name = body.name.strip() or row.name
    if body.match is not None:
        row.match_json = json.dumps(_strip_empty(body.match.model_dump()), ensure_ascii=False)
    if body.action is not None:
        row.action_json = json.dumps(_strip_empty(body.action.model_dump()), ensure_ascii=False)
    if body.is_active is not None:
        row.is_active = body.is_active
    if body.sort_order is not None:
        row.sort_order = body.sort_order
    await db.commit()
    await db.refresh(row)
    return _to_response(row)


@router.delete('/{rule_id}', status_code=204, response_model=None)
async def delete_rule(
    rule_id: int,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
):
    row = (await db.execute(
        select(IntegrationRule).where(
            IntegrationRule.id == rule_id,
            IntegrationRule.organization_id == tenant.organization_id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail='Rule not found')
    await db.delete(row)
    await db.commit()
