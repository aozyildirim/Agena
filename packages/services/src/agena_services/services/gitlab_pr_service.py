"""GitLab Merge Request service — push files via API and create MR."""
from __future__ import annotations

import base64
import logging
import re
from urllib.parse import urlparse, quote

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from agena_services.services.integration_config_service import IntegrationConfigService

logger = logging.getLogger(__name__)

_INVALID_PATH_CHARS_RE = re.compile(r'[\[\]*?<>|"#{};\x00]')


class GitLabPRService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    def _headers(self, token: str) -> dict[str, str]:
        return {'PRIVATE-TOKEN': token, 'Content-Type': 'application/json'}

    async def create_mr(
        self,
        organization_id: int,
        *,
        project_path: str,
        source_branch: str,
        target_branch: str,
        title: str,
        description: str,
    ) -> str:
        config = await IntegrationConfigService(self.db).get_config(organization_id, 'gitlab')
        if config is None or not config.secret:
            raise ValueError('GitLab integration not configured')

        base_url = (config.base_url or 'https://gitlab.com').rstrip('/')
        encoded = quote(project_path, safe='')
        api = f'{base_url}/api/v4/projects/{encoded}/merge_requests'

        payload = {
            'source_branch': source_branch,
            'target_branch': target_branch,
            'title': title,
            'description': description,
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(api, headers=self._headers(config.secret), json=payload)
            if resp.status_code in (400, 409):
                # MR may already exist — find it
                existing = await self._find_existing_mr(
                    base_url, config.secret, encoded, source_branch, target_branch)
                if existing:
                    return existing
                resp.raise_for_status()
            resp.raise_for_status()
            data = resp.json()
        return data.get('web_url', '')

    async def push_files_and_create_mr(
        self,
        organization_id: int,
        *,
        project_path: str,
        branch_name: str,
        target_branch: str,
        title: str,
        description: str,
        files: list[dict],
        commit_message: str,
    ) -> str:
        config = await IntegrationConfigService(self.db).get_config(organization_id, 'gitlab')
        if config is None or not config.secret:
            raise ValueError('GitLab integration not configured')

        base_url = (config.base_url or 'https://gitlab.com').rstrip('/')
        encoded = quote(project_path, safe='')
        headers = self._headers(config.secret)
        api_base = f'{base_url}/api/v4/projects/{encoded}'

        async with httpx.AsyncClient(timeout=60) as client:
            # 1. Create branch from target
            await client.post(f'{api_base}/repository/branches', headers=headers,
                json={'branch': branch_name, 'ref': target_branch})
            # Ignore 400 if branch exists

            # 2. Build commit actions
            actions = []
            for f in files:
                path = f.get('path', '').lstrip('/')
                content = f.get('content', '')
                if not path or not content:
                    continue
                if _INVALID_PATH_CHARS_RE.search(path):
                    logger.warning('Skipping file with invalid path: %r', path)
                    continue
                # Check if file exists
                check = await client.get(
                    f'{api_base}/repository/files/{quote(path, safe="")}?ref={branch_name}',
                    headers=headers)
                action = 'update' if check.status_code == 200 else 'create'
                actions.append({
                    'action': action,
                    'file_path': path,
                    'content': content,
                })

            if not actions:
                raise ValueError('No file changes to commit')

            # 3. Commit all files in one commit
            resp = await client.post(f'{api_base}/repository/commits', headers=headers, json={
                'branch': branch_name,
                'commit_message': commit_message,
                'actions': actions,
            })
            resp.raise_for_status()

            # 4. Create MR
            mr_resp = await client.post(f'{api_base}/merge_requests', headers=headers, json={
                'source_branch': branch_name,
                'target_branch': target_branch,
                'title': title,
                'description': description,
            })
            if mr_resp.status_code in (400, 409):
                existing = await self._find_existing_mr(
                    base_url, config.secret, encoded, branch_name, target_branch)
                if existing:
                    return existing
                mr_resp.raise_for_status()
            mr_resp.raise_for_status()
            return mr_resp.json().get('web_url', '')

    async def _find_existing_mr(
        self, base_url: str, token: str, encoded_project: str,
        source_branch: str, target_branch: str,
    ) -> str | None:
        api = (f'{base_url}/api/v4/projects/{encoded_project}/merge_requests'
               f'?source_branch={source_branch}&target_branch={target_branch}&state=opened')
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(api, headers=self._headers(token))
            if resp.status_code != 200:
                return None
            mrs = resp.json()
        if not mrs:
            return None
        return mrs[0].get('web_url', '')

    async def list_mr_comments(self, organization_id: int, *, mr_url: str) -> list[dict[str, str]]:
        config = await IntegrationConfigService(self.db).get_config(organization_id, 'gitlab')
        if config is None or not config.secret:
            raise ValueError('GitLab integration not configured')

        ref = self._parse_mr_ref(mr_url)
        if ref is None:
            raise ValueError('GitLab MR URL could not be parsed')

        project_path, mr_iid = ref
        base_url = (config.base_url or 'https://gitlab.com').rstrip('/')
        encoded = quote(project_path, safe='')
        api = f'{base_url}/api/v4/projects/{encoded}/merge_requests/{mr_iid}/notes'

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(api, headers=self._headers(config.secret))
            resp.raise_for_status()
            notes = resp.json()

        return [
            {'id': str(n.get('id', '')), 'author': n.get('author', {}).get('username', ''), 'content': n.get('body', '')}
            for n in notes if n.get('body', '').strip()
        ]

    def _parse_mr_ref(self, mr_url: str) -> tuple[str, int] | None:
        m = re.search(r'([^/]+/[^/]+)/-/merge_requests/(\d+)', mr_url)
        if m:
            return m.group(1), int(m.group(2))
        return None
