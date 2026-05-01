from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant, require_permission
from agena_core.database import get_db_session
from agena_models.schemas.integration import IntegrationConfigResponse, IntegrationConfigUpsertRequest
from agena_services.services.integration_config_service import IntegrationConfigService

router = APIRouter(prefix='/integrations', tags=['integrations'])


class PlaybookContentResponse(BaseModel):
    content: str


def _normalize_owner(raw: str | None) -> str:
    value = (raw or '').strip()
    if not value:
        return ''
    value = value.replace('https://', '').replace('http://', '').strip('/')
    if value.startswith('github.com/'):
        value = value[len('github.com/'):]
    if '/' in value:
        value = value.split('/')[0]
    if value.startswith('@'):
        value = value[1:]
    return value.strip()


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

    resolved_owner = _normalize_owner(owner)
    default_owner = _normalize_owner(config.username)
    base = (config.base_url or 'https://api.github.com').rstrip('/')
    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    }

    async with httpx.AsyncClient(timeout=30) as client:
        # Collect repos via multiple user/repos variants because token types can differ
        # (classic PAT vs fine-grained) and some variants may return partial lists.
        endpoints = [
            f'{base}/user/repos?per_page=100&sort=updated&visibility=all',
            f'{base}/user/repos?per_page=100&sort=updated&type=owner',
            f'{base}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
        ]
        merged_by_id: dict[str, dict] = {}
        response = None
        for url in endpoints:
            r = await client.get(url, headers=headers)
            if response is None:
                response = r
            if r.status_code >= 400:
                continue
            payload = r.json()
            if not isinstance(payload, list):
                continue
            for item in payload:
                rid = str(item.get('id', ''))
                if not rid:
                    continue
                merged_by_id[rid] = item

        if response is None:
            raise HTTPException(status_code=500, detail='GitHub repo listing failed')

        base_list = list(merged_by_id.values())

        if resolved_owner and response.status_code < 400:
            raw = base_list
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
                        fallback_data = response.json() if response.status_code < 400 else []
                        if isinstance(fallback_data, list) and fallback_data:
                            data = fallback_data
                        else:
                            # Owner filter did not produce results; return token-visible repos.
                            data = raw
                    else:
                        response = org_response
                        fallback_data = response.json() if response.status_code < 400 else []
                        if isinstance(fallback_data, list) and fallback_data:
                            data = fallback_data
                        else:
                            # Owner filter did not produce results; return token-visible repos.
                            data = raw
            else:
                data = []
        else:
            data = base_list if response.status_code < 400 else []
            if (
                isinstance(data, list)
                and not data
                and default_owner
                and response.status_code < 400
            ):
                org_url = f'{base}/orgs/{quote(default_owner, safe="")}/repos?per_page=100&sort=updated'
                org_response = await client.get(org_url, headers=headers)
                if org_response.status_code < 400:
                    org_data = org_response.json()
                    if isinstance(org_data, list) and org_data:
                        data = org_data
            if isinstance(data, list) and not data and response.status_code < 400:
                # Last fallback: collect repos from all organizations this user belongs to.
                orgs_response = await client.get(f'{base}/user/orgs?per_page=100', headers=headers)
                if orgs_response.status_code < 400:
                    orgs = orgs_response.json()
                    if isinstance(orgs, list):
                        merged: list[dict] = []
                        seen: set[str] = set()
                        for org in orgs:
                            login = str(org.get('login', '')).strip()
                            if not login:
                                continue
                            org_url = f'{base}/orgs/{quote(login, safe="")}/repos?per_page=100&sort=updated'
                            org_response = await client.get(org_url, headers=headers)
                            if org_response.status_code >= 400:
                                continue
                            org_repos = org_response.json()
                            if not isinstance(org_repos, list):
                                continue
                            for item in org_repos:
                                rid = str(item.get('id', ''))
                                if not rid or rid in seen:
                                    continue
                                seen.add(rid)
                                merged.append(item)
                        if merged:
                            data = merged
            if isinstance(data, list) and not data and response.status_code < 400:
                # Final fallback: GraphQL viewer repositories (helps with some fine-grained token setups).
                gql_headers = dict(headers)
                gql_payload = {
                    'query': """
                    query {
                      viewer {
                        repositories(first: 100, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], orderBy: {field: UPDATED_AT, direction: DESC}) {
                          nodes {
                            id
                            name
                            nameWithOwner
                            isPrivate
                          }
                        }
                      }
                    }
                    """
                }
                gql_resp = await client.post(f'{base}/graphql', headers=gql_headers, json=gql_payload)
                if gql_resp.status_code < 400:
                    gql_data = gql_resp.json()
                    nodes = (((gql_data.get('data') or {}).get('viewer') or {}).get('repositories') or {}).get('nodes') or []
                    if isinstance(nodes, list) and nodes:
                        data = [
                            {
                                'id': node.get('id') or node.get('nameWithOwner') or '',
                                'name': node.get('name') or '',
                                'full_name': node.get('nameWithOwner') or '',
                                'private': bool(node.get('isPrivate', False)),
                            }
                            for node in nodes
                            if node.get('name') and node.get('nameWithOwner')
                        ]

    if response.status_code == 401:
        raise HTTPException(status_code=401, detail='Invalid GitHub token')
    if response.status_code == 403:
        raise HTTPException(status_code=403, detail='GitHub access forbidden for repository listing')
    if response.status_code == 404:
        return []
    # Do not hard-fail on non-auth 4xx (e.g. 422 on one query variant),
    # because alternate query variants may have already produced usable data.
    if response.status_code >= 500:
        raise HTTPException(status_code=502, detail='GitHub repository listing failed')

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


