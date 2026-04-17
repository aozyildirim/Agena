"""Bitbucket Pull Request service — push files via API and create PR."""
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


class BitbucketPRService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    def _headers(self, token: str) -> dict[str, str]:
        return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

    async def create_pr(
        self,
        organization_id: int,
        *,
        workspace: str,
        repo_slug: str,
        source_branch: str,
        target_branch: str,
        title: str,
        description: str,
    ) -> str:
        config = await IntegrationConfigService(self.db).get_config(organization_id, 'bitbucket')
        if config is None or not config.secret:
            raise ValueError('Bitbucket integration not configured')

        base_url = (config.base_url or 'https://api.bitbucket.org/2.0').rstrip('/')
        api = f'{base_url}/repositories/{workspace}/{repo_slug}/pullrequests'

        payload = {
            'title': title,
            'description': description,
            'source': {'branch': {'name': source_branch}},
            'destination': {'branch': {'name': target_branch}},
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(api, headers=self._headers(config.secret), json=payload)
            if resp.status_code in (400, 409):
                existing = await self._find_existing_pr(
                    base_url, config.secret, workspace, repo_slug, source_branch)
                if existing:
                    return existing
                err_body = ''
                try:
                    err_body = resp.json().get('error', {}).get('message', resp.text[:300])
                except Exception:
                    err_body = resp.text[:300]
                logger.warning('Bitbucket PR creation returned %s: %s', resp.status_code, err_body)
                resp.raise_for_status()
            resp.raise_for_status()
            data = resp.json()
        return data.get('links', {}).get('html', {}).get('href', '')

    async def push_files_and_create_pr(
        self,
        organization_id: int,
        *,
        workspace: str,
        repo_slug: str,
        branch_name: str,
        target_branch: str,
        title: str,
        description: str,
        files: list[dict],
        commit_message: str,
    ) -> str:
        config = await IntegrationConfigService(self.db).get_config(organization_id, 'bitbucket')
        if config is None or not config.secret:
            raise ValueError('Bitbucket integration not configured')

        base_url = (config.base_url or 'https://api.bitbucket.org/2.0').rstrip('/')
        headers_auth = {'Authorization': f'Bearer {config.secret}'}
        repo_api = f'{base_url}/repositories/{workspace}/{repo_slug}'

        async with httpx.AsyncClient(timeout=60) as client:
            # 1. Create branch from target
            r = await client.get(f'{repo_api}/refs/branches/{target_branch}', headers=headers_auth)
            if r.status_code == 200:
                target_hash = r.json().get('target', {}).get('hash', '')
            else:
                target_hash = ''

            if target_hash:
                await client.post(f'{repo_api}/refs/branches', headers={**headers_auth, 'Content-Type': 'application/json'},
                    json={'name': branch_name, 'target': {'hash': target_hash}})
                # Ignore error if branch exists

            # 2. Push files via src endpoint (multipart form)
            # Bitbucket uses /src endpoint for file commits
            form_data = {}
            for f in files:
                path = f.get('path', '').lstrip('/')
                content = f.get('content', '')
                if not path or not content:
                    continue
                if _INVALID_PATH_CHARS_RE.search(path):
                    logger.warning('Skipping file with invalid path: %r', path)
                    continue
                form_data[path] = (path, content.encode(), 'text/plain')

            if not form_data:
                raise ValueError('No file changes to commit')

            # Bitbucket src endpoint for commits
            import httpx as _httpx
            async with _httpx.AsyncClient(timeout=60) as upload_client:
                files_list = [(path, content) for path, (_, content, _) in form_data.items()]
                multipart_files = [(path, (path, content, 'text/plain')) for path, content in files_list]

                resp = await upload_client.post(
                    f'{repo_api}/src',
                    headers=headers_auth,
                    data={
                        'message': commit_message,
                        'branch': branch_name,
                    },
                    files=multipart_files,
                )
                if resp.status_code not in (200, 201):
                    logger.warning('Bitbucket file push: %s %s', resp.status_code, resp.text[:200])
                    resp.raise_for_status()

            # 3. Create PR
            return await self.create_pr(
                organization_id,
                workspace=workspace,
                repo_slug=repo_slug,
                source_branch=branch_name,
                target_branch=target_branch,
                title=title,
                description=description,
            )

    async def _find_existing_pr(
        self, base_url: str, token: str, workspace: str, repo_slug: str, source_branch: str,
    ) -> str | None:
        api = f'{base_url}/repositories/{workspace}/{repo_slug}/pullrequests?q=source.branch.name="{source_branch}"&state=OPEN'
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(api, headers=self._headers(token))
            if resp.status_code != 200:
                return None
            prs = resp.json().get('values', [])
        if not prs:
            return None
        return prs[0].get('links', {}).get('html', {}).get('href', '')

    async def list_pr_comments(self, organization_id: int, *, pr_url: str) -> list[dict[str, str]]:
        config = await IntegrationConfigService(self.db).get_config(organization_id, 'bitbucket')
        if config is None or not config.secret:
            raise ValueError('Bitbucket integration not configured')

        ref = self._parse_pr_ref(pr_url)
        if ref is None:
            raise ValueError('Bitbucket PR URL could not be parsed')

        workspace, repo_slug, pr_id = ref
        base_url = (config.base_url or 'https://api.bitbucket.org/2.0').rstrip('/')
        api = f'{base_url}/repositories/{workspace}/{repo_slug}/pullrequests/{pr_id}/comments'

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(api, headers=self._headers(config.secret))
            resp.raise_for_status()
            data = resp.json()

        return [
            {'id': str(c.get('id', '')), 'author': c.get('user', {}).get('display_name', ''), 'content': c.get('content', {}).get('raw', '')}
            for c in data.get('values', []) if c.get('content', {}).get('raw', '').strip()
        ]

    def _parse_pr_ref(self, pr_url: str) -> tuple[str, str, int] | None:
        m = re.search(r'bitbucket\.org/([^/]+)/([^/]+)/pull-requests/(\d+)', pr_url)
        if m:
            return m.group(1), m.group(2), int(m.group(3))
        return None
