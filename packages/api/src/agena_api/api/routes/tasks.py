import asyncio
import base64
import hashlib
import json
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_core.settings import get_settings
from agena_models.schemas.task import TaskListResponse
from agena_services.services.integration_config_service import IntegrationConfigService
from agena_services.services.notification_service import NotificationService
from agena_services.services.task_service import TaskService

router = APIRouter(prefix='/tasks', tags=['external-tasks'])

_CACHE_TTL = 300  # 5 minutes

_redis: Redis | None = None


async def _get_redis() -> Redis:
    global _redis  # noqa: PLW0603
    if _redis is None:
        _redis = Redis.from_url(get_settings().redis_url, decode_responses=True)
    return _redis


def _cache_key(org_id: int, *parts: str) -> str:
    raw = json.dumps([org_id, *parts], sort_keys=True)
    h = hashlib.sha256(raw.encode()).hexdigest()[:16]
    return f'ext_cache:{h}'


async def _cache_get(org_id: int, *parts: str) -> Any | None:
    r = await _get_redis()
    val = await r.get(_cache_key(org_id, *parts))
    if val:
        return json.loads(val)
    return None


async def _cache_set(data: Any, org_id: int, *parts: str) -> None:
    r = await _get_redis()
    await r.set(_cache_key(org_id, *parts), json.dumps(data), ex=_CACHE_TTL)


def _azure_headers(pat: str) -> dict[str, str]:
    token = base64.b64encode(f':{pat}'.encode()).decode()
    return {'Authorization': f'Basic {token}', 'Content-Type': 'application/json'}


def _norm_iteration(v: str | None) -> str:
    if not v:
        return ''
    return str(v).strip().replace('/', '\\').lower()


async def _notify_integration_auth_expired(
    db: AsyncSession,
    tenant: CurrentTenant,
    provider: str,
    detail: str,
) -> None:
    notifier = NotificationService(db)
    await notifier.notify_event(
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        event_type='integration_auth_expired',
        title=f'{provider} authorization expired',
        message=detail,
        severity='error',
    )


@router.get('/azure/projects')
async def list_azure_projects(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    cached = await _cache_get(tenant.organization_id, 'azure', 'projects')
    if cached is not None:
        return cached
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'azure')
    if config is None or not config.secret:
        return []
    url = f"{config.base_url.rstrip('/')}/_apis/projects?api-version=7.1-preview.4"
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(url, headers=_azure_headers(config.secret))
            r.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                await _notify_integration_auth_expired(db, tenant, 'Azure DevOps', 'Please update your Azure PAT in Integrations.')
                raise HTTPException(status_code=401, detail='Azure PAT is invalid or expired') from exc
            raise
    result = [{'id': p['id'], 'name': p['name']} for p in r.json().get('value', [])]
    await _cache_set(result, tenant.organization_id, 'azure', 'projects')
    return result


@router.get('/azure/teams')
async def list_azure_teams(
    project: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    cached = await _cache_get(tenant.organization_id, 'azure', 'teams', project)
    if cached is not None:
        return cached
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'azure')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Azure integration not configured')
    # correct Azure DevOps teams endpoint
    url = f"{config.base_url.rstrip('/')}/_apis/projects/{project}/teams?api-version=7.1-preview.3"
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(url, headers=_azure_headers(config.secret))
            r.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                await _notify_integration_auth_expired(db, tenant, 'Azure DevOps', 'Please update your Azure PAT in Integrations.')
                raise HTTPException(status_code=401, detail='Azure PAT is invalid or expired') from exc
            raise
    result = [{'id': t['id'], 'name': t['name']} for t in r.json().get('value', [])]
    await _cache_set(result, tenant.organization_id, 'azure', 'teams', project)
    return result


