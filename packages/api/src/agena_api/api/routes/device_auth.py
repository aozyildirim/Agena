"""RFC 8628-style device authorization flow for CLI + headless clients.

High-level:

  1. CLI calls  POST /auth/device/code   → backend returns
                                          { device_code, user_code,
                                            verification_uri,
                                            verification_uri_complete,
                                            expires_in, interval }
  2. CLI prints user_code + URL, opens the browser, and polls
     POST /auth/device/token with device_code every `interval`s.
     While the user hasn't approved, this returns 428 Precondition
     Required (still pending).
  3. User visits /auth/device in the dashboard while logged in,
     confirms the user_code, picks a tenant. Frontend calls
     POST /auth/device/approve {user_code, tenant_slug} to bind.
  4. Next CLI poll returns 200 with {access_token, tenant_slug,
     organization_id}. CLI stores the token in keychain.

Pending codes live in-memory per API worker. Fine for single-worker
dev + the current production footprint. When the backend scales
horizontally the store moves to Redis — the route shapes don't change.
"""
from __future__ import annotations

import logging
import secrets
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_core.security.jwt import create_access_token
from agena_core.settings import get_settings
from agena_models.models.organization import Organization
from agena_models.models.organization_member import OrganizationMember

router = APIRouter(prefix='/auth/device', tags=['auth'])
logger = logging.getLogger(__name__)

# expires_in seconds after issuance
DEVICE_CODE_TTL = 600
# CLI polls every `interval` seconds; we enforce a minimum server-side
POLL_INTERVAL = 5

# In-memory store. Entries are:
#   { device_code, user_code, created_at, status,
#     user_id, organization_id, tenant_slug, jwt }
# status values: 'pending' | 'approved' | 'expired' | 'denied'
_STORE: dict[str, dict[str, Any]] = {}


def _gc_expired() -> None:
    now = time.time()
    stale = [k for k, v in _STORE.items() if now - v['created_at'] > DEVICE_CODE_TTL]
    for k in stale:
        _STORE[k]['status'] = 'expired'


# ------------------------- request / response models

class DeviceCodeRequest(BaseModel):
    client_name: str | None = None


class DeviceCodeResponse(BaseModel):
    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: str
    expires_in: int
    interval: int


class DeviceTokenRequest(BaseModel):
    device_code: str


