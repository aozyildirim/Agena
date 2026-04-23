from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_models.schemas.runtime import (
    RuntimeCreate,
    RuntimeHeartbeatRequest,
    RuntimeRegisterRequest,
    RuntimeRegisterResponse,
    RuntimeResponse,
    RuntimeUpdate,
)
from agena_services.services.runtime_service import (
    HEARTBEAT_INTERVAL_SEC,
    RuntimeService,
)

router = APIRouter(prefix='/runtimes', tags=['runtimes'])


# ----- UI-facing CRUD -----

@router.get('')
async def list_runtimes(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    service = RuntimeService(db)
    rows = await service.list(tenant.organization_id)
    return [service.to_response_dict(r) for r in rows]


@router.get('/{runtime_id}')
async def get_runtime(
    runtime_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    service = RuntimeService(db)
    row = await service.get(tenant.organization_id, runtime_id)
    if row is None:
        raise HTTPException(status_code=404, detail='Runtime not found')
    return service.to_response_dict(row)


@router.post('')
async def create_runtime(
    payload: RuntimeCreate,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    if not (payload.name or '').strip():
        raise HTTPException(status_code=400, detail='name is required')
    service = RuntimeService(db)
    row = await service.create(tenant.organization_id, payload, user_id=tenant.user_id)
    return service.to_response_dict(row)


@router.put('/{runtime_id}')
async def update_runtime(
    runtime_id: int,
    payload: RuntimeUpdate,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    service = RuntimeService(db)
    row = await service.update(tenant.organization_id, runtime_id, payload)
    if row is None:
        raise HTTPException(status_code=404, detail='Runtime not found')
    return service.to_response_dict(row)


@router.delete('/{runtime_id}')
async def delete_runtime(
    runtime_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    service = RuntimeService(db)
    ok = await service.delete(tenant.organization_id, runtime_id)
    if not ok:
        raise HTTPException(status_code=404, detail='Runtime not found')
    return {'deleted': True, 'id': runtime_id}


# ----- Daemon-facing endpoints -----
# These use tenant-from-token auth but are otherwise different from the UI
# endpoints: they do not require an interactive user session. A local CLI
# daemon calls /register once at startup with the user's JWT and receives
# a long-lived runtime token used for heartbeat/tasks-next.

@router.post('/register', response_model=RuntimeRegisterResponse)
async def register_runtime(
    payload: RuntimeRegisterRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> RuntimeRegisterResponse:
    if not (payload.name or '').strip():
        raise HTTPException(status_code=400, detail='name is required')
    service = RuntimeService(db)
    runtime, raw_token = await service.register(tenant.organization_id, payload)
    return RuntimeRegisterResponse(
        runtime_id=runtime.id,
        name=runtime.name,
        auth_token=raw_token,
        heartbeat_interval_sec=HEARTBEAT_INTERVAL_SEC,
    )


@router.post('/{runtime_id}/heartbeat')
async def runtime_heartbeat(
    runtime_id: int,
    payload: RuntimeHeartbeatRequest,
    x_runtime_token: str | None = Header(default=None, alias='X-Runtime-Token'),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    if not x_runtime_token:
        raise HTTPException(status_code=401, detail='Missing X-Runtime-Token header')
    service = RuntimeService(db)
    runtime = await service.heartbeat(
        runtime_id,
        x_runtime_token,
        available_clis=payload.available_clis,
        daemon_version=payload.daemon_version,
        host=payload.host,
    )
    if runtime is None:
        raise HTTPException(status_code=401, detail='Invalid runtime token')
    return {
        'ok': True,
        'status': service.derive_status(runtime),
        'heartbeat_interval_sec': HEARTBEAT_INTERVAL_SEC,
    }


@router.get('/{runtime_id}/tasks/next')
async def runtime_next_task(
    runtime_id: int,
    x_runtime_token: str | None = Header(default=None, alias='X-Runtime-Token'),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Stub endpoint daemons will poll for their next assigned task. This
    currently always returns {task: null} — task routing by runtime_id is
    a follow-up work item. The endpoint exists so daemons can be written
    against the stable shape before routing lands."""
    if not x_runtime_token:
        raise HTTPException(status_code=401, detail='Missing X-Runtime-Token header')
    # Token verification (don't leak whether runtime_id exists)
    service = RuntimeService(db)
    from agena_models.models.runtime import Runtime as _R
    runtime = await db.get(_R, runtime_id)
    if runtime is None or not runtime.auth_token_hash:
        raise HTTPException(status_code=401, detail='Invalid runtime token')
    from agena_services.services.runtime_service import _hash_token as _h
    if _h(x_runtime_token) != runtime.auth_token_hash:
        raise HTTPException(status_code=401, detail='Invalid runtime token')
    _ = service
    return {'task': None, 'poll_interval_sec': HEARTBEAT_INTERVAL_SEC}
