import base64
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentTenant, get_current_tenant
from core.database import get_db_session
from schemas.task import TaskListResponse
from services.integration_config_service import IntegrationConfigService
from services.task_service import TaskService

router = APIRouter(prefix='/tasks', tags=['external-tasks'])


def _azure_headers(pat: str) -> dict[str, str]:
    token = base64.b64encode(f':{pat}'.encode()).decode()
    return {'Authorization': f'Basic {token}', 'Content-Type': 'application/json'}


@router.get('/azure/projects')
async def list_azure_projects(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'azure')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Azure integration not configured')
    url = f"{config.base_url.rstrip('/')}/_apis/projects?api-version=7.1-preview.4"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=_azure_headers(config.secret))
        r.raise_for_status()
    return [{'id': p['id'], 'name': p['name']} for p in r.json().get('value', [])]


@router.get('/azure/teams')
async def list_azure_teams(
    project: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'azure')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Azure integration not configured')
    # correct Azure DevOps teams endpoint
    url = f"{config.base_url.rstrip('/')}/_apis/projects/{project}/teams?api-version=7.1-preview.3"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=_azure_headers(config.secret))
        r.raise_for_status()
    return [{'id': t['id'], 'name': t['name']} for t in r.json().get('value', [])]


@router.get('/azure/sprints')
async def list_azure_sprints(
    project: str = Query(...),
    team: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'azure')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Azure integration not configured')
    url = (
        f"{config.base_url.rstrip('/')}/{project}/{team}"
        f'/_apis/work/teamsettings/iterations?api-version=7.1-preview.1'
    )
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=_azure_headers(config.secret))
        r.raise_for_status()
    return [
        {'id': s['id'], 'name': s['name'], 'path': s.get('path', s['name'])}
        for s in r.json().get('value', [])
    ]


@router.get('/azure/sprint/members')
async def list_sprint_members(
    project: str = Query(...),
    team: str = Query(...),
    sprint_path: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    """Sprint'te gerçekten iş atanmış kişileri döndürür — fazladan üye gelmez."""
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'azure')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Azure integration not configured')

    wiql_url = (
        f"{config.base_url.rstrip('/')}/{project}"
        '/_apis/wit/wiql?api-version=7.1-preview.2'
    )
    wiql_payload = {
        'query': (
            "Select [System.Id], [System.AssignedTo] From WorkItems "
            f"Where [System.IterationPath] UNDER '{sprint_path}' "
            "And [System.AssignedTo] <> '' "
            "Order By [System.AssignedTo] Asc"
        )
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(wiql_url, headers=_azure_headers(config.secret), json=wiql_payload)
        r.raise_for_status()
        refs = r.json().get('workItems', [])
        if not refs:
            return []

        ids = ','.join(str(i['id']) for i in refs[:200])
        details_url = (
            f"{config.base_url.rstrip('/')}/_apis/wit/workitems"
            f'?ids={ids}&fields=System.AssignedTo&api-version=7.1-preview.3'
        )
        dr = await client.get(details_url, headers=_azure_headers(config.secret))
        dr.raise_for_status()

    # Unique kişileri çıkar
    seen: dict[str, dict[str, Any]] = {}
    for item in dr.json().get('value', []):
        assigned = item.get('fields', {}).get('System.AssignedTo', {})
        if not assigned:
            continue
        # Azure bazen string bazen dict döndürür
        if isinstance(assigned, dict):
            uid        = assigned.get('id', assigned.get('uniqueName', ''))
            display    = assigned.get('displayName', '')
            unique_name = assigned.get('uniqueName', '')
        else:
            uid = unique_name = str(assigned)
            display = str(assigned)
        if uid and uid not in seen:
            seen[uid] = {'id': uid, 'displayName': display, 'uniqueName': unique_name}

    return list(seen.values())


@router.get('/azure/members')
async def list_azure_org_members(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    """FloTechnology org genelindeki tüm kullanıcıları döndürür."""
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'azure')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Azure integration not configured')
    # Org geneli tüm kullanıcılar — Graph API
    url = f"{config.base_url.rstrip('/')}/_apis/graph/users?api-version=7.1-preview.1"
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, headers=_azure_headers(config.secret))
        if r.status_code == 200:
            members = []
            for u in r.json().get('value', []):
                display = u.get('displayName', '')
                unique  = u.get('mailAddress', '') or u.get('principalName', '')
                uid     = u.get('descriptor', unique)
                if display and unique:
                    members.append({'id': uid, 'displayName': display, 'uniqueName': unique})
            return sorted(members, key=lambda x: x['displayName'])
        # Fallback: tüm projelerin takımlarından üyeleri topla
        projects_r = await client.get(
            f"{config.base_url.rstrip('/')}/_apis/projects?api-version=7.1-preview.4",
            headers=_azure_headers(config.secret)
        )
        projects_r.raise_for_status()
        seen: dict[str, dict[str, Any]] = {}
        for proj in projects_r.json().get('value', []):
            proj_name = proj['name']
            teams_r = await client.get(
                f"{config.base_url.rstrip('/')}/_apis/projects/{proj_name}/teams?api-version=7.1-preview.3",
                headers=_azure_headers(config.secret)
            )
            if teams_r.status_code != 200:
                continue
            for t in teams_r.json().get('value', []):
                mem_r = await client.get(
                    f"{config.base_url.rstrip('/')}/_apis/projects/{proj_name}/teams/{t['id']}/members?api-version=7.1-preview.2",
                    headers=_azure_headers(config.secret)
                )
                if mem_r.status_code != 200:
                    continue
                for m in mem_r.json().get('value', []):
                    identity = m.get('identity', m)
                    uid = identity.get('id', '')
                    display = identity.get('displayName', '')
                    unique = identity.get('uniqueName', '')
                    if uid and uid not in seen and display and unique:
                        seen[uid] = {'id': uid, 'displayName': display, 'uniqueName': unique}
        return sorted(seen.values(), key=lambda x: x['displayName'])