@router.get('/azure/sprints')
async def list_azure_sprints(
    project: str = Query(...),
    team: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    cached = await _cache_get(tenant.organization_id, 'azure', 'sprints', project, team)
    if cached is not None:
        return cached
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'azure')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Azure integration not configured')
    url = (
        f"{config.base_url.rstrip('/')}/{project}/{team}"
        f'/_apis/work/teamsettings/iterations?api-version=7.1-preview.1'
    )
    current_url = (
        f"{config.base_url.rstrip('/')}/{project}/{team}"
        f'/_apis/work/teamsettings/iterations?$timeframe=current&api-version=7.1-preview.1'
    )
    headers = _azure_headers(config.secret)
    async with httpx.AsyncClient(timeout=15) as client:
        # Fetch all iterations and current iterations in parallel
        r, rc = await asyncio.gather(
            client.get(url, headers=headers),
            client.get(current_url, headers=headers),
            return_exceptions=True,
        )
        if isinstance(r, Exception):
            raise r
        try:
            r.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                await _notify_integration_auth_expired(db, tenant, 'Azure DevOps', 'Please update your Azure PAT in Integrations.')
                raise HTTPException(status_code=401, detail='Azure PAT is invalid or expired') from exc
            raise
        current_paths: set[str] = set()
        current_ids: set[str] = set()
        current_names: set[str] = set()
        if not isinstance(rc, Exception) and rc.status_code == 200:
            for c in rc.json().get('value', []):
                if c.get('path'):
                    current_paths.add(_norm_iteration(str(c.get('path'))))
                if c.get('id'):
                    current_ids.add(str(c.get('id')))
                if c.get('name'):
                    current_names.add(_norm_iteration(str(c.get('name'))))

    rows: list[dict[str, Any]] = []
    for s in r.json().get('value', []):
        attrs = s.get('attributes') or {}
        path = s.get('path', s['name'])
        sid = str(s.get('id', ''))
        name_norm = _norm_iteration(s.get('name'))
        path_norm = _norm_iteration(path)
        timeframe = str(attrs.get('timeFrame') or '').lower()
        is_current = sid in current_ids or path_norm in current_paths or name_norm in current_names or timeframe == 'current'
        rows.append(
            {
                'id': s['id'],
                'name': s['name'],
                'path': path,
                'is_current': is_current,
                'timeframe': timeframe or None,
                'start_date': attrs.get('startDate'),
                'finish_date': attrs.get('finishDate'),
            }
        )
    await _cache_set(rows, tenant.organization_id, 'azure', 'sprints', project, team)
    return rows


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
    cached = await _cache_get(tenant.organization_id, 'azure', 'members')
    if cached is not None:
        return cached
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
            result = sorted(members, key=lambda x: x['displayName'])
            await _cache_set(result, tenant.organization_id, 'azure', 'members')
            return result
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
        result = sorted(seen.values(), key=lambda x: x['displayName'])
        await _cache_set(result, tenant.organization_id, 'azure', 'members')
        return result


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


@router.get('/azure/workitems/{work_item_id}/comments')
async def list_azure_workitem_comments(
    work_item_id: str,
    project: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'azure')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Azure integration not configured')
    from agena_services.integrations.azure_client import AzureDevOpsClient
    client = AzureDevOpsClient()
    cfg = {'org_url': config.base_url, 'pat': config.secret}
    try:
        return await client.fetch_work_item_comments(cfg=cfg, project=project, work_item_id=work_item_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'Azure comments fetch failed: {exc}') from exc


class CommentPostRequest(BaseModel):
    comment: str


class CommentPostResponse(BaseModel):
    ok: bool


@router.post('/azure/workitems/{work_item_id}/comment', response_model=CommentPostResponse)
async def post_azure_workitem_comment(
    work_item_id: str,
    payload: CommentPostRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> CommentPostResponse:
    text = (payload.comment or '').strip()
    if not text:
        raise HTTPException(status_code=400, detail='comment is required')
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'azure')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Azure integration not configured')
    from agena_services.integrations.azure_client import AzureDevOpsClient
    client = AzureDevOpsClient()
    cfg = {'org_url': config.base_url, 'pat': config.secret}
    try:
        await client.writeback_refinement(
            cfg=cfg, work_item_id=work_item_id, suggested_story_points=0, comment=text,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'Azure comment post failed: {exc}') from exc
    return CommentPostResponse(ok=True)


class AINudgeRequest(BaseModel):
    provider: str  # 'azure' | 'jira'
    item_id: str
    project: str | None = None
    title: str = ''
    reason: str = ''
    assignee: str = ''
    language: str = 'en'
    agent_provider: str = 'openai'
    agent_model: str = ''


class AINudgeResponse(BaseModel):
    sent: bool
    reason_code: str
    hours_silent: float | None = None
    last_commenter: str = ''
    comment_text: str = ''
    generated_by: str = ''
    error: str | None = None


