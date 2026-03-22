from __future__ import annotations

import base64
import re
from urllib.parse import urlparse

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from services.integration_config_service import IntegrationConfigService


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

        m_web = re.search(r'^([^/]+)/_git/([^/]+)/pullrequest/(\d+)$', path, flags=re.IGNORECASE)
        if m_web:
            return m_web.group(1), m_web.group(2), m_web.group(3)

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