@router.get('/azure/member/workitems')
async def list_member_workitems(
    project: str = Query(...),
    team: str = Query(...),
    sprint_path: str = Query(...),
    assigned_to: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    """Belirli bir kişiye atanmış sprint work item'larını getirir."""
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'azure')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Azure integration not configured')
    wiql_url = (
        f"{config.base_url.rstrip('/')}/{project}"
        '/_apis/wit/wiql?api-version=7.1-preview.2'
    )
    wiql_payload = {
        'query': (
            "Select [System.Id], [System.Title], [System.State], [System.AssignedTo] "
            "From WorkItems "
            f"Where [System.IterationPath] UNDER '{sprint_path}' "
            f"And [System.AssignedTo] = '{assigned_to}' "
            "Order By [System.State] Asc"
        )
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(wiql_url, headers=_azure_headers(config.secret), json=wiql_payload)
        r.raise_for_status()
        refs = r.json().get('workItems', [])
        if not refs:
            return []
        ids = ','.join(str(i['id']) for i in refs[:100])
        details_url = (
            f"{config.base_url.rstrip('/')}/_apis/wit/workitems"
            f'?ids={ids}&fields=System.Id,System.Title,System.State,System.AssignedTo&api-version=7.1-preview.3'
        )
        dr = await client.get(details_url, headers=_azure_headers(config.secret))
        dr.raise_for_status()
    result = []
    for item in dr.json().get('value', []):
        f = item.get('fields', {})
        result.append({
            'id': str(f.get('System.Id', '')),
            'title': f.get('System.Title', ''),
            'state': f.get('System.State', ''),
        })
    return result


@router.get('/azure/states')
async def list_azure_states(
    project: str = Query(...),
    team: str = Query(...),
    sprint_path: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[str]:
    """Sprint'teki work item'lardan gerçek state listesini çeker — hardcode yok."""
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'azure')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Azure integration not configured')

    wiql_url = (
        f"{config.base_url.rstrip('/')}/{project}"
        '/_apis/wit/wiql?api-version=7.1-preview.2'
    )
    # Sprint'teki tüm work item'ları çek, sadece state alanı yeterli
    wiql_payload = {
        'query': (
            "Select [System.Id], [System.State] From WorkItems "
            f"Where [System.IterationPath] UNDER '{sprint_path}' "
            "Order By [System.State] Asc"
        )
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(wiql_url, headers=_azure_headers(config.secret), json=wiql_payload)
        r.raise_for_status()
        refs = r.json().get('workItems', [])

        if not refs:
            # Sprint boşsa process'in tüm state'lerini çek
            proc_url = (
                f"{config.base_url.rstrip('/')}/{project}"
                '/_apis/work/processconfiguration?api-version=7.1-preview.1'
            )
            pr = await client.get(proc_url, headers=_azure_headers(config.secret))
            if pr.status_code == 200:
                data = pr.json()
                states: list[str] = []
                for col in data.get('bugWorkItems', {}).get('states', []) or data.get('requirementBacklog', {}).get('states', []):
                    if col.get('name') and col['name'] not in states:
                        states.append(col['name'])
                if states:
                    return states
            return ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done']

        # Work item'ların state'lerini batch olarak çek
        ids = ','.join(str(item['id']) for item in refs[:200])
        details_url = (
            f"{config.base_url.rstrip('/')}/_apis/wit/workitems"
            f'?ids={ids}&fields=System.State&api-version=7.1-preview.3'
        )
        dr = await client.get(details_url, headers=_azure_headers(config.secret))
        dr.raise_for_status()

    # Unique state'leri sıralı döndür (Azure'daki sırayı koru)
    seen: list[str] = []
    for item in dr.json().get('value', []):
        st = item.get('fields', {}).get('System.State', '')
        if st and st not in seen:
            seen.append(st)
    return seen if seen else ['Backlog', 'To Do', 'In Progress', 'Done']


@router.get('/jira', response_model=TaskListResponse)
async def get_jira_tasks(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> TaskListResponse:
    integration_service = IntegrationConfigService(db)
    config = await integration_service.get_config(tenant.organization_id, 'jira')
    if config is None:
        raise HTTPException(status_code=400, detail='Jira integration not configured for this organization')

    task_service = TaskService(db)
    tasks = await task_service.jira_client.fetch_todo_issues(
        {'base_url': config.base_url, 'email': config.username or '', 'api_token': config.secret}
    )
    return TaskListResponse(items=tasks)


@router.get('/azure', response_model=TaskListResponse)
async def get_azure_tasks(
    project: str | None = Query(default=None),
    team: str | None = Query(default=None),
    sprint_path: str | None = Query(default=None),
    state: str | None = Query(default='New'),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> TaskListResponse:
    integration_service = IntegrationConfigService(db)
    config = await integration_service.get_config(tenant.organization_id, 'azure')
    if config is None:
        raise HTTPException(status_code=400, detail='Azure integration not configured for this organization')

    task_service = TaskService(db)
    try:
        tasks = await task_service.azure_client.fetch_new_work_items(
            {
                'org_url': config.base_url,
                'project': project or config.project or '',
                'pat': config.secret,
                'team': team or '',
                'sprint_path': sprint_path or '',
                'state': state or '',
            }
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f'Azure request failed ({exc.response.status_code}). Check org URL/project/team/sprint settings.',
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'Azure connection failed: {exc}') from exc
    return TaskListResponse(items=tasks)
