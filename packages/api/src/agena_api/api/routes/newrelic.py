from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant, require_permission
from agena_core.database import get_db_session
from agena_models.models.newrelic_entity_mapping import NewRelicEntityMapping
from agena_models.models.repo_mapping import RepoMapping
from agena_models.models.task_record import TaskRecord
from agena_models.schemas.newrelic import (
    NewRelicEntityMappingCreate,
    NewRelicEntityMappingResponse,
    NewRelicEntityMappingUpdate,
    NewRelicEntityResponse,
    NewRelicErrorGroup,
    NewRelicErrorListResponse,
)
from agena_services.integrations.newrelic_client import NewRelicClient
from agena_services.services.integration_config_service import IntegrationConfigService

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/newrelic', tags=['newrelic'])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

from agena_api.api.routes._work_item_url import build_work_item_url_resolver


async def _nr_cfg(db: AsyncSession, organization_id: int) -> dict[str, str]:
    svc = IntegrationConfigService(db)
    config = await svc.get_config(organization_id, 'newrelic')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='New Relic integration not configured')
    return {
        'api_key': config.secret,
        'base_url': config.base_url or 'https://api.newrelic.com/graphql',
    }


# ---------------------------------------------------------------------------
# Entity endpoints
# ---------------------------------------------------------------------------

@router.get('/entities', response_model=list[NewRelicEntityResponse])
async def list_entities(
    query: str = Query('', description='Search query'),
    entity_type: str = Query('', description='Filter by entity type'),
    domain: str = Query('', description='Filter by domain'),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[NewRelicEntityResponse]:
    cfg = await _nr_cfg(db, tenant.organization_id)
    client = NewRelicClient()
    try:
        entities = await client.search_entities(cfg, query=query, entity_type=entity_type, domain=domain)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            raise HTTPException(status_code=401, detail='New Relic API key is invalid') from exc
        raise HTTPException(status_code=502, detail=f'New Relic request failed ({exc.response.status_code})') from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'New Relic connection failed: {exc}') from exc

    return [
        NewRelicEntityResponse(
            guid=e.get('guid', ''),
            name=e.get('name', ''),
            entity_type=e.get('entityType', ''),
            domain=e.get('domain', ''),
            account_id=int(e.get('accountId', 0)),
            reporting=bool(e.get('reporting', True)),
            tags={t['key']: t['values'] for t in e.get('tags', []) if 'key' in t},
        )
        for e in entities
    ]