@router.delete('/{provider}', status_code=204)
async def delete_integration(
    provider: str,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    service = IntegrationConfigService(db)
    try:
        deleted = await service.delete_config(tenant.organization_id, provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail='Integration not found')


@router.put('/{provider}', response_model=IntegrationConfigResponse)
async def upsert_integration(
    provider: str,
    payload: IntegrationConfigUpsertRequest,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
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
            extra_config=payload.extra_config,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return IntegrationConfigResponse(**service.to_public_dict(item))


# ── Branch listing ───────────────────────────────────────────────────────────


class BranchItem(BaseModel):
    name: str
    is_default: bool = False


@router.get('/github/branches', response_model=list[BranchItem])
async def list_github_branches(
    owner: str = Query(...),
    repo: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[BranchItem]:
    service = IntegrationConfigService(db)
    cfg = await service.get_config(tenant.organization_id, 'github')
    token = cfg.secret if cfg else ''
    if not token:
        raise HTTPException(status_code=400, detail='GitHub token not configured')

    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    }

    branches: list[BranchItem] = []
    async with httpx.AsyncClient(timeout=15) as client:
        repo_resp = await client.get(f'https://api.github.com/repos/{owner}/{repo}', headers=headers)
        default_branch = ''
        if repo_resp.status_code == 200:
            default_branch = repo_resp.json().get('default_branch', 'main')

        resp = await client.get(f'https://api.github.com/repos/{owner}/{repo}/branches?per_page=100', headers=headers)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail='Failed to fetch branches')
        for b in resp.json():
            name = b.get('name', '')
            branches.append(BranchItem(name=name, is_default=name == default_branch))

    branches.sort(key=lambda b: (not b.is_default, b.name))
    return branches


@router.get('/azure/branches', response_model=list[BranchItem])
async def list_azure_branches(
    project: str = Query(...),
    repo_name: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[BranchItem]:
    import base64
    service = IntegrationConfigService(db)
    cfg = await service.get_config(tenant.organization_id, 'azure')
    if not cfg or not cfg.secret:
        raise HTTPException(status_code=400, detail='Azure PAT not configured')

    pat = cfg.secret
    base_url = (cfg.base_url or '').rstrip('/')
    auth = base64.b64encode(f':{pat}'.encode()).decode()
    headers = {'Authorization': f'Basic {auth}', 'Content-Type': 'application/json'}

    branches: list[BranchItem] = []
    async with httpx.AsyncClient(timeout=15) as client:
        repo_resp = await client.get(
            f'{base_url}/{quote(project)}/_apis/git/repositories/{quote(repo_name)}?api-version=7.1',
            headers=headers,
        )
        default_branch = ''
        if repo_resp.status_code == 200:
            raw = repo_resp.json().get('defaultBranch', '')
            default_branch = raw.replace('refs/heads/', '')

        resp = await client.get(
            f'{base_url}/{quote(project)}/_apis/git/repositories/{quote(repo_name)}/refs?filter=heads/&api-version=7.1',
            headers=headers,
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail='Failed to fetch branches')
        for ref in resp.json().get('value', []):
            name = ref.get('name', '').replace('refs/heads/', '')
            if name:
                branches.append(BranchItem(name=name, is_default=name == default_branch))

    branches.sort(key=lambda b: (not b.is_default, b.name))
    return branches


# ── Jira metadata for IntegrationRule UI ────────────────────────────────────

class JiraReporterItem(BaseModel):
    email: str
    display_name: str


class JiraIssueTypeItem(BaseModel):
    name: str
    icon_url: str | None = None


class JiraLabelItem(BaseModel):
    name: str


class JiraProjectItem(BaseModel):
    key: str
    name: str


@router.get('/jira/reporters', response_model=list[JiraReporterItem])
async def list_jira_reporters(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[JiraReporterItem]:
    """Return distinct reporters seen on the org's Jira instance. We query
    /rest/api/3/users/search for active accounts so the rule editor can offer
    a dropdown without requiring the user to memorize email addresses."""
    service = IntegrationConfigService(db)
    cfg = await service.get_config(tenant.organization_id, 'jira')
    if cfg is None or not cfg.secret:
        return []
    base_url = (cfg.base_url or '').rstrip('/')
    if not base_url:
        return []
    import base64
    email = (cfg.username or '').strip()
    auth = base64.b64encode(f'{email}:{cfg.secret}'.encode()).decode()
    headers = {'Authorization': f'Basic {auth}', 'Accept': 'application/json'}
    out: list[JiraReporterItem] = []
    seen: set[str] = set()
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(f'{base_url}/rest/api/3/users/search?maxResults=200', headers=headers)
        if resp.status_code != 200:
            return []
        for u in resp.json():
            if not isinstance(u, dict):
                continue
            if u.get('accountType') and u.get('accountType') != 'atlassian':
                continue
            if u.get('active') is False:
                continue
            mail = str(u.get('emailAddress') or '').strip()
            display = str(u.get('displayName') or mail).strip()
            key = mail or display
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(JiraReporterItem(email=mail, display_name=display))
    out.sort(key=lambda i: i.display_name.lower())
    return out


@router.get('/jira/issuetypes', response_model=list[JiraIssueTypeItem])
async def list_jira_issuetypes(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[JiraIssueTypeItem]:
    service = IntegrationConfigService(db)
    cfg = await service.get_config(tenant.organization_id, 'jira')
    if cfg is None or not cfg.secret:
        return []
    base_url = (cfg.base_url or '').rstrip('/')
    if not base_url:
        return []
    import base64
    email = (cfg.username or '').strip()
    auth = base64.b64encode(f'{email}:{cfg.secret}'.encode()).decode()
    headers = {'Authorization': f'Basic {auth}', 'Accept': 'application/json'}
    out: list[JiraIssueTypeItem] = []
    seen: set[str] = set()
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(f'{base_url}/rest/api/3/issuetype', headers=headers)
        if resp.status_code != 200:
            return []
        for it in resp.json():
            if not isinstance(it, dict):
                continue
            name = str(it.get('name') or '').strip()
            if not name or name in seen:
                continue
            seen.add(name)
            out.append(JiraIssueTypeItem(name=name, icon_url=it.get('iconUrl')))
    out.sort(key=lambda i: i.name.lower())
    return out


@router.get('/jira/labels', response_model=list[JiraLabelItem])
async def list_jira_labels(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[JiraLabelItem]:
    """Return all labels in use across the org's Jira instance. Backed by
    /rest/api/3/label which paginates the global label registry — we walk
    pages until we hit the end (or 5k labels, whichever comes first) so
    the rule editor offers an autocomplete dropdown instead of free text."""
    service = IntegrationConfigService(db)
    cfg = await service.get_config(tenant.organization_id, 'jira')
    if cfg is None or not cfg.secret:
        return []
    base_url = (cfg.base_url or '').rstrip('/')
    if not base_url:
        return []
    import base64
    email = (cfg.username or '').strip()
    auth = base64.b64encode(f'{email}:{cfg.secret}'.encode()).decode()
    headers = {'Authorization': f'Basic {auth}', 'Accept': 'application/json'}
    seen: set[str] = set()
    start_at = 0
    page_size = 1000
    hard_cap = 5000
    async with httpx.AsyncClient(timeout=20) as client:
        while True:
            resp = await client.get(
                f'{base_url}/rest/api/3/label?startAt={start_at}&maxResults={page_size}',
                headers=headers,
            )
            if resp.status_code != 200:
                break
            data = resp.json() if resp.content else {}
            values = data.get('values') or []
            for v in values:
                if isinstance(v, str) and v:
                    seen.add(v.strip())
            is_last = bool(data.get('isLast', True))
            if is_last or not values or len(seen) >= hard_cap:
                break
            start_at += len(values)
    out = [JiraLabelItem(name=n) for n in sorted(seen, key=str.lower)]
    return out


@router.get('/jira/projects', response_model=list[JiraProjectItem])
async def list_jira_projects(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[JiraProjectItem]:
    """Return all projects visible to the configured Jira account. Used by
    the rule editor so the user picks from a list instead of typing a key."""
    service = IntegrationConfigService(db)
    cfg = await service.get_config(tenant.organization_id, 'jira')
    if cfg is None or not cfg.secret:
        return []
    base_url = (cfg.base_url or '').rstrip('/')
    if not base_url:
        return []
    import base64
    email = (cfg.username or '').strip()
    auth = base64.b64encode(f'{email}:{cfg.secret}'.encode()).decode()
    headers = {'Authorization': f'Basic {auth}', 'Accept': 'application/json'}
    out: list[JiraProjectItem] = []
    seen: set[str] = set()
    start_at = 0
    page_size = 50
    async with httpx.AsyncClient(timeout=20) as client:
        while True:
            resp = await client.get(
                f'{base_url}/rest/api/3/project/search?startAt={start_at}&maxResults={page_size}',
                headers=headers,
            )
            if resp.status_code != 200:
                break
            data = resp.json() if resp.content else {}
            values = data.get('values') or []
            for p in values:
                if not isinstance(p, dict):
                    continue
                key = str(p.get('key') or '').strip()
                name = str(p.get('name') or key).strip()
                if not key or key in seen:
                    continue
                seen.add(key)
                out.append(JiraProjectItem(key=key, name=name))
            if data.get('isLast', True) or not values:
                break
            start_at += len(values)
    out.sort(key=lambda p: p.key.lower())
    return out


# ── Azure DevOps metadata for IntegrationRule UI ────────────────────────────

class AzureUserItem(BaseModel):
    email: str
    display_name: str


class AzureWorkItemTypeItem(BaseModel):
    name: str
    color: str | None = None


@router.get('/azure/users', response_model=list[AzureUserItem])
async def list_azure_users(
    project: str = Query(..., description='Azure DevOps project name or ID'),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[AzureUserItem]:
    """Return team members for the project — used as the candidate list for
    'created by' rule matching."""
    import base64
    service = IntegrationConfigService(db)
    cfg = await service.get_config(tenant.organization_id, 'azure')
    if not cfg or not cfg.secret:
        return []
    base_url = (cfg.base_url or '').rstrip('/')
    if not base_url:
        return []
    auth = base64.b64encode(f':{cfg.secret}'.encode()).decode()
    headers = {'Authorization': f'Basic {auth}', 'Accept': 'application/json'}
    out: list[AzureUserItem] = []
    seen: set[str] = set()
    async with httpx.AsyncClient(timeout=20) as client:
        # Fetch all teams in the project, then their members.
        teams_resp = await client.get(
            f'{base_url}/_apis/projects/{quote(project)}/teams?api-version=7.1',
            headers=headers,
        )
        if teams_resp.status_code != 200:
            return []
        for team in teams_resp.json().get('value', []):
            team_id = team.get('id')
            if not team_id:
                continue
            members_resp = await client.get(
                f'{base_url}/_apis/projects/{quote(project)}/teams/{team_id}/members?api-version=7.1',
                headers=headers,
            )
            if members_resp.status_code != 200:
                continue
            for m in members_resp.json().get('value', []):
                ident = m.get('identity') or {}
                mail = str(ident.get('uniqueName') or '').strip()
                display = str(ident.get('displayName') or mail).strip()
                key = mail or display
                if not key or key in seen:
                    continue
                seen.add(key)
                out.append(AzureUserItem(email=mail, display_name=display))
    out.sort(key=lambda i: i.display_name.lower())
    return out


@router.get('/azure/work-item-types', response_model=list[AzureWorkItemTypeItem])
async def list_azure_work_item_types(
    project: str = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[AzureWorkItemTypeItem]:
    import base64
    service = IntegrationConfigService(db)
    cfg = await service.get_config(tenant.organization_id, 'azure')
    if not cfg or not cfg.secret:
        return []
    base_url = (cfg.base_url or '').rstrip('/')
    if not base_url:
        return []
    auth = base64.b64encode(f':{cfg.secret}'.encode()).decode()
    headers = {'Authorization': f'Basic {auth}', 'Accept': 'application/json'}
    out: list[AzureWorkItemTypeItem] = []
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f'{base_url}/{quote(project)}/_apis/wit/workitemtypes?api-version=7.1',
            headers=headers,
        )
        if resp.status_code != 200:
            return []
        for it in resp.json().get('value', []):
            name = str(it.get('name') or '').strip()
            if not name:
                continue
            out.append(AzureWorkItemTypeItem(name=name, color=it.get('color')))
    out.sort(key=lambda i: i.name.lower())
    return out
