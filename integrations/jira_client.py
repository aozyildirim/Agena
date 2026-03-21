from __future__ import annotations

import logging
from typing import Any

import httpx

from core.settings import get_settings
from schemas.task import ExternalTask

logger = logging.getLogger(__name__)


class JiraClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def fetch_todo_issues(self, cfg: dict[str, str] | None = None) -> list[ExternalTask]:
        cfg = cfg or {}
        base_url = cfg.get('base_url') or self.settings.jira_base_url
        email = cfg.get('email') or self.settings.jira_email
        api_token = cfg.get('api_token') or self.settings.jira_api_token

        if not base_url:
            logger.warning('JIRA_BASE_URL is not set; returning empty task list.')
            return []

        url = f"{base_url.rstrip('/')}/rest/api/3/search"
        params = {
            'jql': 'status = "To Do"',
            'fields': 'summary,description',
            'maxResults': 50,
        }

        auth = (email, api_token)
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, params=params, auth=auth)
            response.raise_for_status()
            data = response.json()

        return [self._to_external_task(issue) for issue in data.get('issues', [])]

    def _to_external_task(self, issue: dict[str, Any]) -> ExternalTask:
        fields = issue.get('fields', {})
        return ExternalTask(
            id=issue.get('id', ''),
            title=fields.get('summary', ''),
            description=self._parse_jira_description(fields.get('description')),
            source='jira',
        )

    def _parse_jira_description(self, payload: Any) -> str:
        if not payload:
            return ''
        if isinstance(payload, str):
            return payload

        parts: list[str] = []
        for block in payload.get('content', []):
            for child in block.get('content', []):
                text = child.get('text')
                if text:
                    parts.append(text)
        return '\n'.join(parts)
