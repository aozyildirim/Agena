from __future__ import annotations

import logging
from typing import Any

import httpx

from agena_core.settings import get_settings
from agena_models.schemas.task import ExternalTask

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

    async def fetch_completed_issues(
        self,
        cfg: dict[str, str] | None = None,
        *,
        project: str | None = None,
        board_id: str | None = None,
        since_days: int | None = 730,
        max_items: int = 5000,
    ) -> list[ExternalTask]:
        """JQL search for terminal-state issues with story points — used
        to backfill the refinement similarity index.

        Scope prefers project key when provided; otherwise uses the board's
        inferred scope. StoryPoints filter keeps the result set bounded.
        """
        base_url, email, api_token = self._resolve_config(cfg)
        if not base_url:
            return []

        story_point_field: str | None = None
        if board_id:
            story_point_field = await self._fetch_story_point_field_id(
                base_url=base_url, email=email, api_token=api_token, board_id=board_id,
            )
        # Fallback well-known field id — most Jira instances use customfield_10016
        # or customfield_10026 for Story Points. Try both in JQL via name syntax.
        sp_field = story_point_field or 'customfield_10016'

        jql_parts: list[str] = ['statusCategory = Done']
        if project:
            # project key or name; quote if it has spaces
            safe = str(project).replace('"', '\\"')
            jql_parts.append(f'project = "{safe}"')
        # 'Story Points' by field name — works on most Jira instances
        jql_parts.append('"Story Points" is not EMPTY')
        jql_parts.append('"Story Points" > 0')
        if since_days and since_days > 0:
            jql_parts.append(f'resolutiondate >= -{int(since_days)}d')
        jql = ' AND '.join(jql_parts) + ' ORDER BY resolutiondate DESC'

        url = f"{base_url.rstrip('/')}/rest/api/3/search"
        # Always request the numeric SP custom field so we can coerce it, and
        # include *all so the sprint custom field (varies by instance) comes
        # through without us having to guess its id.
        fields_list = ['summary', 'description', 'status', 'assignee', 'created', 'resolutiondate', 'issuetype', sp_field, '*all']
        items: list[ExternalTask] = []
        start_at = 0
        page_size = 100

        async with httpx.AsyncClient(timeout=60) as client:
            while True:
                params: dict[str, str | int] = {
                    'jql': jql,
                    'fields': ','.join(fields_list),
                    'maxResults': page_size,
                    'startAt': start_at,
                }
                try:
                    response = await client.get(url, params=params, auth=(email, api_token))
                    response.raise_for_status()
                    data = response.json()
                except httpx.HTTPStatusError as exc:
                    body = ''
                    try:
                        body = exc.response.text[:500]
                    except Exception:
                        pass
                    logger.error(
                        'Jira completed JQL failed %s: body=%r jql=%r',
                        exc.response.status_code, body, jql,
                    )
                    raise RuntimeError(f'Jira search {exc.response.status_code}: {body or exc}') from exc

                issues = data.get('issues', []) or []
                for issue in issues:
                    task = self._to_external_task(issue, story_point_field=sp_field)
                    task.web_url = self._build_issue_browse_url(base_url, task.id)
                    # Surface issue type into work_item_type so the UI groups by it
                    issuetype = (issue.get('fields') or {}).get('issuetype') or {}
                    if isinstance(issuetype, dict):
                        task.work_item_type = issuetype.get('name')
                    items.append(task)

                total = int(data.get('total') or 0)
                fetched = len(issues)
                start_at += max(fetched, page_size)
                if fetched == 0 or start_at >= total or len(items) >= max_items:
                    break

        if max_items and max_items > 0 and len(items) > max_items:
            items = items[:max_items]
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

    async def writeback_refinement(
        self,
        *,
        cfg: dict[str, str] | None,
        issue_key: str,
        suggested_story_points: int,
        comment: str,
        board_id: str,
    ) -> None:
        base_url, email, api_token = self._resolve_config(cfg)
        key = str(issue_key or '').strip()
        if not base_url or not key:
            raise ValueError('Jira base_url or issue key is missing')

        story_field = await self._fetch_story_point_field_id(
            base_url=base_url,
            email=email,
            api_token=api_token,
            board_id=board_id,
        ) if board_id else None

        async with httpx.AsyncClient(timeout=30) as client:
            if story_field and int(suggested_story_points or 0) > 0:
                issue_url = f"{base_url.rstrip('/')}/rest/api/3/issue/{key}"
                payload = {'fields': {story_field: int(suggested_story_points)}}
                response = await client.put(issue_url, json=payload, auth=(email, api_token))
                response.raise_for_status()

            comment_text = str(comment or '').strip()
            if comment_text:
                comment_url = f"{base_url.rstrip('/')}/rest/api/3/issue/{key}/comment"
                comment_payload = {
                    'body': self._format_comment_adf(comment_text),
                }
                response = await client.post(comment_url, json=comment_payload, auth=(email, api_token))
                response.raise_for_status()

    async def create_issue(
        self,
        *,
        cfg: dict[str, str] | None,
        project_key: str,
        summary: str,
        description: str = '',
        issue_type: str = 'Bug',
        labels: list[str] | None = None,
    ) -> dict[str, Any]:
        """Create a Jira issue and return the response (includes id + key)."""
        base_url, email, api_token = self._resolve_config(cfg)
        key = str(project_key or '').strip()
        if not base_url or not key or not summary:
            raise ValueError('Jira base_url, project_key and summary are required')

        fields: dict[str, Any] = {
            'project': {'key': key},
            'summary': summary[:255],
            'issuetype': {'name': issue_type or 'Bug'},
        }
        if description:
            fields['description'] = self._format_comment_adf(description)
        if labels:
            fields['labels'] = [str(lbl) for lbl in labels if lbl]

        url = f"{base_url.rstrip('/')}/rest/api/3/issue"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json={'fields': fields}, auth=(email, api_token))
            resp.raise_for_status()
            return resp.json()

    async def add_label_to_issue(
        self,
        *,
        cfg: dict[str, str] | None,
        issue_key: str,
        label: str,
    ) -> None:
        """Append a label to a Jira issue. Idempotent — uses the 'update' op to avoid duplicates."""
        base_url, email, api_token = self._resolve_config(cfg)
        key = str(issue_key or '').strip()
        label_value = str(label or '').strip()
        if not base_url or not key or not label_value:
            return

        url = f"{base_url.rstrip('/')}/rest/api/3/issue/{key}"
        payload = {'update': {'labels': [{'add': label_value}]}}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.put(url, json=payload, auth=(email, api_token))
            response.raise_for_status()

    @staticmethod
    def _format_comment_adf(text: str) -> dict:
        """Convert plain-text refinement comment to Jira ADF (Atlassian Document Format)."""
        content: list[dict] = []
        lines = text.split('\n')
        list_items: list[dict] = []

        def flush_list():
            nonlocal list_items
            if list_items:
                content.append({'type': 'bulletList', 'content': list_items})
                list_items = []

        for line in lines:
            stripped = line.strip()
            if not stripped:
                flush_list()
                continue
            elif stripped.startswith('📊') or stripped.startswith('🎯') or stripped.startswith('❓') or stripped.startswith('⚠️'):
                flush_list()
                content.append({
                    'type': 'heading', 'attrs': {'level': 3},
                    'content': [{'type': 'text', 'text': stripped}],
                })
            elif stripped.startswith('---'):
                flush_list()
                content.append({'type': 'rule'})
            elif stripped[0:1].isdigit() and '. ' in stripped[:4]:
                list_items.append({
                    'type': 'listItem',
                    'content': [{'type': 'paragraph', 'content': [{'type': 'text', 'text': stripped[stripped.index('. ') + 2:]}]}],
                })
            elif stripped.startswith('• ') or stripped.startswith('- '):
                list_items.append({
                    'type': 'listItem',
                    'content': [{'type': 'paragraph', 'content': [{'type': 'text', 'text': stripped[2:]}]}],
                })
            else:
                flush_list()
                content.append({
                    'type': 'paragraph',
                    'content': [{'type': 'text', 'text': stripped}],
                })

        flush_list()
        if not content:
            content.append({'type': 'paragraph', 'content': [{'type': 'text', 'text': text}]})
        return {'type': 'doc', 'version': 1, 'content': content}

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
        # Jira sprint lives in a customfield_NNNNN; we don't know the exact id
        # across instances, so scan values for an array of sprint-shaped objects
        # and pick the most recent/active one.
        sprint_name: str | None = None
        sprint_id: str | None = None
        for fk, fv in (fields or {}).items():
            if not isinstance(fk, str) or not fk.startswith('customfield_'):
                continue
            if isinstance(fv, list) and fv and isinstance(fv[0], dict) and fv[0].get('name') and ('state' in fv[0] or 'boardId' in fv[0]):
                # pick active sprint if any, else last (most recent) entry
                active = next((s for s in fv if isinstance(s, dict) and str(s.get('state', '')).lower() == 'active'), None)
                closed = [s for s in fv if isinstance(s, dict) and str(s.get('state', '')).lower() == 'closed']
                picked = active or (closed[-1] if closed else fv[-1] if isinstance(fv[-1], dict) else None)
                if picked:
                    sprint_name = picked.get('name')
                    sprint_id = str(picked.get('id')) if picked.get('id') is not None else None
                break
        return ExternalTask(
            id=issue.get('key', '') or issue.get('id', ''),
            title=fields.get('summary', ''),
            description=self._parse_jira_description(fields.get('description')),
            source='jira',
            state=((fields.get('status') or {}).get('name') if isinstance(fields.get('status'), dict) else None),
            assigned_to=((fields.get('assignee') or {}).get('displayName') if isinstance(fields.get('assignee'), dict) else None),
            created_date=fields.get('created'),
            closed_date=fields.get('resolutiondate'),
            story_points=story_points,
            sprint_id=sprint_id,
            sprint_name=sprint_name,
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
