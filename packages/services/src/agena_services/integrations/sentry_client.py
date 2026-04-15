from __future__ import annotations

import logging
from typing import Any

import httpx

from agena_models.schemas.task import ExternalTask

logger = logging.getLogger(__name__)


class SentryClient:
    """Async client for Sentry Issues API."""

    def __init__(self) -> None:
        self.default_base_url = 'https://sentry.io/api/0'

    def _resolve(self, cfg: dict[str, str] | None) -> tuple[str, str]:
        cfg = cfg or {}
        base_url = (cfg.get('base_url') or self.default_base_url).strip().rstrip('/')
        if '/api/' not in base_url:
            base_url = f'{base_url}/api/0'
        token = (cfg.get('api_token') or '').strip()
        return base_url, token

    async def list_projects(
        self,
        cfg: dict[str, str],
        *,
        organization_slug: str,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        base_url, token = self._resolve(cfg)
        if not token:
            logger.warning('Sentry token not set; returning empty projects list.')
            return []

        url = f'{base_url}/organizations/{organization_slug}/projects/'
        headers = {
            'Authorization': f'Bearer {token}',
            'Accept': 'application/json',
        }
        params = {
            'limit': str(max(1, min(limit, 100))),
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
        return data if isinstance(data, list) else []

    async def list_issue_events(
        self,
        cfg: dict[str, str],
        *,
        organization_slug: str,
        issue_id: str,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        base_url, token = self._resolve(cfg)
        if not token:
            logger.warning('Sentry token not set; returning empty issue events list.')
            return []
        url = f'{base_url}/organizations/{organization_slug}/issues/{issue_id}/events/'
        headers = {
            'Authorization': f'Bearer {token}',
            'Accept': 'application/json',
        }
        params = {
            'limit': str(max(1, min(limit, 50))),
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
        return data if isinstance(data, list) else []

    async def list_issues(
        self,
        cfg: dict[str, str],
        *,
        organization_slug: str,
        project_slug: str,
        query: str = 'is:unresolved',
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        base_url, token = self._resolve(cfg)
        if not token:
            logger.warning('Sentry token not set; returning empty issues list.')
            return []

        url = f'{base_url}/projects/{organization_slug}/{project_slug}/issues/'
        headers = {
            'Authorization': f'Bearer {token}',
            'Accept': 'application/json',
        }
        params = {
            'query': query,
            'limit': str(max(1, min(limit, 100))),
            'sort': 'freq',
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
        return data if isinstance(data, list) else []

    def issues_to_external_tasks(
        self,
        issues: list[dict[str, Any]],
        *,
        organization_slug: str,
        project_slug: str,
    ) -> list[ExternalTask]:
        items: list[ExternalTask] = []
        for issue in issues:
            issue_id = str(issue.get('id') or '').strip()
            if not issue_id:
                continue
            title = str(issue.get('title') or issue.get('shortId') or 'Sentry issue').strip()
            permalink = str(issue.get('permalink') or '').strip()
            level = str(issue.get('level') or 'error').strip()
            culprit = str(issue.get('culprit') or '').strip()
            count = str(issue.get('count') or '0').strip()
            user_count = str(issue.get('userCount') or '0').strip()
            status = str(issue.get('status') or '').strip() or None
            last_seen = str(issue.get('lastSeen') or '').strip()
            short_id = str(issue.get('shortId') or '').strip()

            desc_lines = [
                f'External Source: Sentry #{short_id or issue_id}',
                f'Organization: {organization_slug}',
                f'Project: {project_slug}',
                f'Level: {level}',
                f'Status: {status or "unknown"}',
                f'Events: {count}',
                f'Affected Users: {user_count}',
            ]
            if culprit:
                desc_lines.append(f'Culprit: {culprit}')
            if last_seen:
                desc_lines.append(f'Last Seen: {last_seen}')
            if permalink:
                desc_lines.append(f'Sentry URL: {permalink}')

            items.append(
                ExternalTask(
                    id=f'{project_slug}:{issue_id}',
                    title=title,
                    description='\n'.join(desc_lines),
                    source='sentry',
                    state=status,
                    created_date=None,
                    web_url=permalink or None,
                )
            )
        return items
