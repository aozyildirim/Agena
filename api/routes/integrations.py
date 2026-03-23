from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentTenant, get_current_tenant
from core.database import get_db_session
from schemas.integration import IntegrationConfigResponse, IntegrationConfigUpsertRequest
from services.integration_config_service import IntegrationConfigService

router = APIRouter(prefix='/integrations', tags=['integrations'])


class PlaybookContentResponse(BaseModel):
    content: str


@router.get('/github/repos')
async def list_github_repos(
    owner: str | None = Query(default=None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, str | bool]]:
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'github')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='GitHub integration not configured')

    token = (config.secret or '').strip()
    if not token:
        raise HTTPException(status_code=400, detail='GitHub token is missing')

    resolved_owner = (owner or config.username or '').strip()
    base = (config.base_url or 'https://api.github.com').rstrip('/')
    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    }

    async with httpx.AsyncClient(timeout=30) as client:
        # user/repos returns repositories visible to this token (including private repos)
        # and works better than users/{owner}/repos for authenticated private repositories.
        response = await client.get(
            f'{base}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
            headers=headers,
        )

        if resolved_owner and response.status_code < 400:
            raw = response.json()
            if isinstance(raw, list):
                filtered = [item for item in raw if str(item.get('full_name', '')).lower().startswith(f'{resolved_owner.lower()}/')]
                if filtered:
                    data = filtered
                else:
                    # Fallbacks for org/user specific listing if token-visible list has no match.
                    org_url = f'{base}/orgs/{quote(resolved_owner, safe="")}/repos?per_page=100&sort=updated'
                    org_response = await client.get(org_url, headers=headers)
                    if org_response.status_code == 404:
                        user_url = f'{base}/users/{quote(resolved_owner, safe="")}/repos?per_page=100&sort=updated'
                        response = await client.get(user_url, headers=headers)
                        data = response.json() if response.status_code < 400 else []
                    else:
                        response = org_response
                        data = response.json() if response.status_code < 400 else []
            else:
                data = []
        else:
            data = response.json() if response.status_code < 400 else []

    if response.status_code == 401:
        raise HTTPException(status_code=401, detail='Invalid GitHub token')
    if response.status_code == 403:
        raise HTTPException(status_code=403, detail='GitHub access forbidden for repository listing')
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail='GitHub owner not found')
    response.raise_for_status()

    if not isinstance(data, list):
        return []

    return [
        {
            'id': str(item.get('id', '')),
            'name': str(item.get('name', '')),
            'full_name': str(item.get('full_name', '')),
            'private': bool(item.get('private', False)),
        }
        for item in data
        if item.get('id') and item.get('name')
    ]


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


@router.get('/playbook/content', response_model=PlaybookContentResponse)
async def get_playbook_content(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> PlaybookContentResponse:
    service = IntegrationConfigService(db)
    item = await service.get_config(tenant.organization_id, 'playbook')
    if item is None:
        return PlaybookContentResponse(content='')
    return PlaybookContentResponse(content=item.secret or '')


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