class DeviceTokenResponse(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    tenant_slug: str
    organization_id: int


class DeviceApproveRequest(BaseModel):
    user_code: str
    tenant_slug: str


# ------------------------- routes

@router.post('/code', response_model=DeviceCodeResponse)
async def create_device_code(payload: DeviceCodeRequest) -> DeviceCodeResponse:
    _gc_expired()
    device_code = secrets.token_urlsafe(32)
    # User code is short + visually distinct (no ambiguous chars)
    alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    user_code = '-'.join(
        ''.join(secrets.choice(alphabet) for _ in range(4)) for _ in range(2)
    )
    _STORE[device_code] = {
        'device_code': device_code,
        'user_code': user_code,
        'created_at': time.time(),
        'status': 'pending',
        'client_name': (payload.client_name or 'agena-cli')[:64],
    }
    # Best-effort: also index by user_code for the approve route
    _STORE[f'uc:{user_code}'] = {'device_code': device_code}

    settings = get_settings()
    # Pick the "user-facing" CORS origin — skip entries with wildcards or
    # that look like API hosts. In dev that lands on http://localhost:3010;
    # in prod on the first non-wildcard https entry.
    web_base = ''
    for origin in settings.cors_origins:
        o = origin.strip().rstrip('/')
        if not o or '*' in o:
            continue
        if o.startswith('http://localhost'):
            web_base = o
            break
        web_base = web_base or o
    if not web_base:
        web_base = 'https://agena.dev'
    verification_uri = f'{web_base}/auth/device'
    verification_uri_complete = f'{verification_uri}?user_code={user_code}'
    return DeviceCodeResponse(
        device_code=device_code,
        user_code=user_code,
        verification_uri=verification_uri,
        verification_uri_complete=verification_uri_complete,
        expires_in=DEVICE_CODE_TTL,
        interval=POLL_INTERVAL,
    )


@router.post('/token')
async def poll_device_token(payload: DeviceTokenRequest) -> dict:
    _gc_expired()
    row = _STORE.get(payload.device_code)
    if row is None:
        raise HTTPException(status_code=400, detail='invalid_grant: unknown device_code')
    if row.get('status') == 'expired':
        raise HTTPException(status_code=410, detail='expired_token: device code expired')
    if row.get('status') == 'denied':
        raise HTTPException(status_code=403, detail='access_denied: user denied')
    if row.get('status') != 'approved':
        # RFC 8628 prescribes 400 with error=authorization_pending, but a
        # distinct HTTP status makes pilot implementations easier to
        # debug. 428 reads naturally as "waiting for the user".
        raise HTTPException(status_code=428, detail='authorization_pending')
    # Approved — hand out the JWT that was minted at approve-time and
    # invalidate the code so it can't be replayed.
    response = {
        'access_token': row['jwt'],
        'token_type': 'bearer',
        'tenant_slug': row['tenant_slug'],
        'organization_id': row['organization_id'],
    }
    # One-shot
    _STORE.pop(payload.device_code, None)
    _STORE.pop(f"uc:{row['user_code']}", None)
    return response


@router.post('/approve')
async def approve_device_code(
    payload: DeviceApproveRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Dashboard calls this after the user enters the code + picks a tenant."""
    _gc_expired()
    user_code = (payload.user_code or '').strip().upper()
    uc_entry = _STORE.get(f'uc:{user_code}')
    if uc_entry is None:
        raise HTTPException(status_code=404, detail='unknown_user_code')
    row = _STORE.get(uc_entry['device_code'])
    if row is None or row.get('status') == 'expired':
        raise HTTPException(status_code=410, detail='expired_or_missing_code')
    if row.get('status') != 'pending':
        raise HTTPException(status_code=409, detail=f"code already {row.get('status')}")

    # Resolve the org the user is picking — must be one they actually belong to.
    tenant_slug = (payload.tenant_slug or '').strip().lower()
    if not tenant_slug:
        raise HTTPException(status_code=400, detail='tenant_slug required')
    org_row = (await db.execute(
        select(Organization).where(Organization.slug == tenant_slug)
    )).scalar_one_or_none()
    if org_row is None:
        raise HTTPException(status_code=404, detail='organization not found')
    membership = (await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_row.id,
            OrganizationMember.user_id == tenant.user_id,
        )
    )).scalar_one_or_none()
    if membership is None:
        raise HTTPException(status_code=403, detail='not a member of this organization')

    # Mint a fresh access token tied to (user, org). Uses the same helper
    # the web login uses so permissions line up exactly.
    jwt = create_access_token(
        subject=tenant.email,
        org_id=org_row.id,
        user_id=tenant.user_id,
    )
    row['status'] = 'approved'
    row['user_id'] = tenant.user_id
    row['organization_id'] = org_row.id
    row['tenant_slug'] = tenant_slug
    row['jwt'] = jwt
    logger.info('Device code %s approved for user=%s org=%s', user_code, tenant.user_id, org_row.id)
    return {'ok': True}


@router.get('/lookup/{user_code}')
async def lookup_user_code(
    user_code: str,
    tenant: CurrentTenant = Depends(get_current_tenant),
) -> dict:
    """Dashboard uses this to confirm a code exists before showing the
    'approve?' prompt. Helps surface "code expired" early."""
    _gc_expired()
    uc_entry = _STORE.get((user_code or '').strip().upper())
    if uc_entry is None:
        # Also check the 'uc:' prefix form
        uc_entry = _STORE.get(f'uc:{(user_code or "").strip().upper()}')
    if uc_entry is None:
        return {'found': False}
    row = _STORE.get(uc_entry['device_code'])
    if row is None:
        return {'found': False}
    _ = tenant
    return {
        'found': True,
        'status': row.get('status', 'pending'),
        'client_name': row.get('client_name', 'agena-cli'),
        'expires_in': max(0, int(DEVICE_CODE_TTL - (time.time() - row['created_at']))),
    }
