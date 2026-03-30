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

    async def fetch_projects(self, cfg: dict[str, str] | None = None) -> list[dict[str, str]]:
        base_url, email, api_token = self._resolve_config(cfg)
        if not base_url:
            return []
        search_url = f"{base_url.rstrip('/')}/rest/api/3/project/search"
        list_url = f"{base_url.rstrip('/')}/rest/api/3/project"
        params = {'maxResults': 100}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(search_url, params=params, auth=(email, api_token))
            response.raise_for_status()
            data = response.json()
            values = data.get('values', []) if isinstance(data, dict) else []
            projects = self._normalize_projects(values)
            if projects:
                return projects
            # Jira variants/fallback: some tenants return projects from /project directly.
            fallback = await client.get(list_url, auth=(email, api_token))
            fallback.raise_for_status()
            fallback_data = fallback.json()
        return self._normalize_projects(fallback_data if isinstance(fallback_data, list) else [])

    def _normalize_projects(self, rows: list[dict[str, Any]]) -> list[dict[str, str]]:
        return [
            {
                'id': str(p.get('id', '')),
                'key': str(p.get('key', '')),
                'name': str(p.get('name', '')),
            }
            for p in rows
            if p.get('key') and p.get('name')
        ]

    async def fetch_boards(
        self,
        cfg: dict[str, str] | None = None,
        *,
        project_key: str | None = None,
    ) -> list[dict[str, str]]:
        base_url, email, api_token = self._resolve_config(cfg)
        if not base_url:
            return []
        url = f"{base_url.rstrip('/')}/rest/agile/1.0/board"
        params: dict[str, str | int] = {'maxResults': 100}
        if project_key:
            params['projectKeyOrId'] = project_key.strip()
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, params=params, auth=(email, api_token))
            response.raise_for_status()
            data = response.json()
        return [
            {
                'id': str(b.get('id', '')),
                'name': str(b.get('name', '')),
                'type': str(b.get('type', '')),
            }
            for b in data.get('values', [])
            if b.get('id') and b.get('name')
        ]

    async def fetch_sprints(self, cfg: dict[str, str] | None = None, *, board_id: str) -> list[dict[str, str]]:
        base_url, email, api_token = self._resolve_config(cfg)
        if not base_url or not board_id:
            return []
        url = f"{base_url.rstrip('/')}/rest/agile/1.0/board/{board_id}/sprint"
        params = {'state': 'active,future,closed', 'maxResults': 100}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, params=params, auth=(email, api_token))
            response.raise_for_status()
            data = response.json()
        return [
            {
                'id': str(s.get('id', '')),
                'name': str(s.get('name', '')),
                'state': str(s.get('state', '')),
                'start_date': str(s.get('startDate', '') or ''),
                'finish_date': str(s.get('endDate', '') or ''),
            }
            for s in data.get('values', [])
            if s.get('id') and s.get('name')
        ]

    async def fetch_board_states(self, cfg: dict[str, str] | None = None, *, board_id: str) -> list[str]:
        base_url, email, api_token = self._resolve_config(cfg)
        if not base_url or not board_id:
            return []
        url = f"{base_url.rstrip('/')}/rest/agile/1.0/board/{board_id}/configuration"
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, auth=(email, api_token))
            response.raise_for_status()
            data = response.json()
        seen: list[str] = []
        for col in (data.get('columnConfig') or {}).get('columns', []) or []:
            for st in col.get('statuses', []) or []:
                name = str(st.get('name', '')).strip()
                if name and name not in seen:
                    seen.append(name)
        return seen

    async def fetch_board_issues(
        self,
        cfg: dict[str, str] | None = None,
        *,
        board_id: str,
        sprint_id: str | None = None,
        state: str | None = None,
    ) -> list[ExternalTask]:
        base_url, email, api_token = self._resolve_config(cfg)
        if not base_url or not board_id:
            return []

        url = f"{base_url.rstrip('/')}/rest/agile/1.0/board/{board_id}/issue"
        params: dict[str, str | int] = {
            'maxResults': 100,
            'fields': 'summary,description,status,assignee,created',
        }
        if sprint_id:
            params['sprint'] = sprint_id
        if state:
            escaped = state.replace('"', '\\"')
            params['jql'] = f'status = "{escaped}"'

        async with httpx.AsyncClient(timeout=40) as client:
            try:
                response = await client.get(url, params=params, auth=(email, api_token))
                response.raise_for_status()
                data = response.json()
            except httpx.HTTPStatusError as exc:
                # Some Jira boards reject status-based JQL in this endpoint with 400.
                # Fall back to plain board/sprint query and filter by issue status locally.
                if state and exc.response is not None and exc.response.status_code == 400:
                    logger.warning(
                        'Jira board issue query rejected status JQL; falling back to local filtering. '
                        'board_id=%s sprint_id=%s state=%s',
                        board_id,
                        sprint_id,
                        state,
                    )
                    fallback_params = dict(params)
                    fallback_params.pop('jql', None)
                    fallback_response = await client.get(url, params=fallback_params, auth=(email, api_token))
                    fallback_response.raise_for_status()
                    data = fallback_response.json()
                else:
                    raise
        items = [self._to_external_task(issue) for issue in data.get('issues', [])]
        if state:
            target = self._normalize_status(state)
            return [item for item in items if self._normalize_status(item.state) == target]
        return items

    async def fetch_sprint_work_items(
        self,
        cfg: dict[str, str] | None = None,
        *,
        board_id: str,
        sprint_id: str,
    ) -> list[ExternalTask]:
        base_url, email, api_token = self._resolve_config(cfg)
        if not base_url or not board_id or not sprint_id:
            return []

        story_point_field = await self._fetch_story_point_field_id(
            base_url=base_url,
            email=email,
            api_token=api_token,
            board_id=board_id,
        )
        fields = ['summary', 'description', 'status', 'assignee', 'created']
        if story_point_field:
            fields.append(story_point_field)

        url = f"{base_url.rstrip('/')}/rest/agile/1.0/board/{board_id}/issue"
        start_at = 0
        max_results = 100
        items: list[ExternalTask] = []

        async with httpx.AsyncClient(timeout=40) as client:
            while True:
                params: dict[str, str | int] = {
                    'sprint': sprint_id,
                    'fields': ','.join(fields),
                    'maxResults': max_results,
                    'startAt': start_at,
                }
                response = await client.get(url, params=params, auth=(email, api_token))
                response.raise_for_status()
                data = response.json()
                issues = data.get('issues', [])
                for issue in issues:
                    task = self._to_external_task(issue, story_point_field=story_point_field)
                    task.sprint_id = sprint_id
                    task.web_url = self._build_issue_browse_url(base_url, task.id)
                    items.append(task)

                total = int(data.get('total') or 0)
                fetched = int(data.get('maxResults') or max_results)
                start_at += fetched
                if not issues or start_at >= total:
                    break
        return items

    def _resolve_config(self, cfg: dict[str, str] | None) -> tuple[str, str, str]:
        cfg = cfg or {}
        base_url = cfg.get('base_url') or self.settings.jira_base_url
        email = cfg.get('email') or self.settings.jira_email
        api_token = cfg.get('api_token') or self.settings.jira_api_token
        return base_url, email, api_token

    async def _fetch_story_point_field_id(
        self,
        *,
        base_url: str,
        email: str,
        api_token: str,
        board_id: str,
    ) -> str | None:
        url = f"{base_url.rstrip('/')}/rest/agile/1.0/board/{board_id}/configuration"
        async with httpx.AsyncClient(timeout=20) as client:
            try:
                response = await client.get(url, auth=(email, api_token))
                response.raise_for_status()
                data = response.json()
            except httpx.HTTPError:
                return None
        estimation = data.get('estimation') or {}
        field = estimation.get('field') if isinstance(estimation, dict) else {}
        if not isinstance(field, dict):
            return None
        value = str(field.get('fieldId') or '').strip()
        return value or None

    def _to_external_task(self, issue: dict[str, Any], *, story_point_field: str | None = None) -> ExternalTask:
        fields = issue.get('fields', {})
        story_points = None
        if story_point_field:
            story_points = self._coerce_float(fields.get(story_point_field))
        return ExternalTask(
            id=issue.get('key', '') or issue.get('id', ''),
            title=fields.get('summary', ''),
            description=self._parse_jira_description(fields.get('description')),
            source='jira',
            state=((fields.get('status') or {}).get('name') if isinstance(fields.get('status'), dict) else None),
            assigned_to=((fields.get('assignee') or {}).get('displayName') if isinstance(fields.get('assignee'), dict) else None),
            created_date=fields.get('created'),
            story_points=story_points,
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

    def _normalize_status(self, value: str | None) -> str:
        return str(value or '').strip().casefold()

    def _coerce_float(self, value: Any) -> float | None:
        if value in (None, ''):
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _build_issue_browse_url(self, base_url: str, key: str) -> str | None:
        normalized = str(key or '').strip()
        if not normalized:
            return None
        return f"{base_url.rstrip('/')}/browse/{normalized}"