@router.post('/ai-nudge', response_model=AINudgeResponse)
async def post_ai_nudge(
    payload: AINudgeRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> AINudgeResponse:
    from agena_services.services.nudge_service import NudgeService
    svc = NudgeService(db)
    try:
        result = await svc.post_ai_nudge(
            organization_id=tenant.organization_id,
            provider=payload.provider,
            item_id=payload.item_id,
            project=payload.project,
            title=payload.title,
            reason=payload.reason,
            assignee=payload.assignee,
            language=payload.language,
            agent_provider=payload.agent_provider,
            agent_model=payload.agent_model,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — surface a clean 502 to the UI
        raise HTTPException(status_code=502, detail=f'ai-nudge failed: {exc}') from exc
    return AINudgeResponse(**result)


@router.post('/jira/issues/{issue_key}/comment', response_model=CommentPostResponse)
async def post_jira_issue_comment(
    issue_key: str,
    payload: CommentPostRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> CommentPostResponse:
    text = (payload.comment or '').strip()
    if not text:
        raise HTTPException(status_code=400, detail='comment is required')
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'jira')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Jira integration not configured')
    from agena_services.integrations.jira_client import JiraClient
    client = JiraClient()
    cfg = {'base_url': config.base_url, 'email': config.username or '', 'api_token': config.secret}
    try:
        await client.writeback_refinement(
            cfg=cfg, issue_key=issue_key, suggested_story_points=0,
            comment=text, board_id='',
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'Jira comment post failed: {exc}') from exc
    return CommentPostResponse(ok=True)


@router.get('/azure/repos')
async def list_azure_repos(
    project: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    """Azure DevOps projesindeki git repolarını listeler."""
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'azure')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Azure integration not configured')
    url = f"{config.base_url.rstrip('/')}/{project}/_apis/git/repositories?api-version=7.1-preview.1"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=_azure_headers(config.secret))
        r.raise_for_status()
    return [
        {
            'id': repo['id'],
            'name': repo['name'],
            'remote_url': repo.get('remoteUrl', ''),
            'web_url': repo.get('webUrl', ''),
        }
        for repo in r.json().get('value', [])
    ]


@router.get('/github/repos')
async def list_github_repos(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    """GitHub kullanıcısının repolarını listeler."""
    from agena_core.settings import get_settings
    settings = get_settings()
    token = settings.github_token or ''
    if not token:
        service = IntegrationConfigService(db)
        config = await service.get_config(tenant.organization_id, 'github')
        if config and config.secret:
            token = config.secret
    if not token:
        return []
    headers = {'Authorization': f'token {token}', 'Accept': 'application/vnd.github.v3+json'}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get('https://api.github.com/user/repos?per_page=100&sort=updated', headers=headers)
        if r.status_code != 200:
            return []
    return [
        {
            'id': repo['id'],
            'name': repo['full_name'],
            'default_branch': repo.get('default_branch', 'main'),
            'private': repo.get('private', False),
            'web_url': repo.get('html_url', ''),
        }
        for repo in r.json()
    ]


@router.get('/azure/states')
async def list_azure_states(    project: str = Query(...),
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
    project_key: str | None = Query(default=None),
    board_id: str | None = Query(default=None),
    sprint_id: str | None = Query(default=None),
    state: str | None = Query(default=None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> TaskListResponse:
    integration_service = IntegrationConfigService(db)
    config = await integration_service.get_config(tenant.organization_id, 'jira')
    if config is None:
        raise HTTPException(status_code=400, detail='Jira integration not configured for this organization')

    task_service = TaskService(db)
    jira_cfg = {'base_url': config.base_url, 'email': config.username or '', 'api_token': config.secret}
    if board_id:
        tasks = await task_service.jira_client.fetch_board_issues(
            jira_cfg,
            board_id=board_id,
            sprint_id=sprint_id,
            state=state,
        )
    else:
        tasks = await task_service.jira_client.fetch_todo_issues(jira_cfg)
    return TaskListResponse(items=tasks)


@router.get('/jira/members')
async def list_jira_sprint_members(
    board_id: str = Query(...),
    sprint_id: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, str]]:
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'jira')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Jira integration not configured')

    base = config.base_url.rstrip('/')
    issue_url = f"{base}/rest/agile/1.0/board/{board_id}/issue"
    start_at = 0
    max_results = 100
    seen: dict[str, dict[str, str]] = {}

    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            params = {
                'sprint': sprint_id,
                'fields': 'assignee',
                'maxResults': max_results,
                'startAt': start_at,
            }
            try:
                response = await client.get(
                    issue_url,
                    params=params,
                    auth=(config.username or '', config.secret),
                )
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 401:
                    await _notify_integration_auth_expired(db, tenant, 'Jira', 'Please update your Jira email/API token in Integrations.')
                    raise HTTPException(status_code=401, detail='Jira credentials are invalid (email or API token)') from exc
                raise HTTPException(status_code=502, detail='Jira members fetch failed') from exc

            data = response.json()
            issues = data.get('issues', [])
            for issue in issues:
                assignee = ((issue.get('fields') or {}).get('assignee') or {})
                if not isinstance(assignee, dict):
                    continue
                account_id = str(assignee.get('accountId') or '').strip()
                display = str(assignee.get('displayName') or '').strip()
                email = str(assignee.get('emailAddress') or '').strip()
                key = account_id or email or display
                if not key or not display:
                    continue
                if key not in seen:
                    seen[key] = {
                        'id': key,
                        'displayName': display,
                        'uniqueName': key,
                    }

            total = int(data.get('total') or 0)
            fetched = int(data.get('maxResults') or max_results)
            start_at += fetched
            if not issues or start_at >= total:
                break

        # Fallback: if sprint has no assigned issues, list assignable users from board's project.
        if not seen:
            project_key = ''
            try:
                board_res = await client.get(
                    f"{base}/rest/agile/1.0/board/{board_id}",
                    auth=(config.username or '', config.secret),
                )
                board_res.raise_for_status()
                board = board_res.json() if isinstance(board_res.json(), dict) else {}
                location = board.get('location') if isinstance(board.get('location'), dict) else {}
                project_key = str(location.get('projectKey') or '').strip()
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 401:
                    await _notify_integration_auth_expired(db, tenant, 'Jira', 'Please update your Jira email/API token in Integrations.')
                    raise HTTPException(status_code=401, detail='Jira credentials are invalid (email or API token)') from exc
                project_key = ''

            if project_key:
                users_res = await client.get(
                    f"{base}/rest/api/3/user/assignable/search",
                    params={'project': project_key, 'maxResults': 1000},
                    auth=(config.username or '', config.secret),
                )
                users_res.raise_for_status()
                users = users_res.json()
                if isinstance(users, list):
                    for user in users:
                        if not isinstance(user, dict):
                            continue
                        account_id = str(user.get('accountId') or '').strip()
                        display = str(user.get('displayName') or '').strip()
                        email = str(user.get('emailAddress') or '').strip()
                        key = account_id or email or display
                        if not key or not display:
                            continue
                        if key not in seen:
                            seen[key] = {
                                'id': key,
                                'displayName': display,
                                'uniqueName': key,
                            }

    return sorted(seen.values(), key=lambda x: x['displayName'])


@router.get('/jira/member/workitems')
async def list_jira_member_workitems(
    board_id: str = Query(...),
    sprint_id: str = Query(...),
    assigned_to: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'jira')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Jira integration not configured')

    url = f"{config.base_url.rstrip('/')}/rest/agile/1.0/board/{board_id}/issue"
    start_at = 0
    max_results = 100
    normalized_target = assigned_to.strip().lower()
    results: list[dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            params = {
                'sprint': sprint_id,
                'fields': 'summary,status,assignee',
                'maxResults': max_results,
                'startAt': start_at,
            }
            try:
                response = await client.get(
                    url,
                    params=params,
                    auth=(config.username or '', config.secret),
                )
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 401:
                    await _notify_integration_auth_expired(db, tenant, 'Jira', 'Please update your Jira email/API token in Integrations.')
                    raise HTTPException(status_code=401, detail='Jira credentials are invalid (email or API token)') from exc
                raise HTTPException(status_code=502, detail='Jira member workitems fetch failed') from exc

            data = response.json()
            issues = data.get('issues', [])
            for issue in issues:
                fields = issue.get('fields') or {}
                assignee = fields.get('assignee') or {}
                if not isinstance(assignee, dict):
                    continue
                account_id = str(assignee.get('accountId') or '').strip().lower()
                email = str(assignee.get('emailAddress') or '').strip().lower()
                display = str(assignee.get('displayName') or '').strip().lower()
                if normalized_target not in {account_id, email, display}:
                    continue
                status = fields.get('status') if isinstance(fields.get('status'), dict) else {}
                results.append(
                    {
                        'id': str(issue.get('key') or issue.get('id') or ''),
                        'title': str(fields.get('summary') or ''),
                        'state': str((status or {}).get('name') or ''),
                    }
                )

            total = int(data.get('total') or 0)
            fetched = int(data.get('maxResults') or max_results)
            start_at += fetched
            if not issues or start_at >= total:
                break

    return results


@router.get('/jira/projects')
async def list_jira_projects(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, str]]:
    cached = await _cache_get(tenant.organization_id, 'jira', 'projects')
    if cached is not None:
        return cached
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'jira')
    if config is None or not config.secret:
        return []

    task_service = TaskService(db)
    try:
        projects = await task_service.jira_client.fetch_projects(
            {'base_url': config.base_url, 'email': config.username or '', 'api_token': config.secret}
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            await _notify_integration_auth_expired(db, tenant, 'Jira', 'Please update your Jira email/API token in Integrations.')
            raise HTTPException(status_code=401, detail='Jira credentials are invalid (email or API token)') from exc
        raise HTTPException(status_code=502, detail='Jira projects fetch failed') from exc
    result = [{'id': p['key'], 'name': p['name']} for p in projects if p.get('key') and p.get('name')]
    await _cache_set(result, tenant.organization_id, 'jira', 'projects')
    return result


@router.get('/jira/boards')
async def list_jira_boards(
    project_key: str | None = Query(default=None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, str]]:
    cached = await _cache_get(tenant.organization_id, 'jira', 'boards', project_key or '')
    if cached is not None:
        return cached
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'jira')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Jira integration not configured')

    task_service = TaskService(db)
    try:
        boards = await task_service.jira_client.fetch_boards(
            {'base_url': config.base_url, 'email': config.username or '', 'api_token': config.secret},
            project_key=project_key,
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            await _notify_integration_auth_expired(db, tenant, 'Jira', 'Please update your Jira email/API token in Integrations.')
            raise HTTPException(status_code=401, detail='Jira credentials are invalid (email or API token)') from exc
        raise HTTPException(status_code=502, detail='Jira boards fetch failed') from exc
    result = [{'id': b['id'], 'name': b['name']} for b in boards if b.get('id') and b.get('name')]
    await _cache_set(result, tenant.organization_id, 'jira', 'boards', project_key or '')
    return result


@router.get('/jira/sprints')
async def list_jira_sprints(
    board_id: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    cached = await _cache_get(tenant.organization_id, 'jira', 'sprints', board_id)
    if cached is not None:
        return cached
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'jira')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Jira integration not configured')

    task_service = TaskService(db)
    try:
        sprints = await task_service.jira_client.fetch_sprints(
            {'base_url': config.base_url, 'email': config.username or '', 'api_token': config.secret},
            board_id=board_id,
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            await _notify_integration_auth_expired(db, tenant, 'Jira', 'Please update your Jira email/API token in Integrations.')
            raise HTTPException(status_code=401, detail='Jira credentials are invalid (email or API token)') from exc
        raise HTTPException(status_code=502, detail='Jira sprints fetch failed') from exc
    result = [
        {
            'id': s['id'],
            'name': s['name'],
            'path': s['id'],
            'is_current': (s.get('state') or '').lower() == 'active',
            'timeframe': s.get('state'),
            'start_date': s.get('start_date') or None,
            'finish_date': s.get('finish_date') or None,
        }
        for s in sprints
        if s.get('id') and s.get('name')
    ]
    await _cache_set(result, tenant.organization_id, 'jira', 'sprints', board_id)
    return result


@router.get('/jira/states')
async def list_jira_states(
    board_id: str = Query(...),
    sprint_id: str | None = Query(default=None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[str]:
    _ = sprint_id
    service = IntegrationConfigService(db)
    config = await service.get_config(tenant.organization_id, 'jira')
    if config is None or not config.secret:
        raise HTTPException(status_code=400, detail='Jira integration not configured')

    task_service = TaskService(db)
    try:
        states = await task_service.jira_client.fetch_board_states(
            {'base_url': config.base_url, 'email': config.username or '', 'api_token': config.secret},
            board_id=board_id,
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            await _notify_integration_auth_expired(db, tenant, 'Jira', 'Please update your Jira email/API token in Integrations.')
            raise HTTPException(status_code=401, detail='Jira credentials are invalid (email or API token)') from exc
        raise HTTPException(status_code=502, detail='Jira states fetch failed') from exc
    if states:
        return states
    return ['To Do', 'In Progress', 'Done']


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