@router.get('/entities/{guid}')
async def get_entity(
    guid: str,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    cfg = await _nr_cfg(db, tenant.organization_id)
    client = NewRelicClient()
    entity = await client.get_entity(cfg, guid=guid)
    if entity is None:
        raise HTTPException(status_code=404, detail='Entity not found')
    return entity


@router.get('/entities/{guid}/errors', response_model=NewRelicErrorListResponse)
async def list_entity_errors(
    guid: str,
    since: str = Query('24 hours ago'),
    limit: int = Query(50, ge=1, le=500),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> NewRelicErrorListResponse:
    cfg = await _nr_cfg(db, tenant.organization_id)

    mapping = (await db.execute(
        select(NewRelicEntityMapping).where(
            NewRelicEntityMapping.organization_id == tenant.organization_id,
            NewRelicEntityMapping.entity_guid == guid,
        )
    )).scalar_one_or_none()

    if mapping:
        account_id = mapping.account_id
        entity_name = mapping.entity_name
    else:
        client = NewRelicClient()
        entity = await client.get_entity(cfg, guid=guid)
        if entity is None:
            raise HTTPException(status_code=404, detail='Entity not found')
        account_id = int(entity.get('accountId', 0))
        entity_name = entity.get('name', '')

    client = NewRelicClient()
    errors = await client.fetch_errors(cfg, account_id=account_id, app_name=entity_name, since=since, limit=limit)

    fingerprints = [e.get('fingerprint') for e in errors if e.get('fingerprint')]
    imported_map: dict[str, tuple[int, str | None]] = {}
    if fingerprints:
        rows = (await db.execute(
            select(TaskRecord.id, TaskRecord.external_id, TaskRecord.external_work_item_id).where(
                TaskRecord.organization_id == tenant.organization_id,
                TaskRecord.source == 'newrelic',
                TaskRecord.external_id.in_(fingerprints),
            )
        )).all()
        imported_map = {ext_id: (task_id, wi_id) for task_id, ext_id, wi_id in rows}

    wi_url_resolver = await build_work_item_url_resolver(db, tenant.organization_id)

    errors_out: list[NewRelicErrorGroup] = []
    for e in errors:
        fp = e['fingerprint']
        task_id, wi_id = imported_map.get(fp, (None, None))
        errors_out.append(NewRelicErrorGroup(
            error_class=e['error_class'],
            error_message=e['error_message'],
            occurrences=e['occurrences'],
            last_seen=str(e['last_seen']) if e.get('last_seen') is not None else None,
            fingerprint=fp,
            imported_task_id=task_id,
            imported_work_item_url=wi_url_resolver(wi_id) if wi_id else None,
        ))
    return NewRelicErrorListResponse(entity_name=entity_name, entity_guid=guid, errors=errors_out)


@router.get('/entities/{guid}/violations')
async def list_entity_violations(
    guid: str,
    since: str = Query('24 hours ago'),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    cfg = await _nr_cfg(db, tenant.organization_id)

    mapping = (await db.execute(
        select(NewRelicEntityMapping).where(
            NewRelicEntityMapping.organization_id == tenant.organization_id,
            NewRelicEntityMapping.entity_guid == guid,
        )
    )).scalar_one_or_none()
    account_id = mapping.account_id if mapping else 0
    if not account_id:
        raise HTTPException(status_code=400, detail='Entity mapping required for account_id resolution')

    client = NewRelicClient()
    return await client.fetch_violations(cfg, account_id=account_id, entity_guid=guid, since=since)


# ---------------------------------------------------------------------------
# Entity-to-Repo mapping CRUD
# ---------------------------------------------------------------------------

@router.get('/mappings', response_model=list[NewRelicEntityMappingResponse])
async def list_mappings(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[NewRelicEntityMappingResponse]:
    stmt = (
        select(NewRelicEntityMapping, RepoMapping.owner, RepoMapping.repo_name)
        .outerjoin(RepoMapping, NewRelicEntityMapping.repo_mapping_id == RepoMapping.id)
        .where(NewRelicEntityMapping.organization_id == tenant.organization_id)
        .order_by(NewRelicEntityMapping.entity_name)
    )
    rows = (await db.execute(stmt)).all()
    result: list[NewRelicEntityMappingResponse] = []
    for m, owner, repo_name in rows:
        repo_display = f'{owner}/{repo_name}' if owner and repo_name else None
        result.append(NewRelicEntityMappingResponse(
            id=m.id,
            entity_guid=m.entity_guid,
            entity_name=m.entity_name,
            entity_type=m.entity_type,
            account_id=m.account_id,
            repo_mapping_id=m.repo_mapping_id,
            repo_display_name=repo_display,
            flow_id=m.flow_id,
            auto_import=m.auto_import,
            import_interval_minutes=m.import_interval_minutes,
            last_import_at=m.last_import_at.isoformat() if m.last_import_at else None,
            is_active=m.is_active,
        ))
    return result


@router.post('/mappings', response_model=NewRelicEntityMappingResponse, status_code=201)
async def create_mapping(
    body: NewRelicEntityMappingCreate,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> NewRelicEntityMappingResponse:
    existing = (await db.execute(
        select(NewRelicEntityMapping).where(
            NewRelicEntityMapping.organization_id == tenant.organization_id,
            NewRelicEntityMapping.entity_guid == body.entity_guid,
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail='Entity mapping already exists')

    m = NewRelicEntityMapping(
        organization_id=tenant.organization_id,
        entity_guid=body.entity_guid,
        entity_name=body.entity_name,
        entity_type=body.entity_type,
        account_id=body.account_id,
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

    return NewRelicEntityMappingResponse(
        id=m.id,
        entity_guid=m.entity_guid,
        entity_name=m.entity_name,
        entity_type=m.entity_type,
        account_id=m.account_id,
        repo_mapping_id=m.repo_mapping_id,
        repo_display_name=repo_display,
        flow_id=m.flow_id,
        auto_import=m.auto_import,
        import_interval_minutes=m.import_interval_minutes,
        last_import_at=None,
        is_active=m.is_active,
    )


@router.put('/mappings/{mapping_id}', response_model=NewRelicEntityMappingResponse)
async def update_mapping(
    mapping_id: int,
    body: NewRelicEntityMappingUpdate,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> NewRelicEntityMappingResponse:
    m = (await db.execute(
        select(NewRelicEntityMapping).where(
            NewRelicEntityMapping.id == mapping_id,
            NewRelicEntityMapping.organization_id == tenant.organization_id,
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

    return NewRelicEntityMappingResponse(
        id=m.id,
        entity_guid=m.entity_guid,
        entity_name=m.entity_name,
        entity_type=m.entity_type,
        account_id=m.account_id,
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
        select(NewRelicEntityMapping).where(
            NewRelicEntityMapping.id == mapping_id,
            NewRelicEntityMapping.organization_id == tenant.organization_id,
        )
    )).scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=404, detail='Mapping not found')
    await db.delete(m)
    await db.commit()
    return {'ok': True}
