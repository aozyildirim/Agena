from __future__ import annotations

import base64
import logging
import re
from urllib.parse import urlparse

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from agena_services.services.integration_config_service import IntegrationConfigService

logger = logging.getLogger(__name__)

_INVALID_PATH_CHARS_RE = re.compile(r'[\[\]*?<>|"#{};\x00]')


class AzurePRService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create_pr(
        self,
        organization_id: int,
        *,
        project: str,
        repo_url: str,
        source_branch: str,
        target_branch: str,
        title: str,
        description: str,
    ) -> str:
        config = await IntegrationConfigService(self.db).get_config(organization_id, 'azure')
        if config is None or not config.secret:
            raise ValueError('Azure integration not configured')

        org_url = config.base_url.rstrip('/')
        repo_name = self._extract_repo_name(repo_url)
        if not repo_name:
            raise ValueError('Azure repo URL could not be parsed from mapping')

        pr_api = f'{org_url}/{project}/_apis/git/repositories/{repo_name}/pullrequests?api-version=7.1-preview.1'
        payload = {
            'sourceRefName': f'refs/heads/{source_branch}',
            'targetRefName': f'refs/heads/{target_branch}',
            'title': title,
            'description': description,
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(pr_api, headers=self._headers(config.secret), json=payload)
            if resp.status_code in (400, 409):
                # PR already exists for this branch — find and return the existing one
                existing_url = await self._find_existing_pr(
                    org_url=org_url,
                    project=project,
                    repo_name=repo_name,
                    source_branch=source_branch,
                    target_branch=target_branch,
                    pat=config.secret,
                )
                if existing_url:
                    return existing_url
                resp.raise_for_status()  # no existing PR found, propagate original error
            resp.raise_for_status()
            data = resp.json()

        links = data.get('_links', {}) if isinstance(data, dict) else {}
        web = (links.get('web') or {}).get('href') if isinstance(links, dict) else None
        return web or data.get('url') or ''

    async def list_pr_comments(self, organization_id: int, *, pr_url: str) -> list[dict[str, str]]:
        config = await IntegrationConfigService(self.db).get_config(organization_id, 'azure')
        if config is None or not config.secret:
            raise ValueError('Azure integration not configured')

        ref = self._parse_pr_ref(pr_url)
        if ref is None:
            raise ValueError('PR URL could not be parsed')

        project, repo, pr_id = ref
        api = (
            f"{config.base_url.rstrip('/')}/{project}"
            f"/_apis/git/repositories/{repo}/pullRequests/{pr_id}/threads?api-version=7.1-preview.1"
        )
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(api, headers=self._headers(config.secret))
            resp.raise_for_status()
            data = resp.json()

        out: list[dict[str, str]] = []
        for thread in data.get('value', []) or []:
            comments = thread.get('comments', []) or []
            for c in comments:
                content = str(c.get('content') or '').strip()
                if not content:
                    continue
                author = (c.get('author') or {}).get('displayName') or (c.get('author') or {}).get('uniqueName') or ''
                out.append({
                    'id': str(c.get('id') or ''),
                    'author': str(author),
                    'content': content,
                    'thread_status': str(thread.get('status') or ''),
                })
        return out

    async def post_pr_comment(self, organization_id: int, *, pr_url: str, comment: str) -> int | None:
        config = await IntegrationConfigService(self.db).get_config(organization_id, 'azure')
        if config is None or not config.secret:
            raise ValueError('Azure integration not configured')

        ref = self._parse_pr_ref(pr_url)
        if ref is None:
            raise ValueError('PR URL could not be parsed')
        project, repo, pr_id = ref

        api = (
            f"{config.base_url.rstrip('/')}/{project}"
            f"/_apis/git/repositories/{repo}/pullRequests/{pr_id}/threads?api-version=7.1-preview.1"
        )
        payload = {
            'comments': [{
                'parentCommentId': 0,
                'content': comment,
                'commentType': 1,
            }],
            'status': 'active',
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(api, headers=self._headers(config.secret), json=payload)
            resp.raise_for_status()
            data = resp.json()
        return data.get('id') if isinstance(data, dict) else None

    async def _find_existing_pr(
        self,
        org_url: str,
        project: str,
        repo_name: str,
        source_branch: str,
        target_branch: str,
        pat: str,
    ) -> str | None:
        """Find an active PR for the given source→target branch pair."""
        search_api = (
            f'{org_url}/{project}/_apis/git/repositories/{repo_name}/pullrequests'
            f'?searchCriteria.sourceRefName=refs/heads/{source_branch}'
            f'&searchCriteria.targetRefName=refs/heads/{target_branch}'
            f'&searchCriteria.status=active'
            f'&api-version=7.1-preview.1'
        )
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(search_api, headers=self._headers(pat))
            if resp.status_code != 200:
                return None
            data = resp.json()
        prs = data.get('value', []) or []
        if not prs:
            return None
        pr = prs[0]
        links = pr.get('_links', {}) if isinstance(pr, dict) else {}
        web = (links.get('web') or {}).get('href') if isinstance(links, dict) else None
        return web or pr.get('url') or None

    async def push_files_and_create_pr(
        self,
        organization_id: int,
        *,
        project: str,
        repo_name: str,
        branch_name: str,
        target_branch: str,
        title: str,
        description: str,
        files: list[dict],
        commit_message: str,
    ) -> str:
        """Push file changes via Azure Pushes API and create a PR — no local repo needed."""
        config = await IntegrationConfigService(self.db).get_config(organization_id, 'azure')
        if config is None or not config.secret:
            raise ValueError('Azure integration not configured')
        org_url = config.base_url.rstrip('/')
        headers = self._headers(config.secret)

        # 1. Get latest commit on target branch
        refs_api = (
            f'{org_url}/{project}/_apis/git/repositories/{repo_name}'
            f'/refs?filter=heads/{target_branch}&api-version=7.1-preview.1'
        )
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(refs_api, headers=headers)
            r.raise_for_status()
        refs = r.json().get('value', [])
        if not refs:
            raise ValueError(f'Target branch {target_branch} not found in {project}/{repo_name}')
        old_object_id = refs[0]['objectId']

        # 2. Build push payload with file changes
        changes = []
        for f in files:
            path = f.get('path', '')
            content = f.get('content', '')
            if not path or not content:
                continue
            if _INVALID_PATH_CHARS_RE.search(path):
                logger.warning('Skipping file with invalid path in Azure push: %r', path)
                continue
            # Ensure path starts with /
            if not path.startswith('/'):
                path = '/' + path
            changes.append({
                'changeType': 'edit',  # edit existing or add new
                'item': {'path': path},
                'newContent': {
                    'content': content,
                    'contentType': 'rawtext',
                },
            })
        if not changes:
            raise ValueError('No file changes to push')

        push_api = (
            f'{org_url}/{project}/_apis/git/repositories/{repo_name}'
            f'/pushes?api-version=7.1-preview.2'
        )
        push_payload = {
            'refUpdates': [{
                'name': f'refs/heads/{branch_name}',
                'oldObjectId': old_object_id,
            }],
            'commits': [{
                'comment': commit_message,
                'changes': changes,
            }],
        }
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(push_api, headers=headers, json=push_payload)
            if r.status_code == 409:
                # Branch may already exist — get its latest commit and retry
                branch_refs_api = (
                    f'{org_url}/{project}/_apis/git/repositories/{repo_name}'
                    f'/refs?filter=heads/{branch_name}&api-version=7.1-preview.1'
                )
                br = await client.get(branch_refs_api, headers=headers)
                if br.status_code == 200:
                    branch_refs = br.json().get('value', [])
                    if branch_refs:
                        push_payload['refUpdates'][0]['oldObjectId'] = branch_refs[0]['objectId']
                        r = await client.post(push_api, headers=headers, json=push_payload)
            r.raise_for_status()

        # 3. Create PR
        repo_url = f'{org_url}/{project}/_git/{repo_name}'
        return await self.create_pr(
            organization_id,
            project=project,
            repo_url=repo_url,
            source_branch=branch_name,
            target_branch=target_branch,
            title=title,
            description=description,
        )

    def _headers(self, pat: str) -> dict[str, str]:
        token = base64.b64encode(f':{pat}'.encode()).decode()
        return {'Authorization': f'Basic {token}', 'Content-Type': 'application/json'}

    def _extract_repo_name(self, repo_url: str) -> str:
        parsed = urlparse(repo_url)
        path = (parsed.path or '').rstrip('/')
        if '/_git/' in path:
            return path.split('/_git/')[-1].strip()
        return path.rsplit('/', 1)[-1].strip()

    def _parse_pr_ref(self, pr_url: str) -> tuple[str, str, str] | None:
        parsed = urlparse(pr_url)
        path = (parsed.path or '').strip('/')

        m_web = re.search(r'^(.+?)/_git/([^/]+)/pullrequest/(\d+)$', path, flags=re.IGNORECASE)
        if m_web:
            project = m_web.group(1).split('/')[-1].strip()
            return project, m_web.group(2), m_web.group(3)

        m_api = re.search(
            r'^(.+?)/_apis/git/repositories/([^/]+)/pullRequests/(\d+)$',
            path,
            flags=re.IGNORECASE,
        )
        if m_api:
            # Azure API URLs may include org segment before project:
            # /{org}/{project}/_apis/git/repositories/{repo}/pullRequests/{id}
            # Keep only the last segment as project key.
            project = m_api.group(1).split('/')[-1].strip()
            return project, m_api.group(2), m_api.group(3)
        return None
