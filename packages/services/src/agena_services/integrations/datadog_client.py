"""Datadog APM Error Tracking client — fetches errors and creates tasks."""
from __future__ import annotations

import hashlib
import logging
from typing import Any

import httpx

from agena_models.schemas.task import ExternalTask

logger = logging.getLogger(__name__)


class DatadogClient:
    """Async client for Datadog Error Tracking + Events API."""

    def __init__(self) -> None:
        self.default_base_url = 'https://api.datadoghq.com'

    def _resolve(self, cfg: dict[str, str] | None) -> tuple[str, str, str]:
        cfg = cfg or {}
        base_url = (cfg.get('base_url') or self.default_base_url).strip().rstrip('/')
        api_key = (cfg.get('api_key') or '').strip()
        app_key = (cfg.get('app_key') or '').strip()
        return base_url, api_key, app_key

    def _headers(self, api_key: str, app_key: str) -> dict[str, str]:
        return {
            'DD-API-KEY': api_key,
            'DD-APPLICATION-KEY': app_key,
            'Content-Type': 'application/json',
        }

    async def list_error_tracking_issues(
        self,
        cfg: dict[str, str],
        *,
        query: str = 'status:open',
        sort: str = '-first_seen',
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Fetch error tracking issues from Datadog."""
        base_url, api_key, app_key = self._resolve(cfg)
        if not api_key or not app_key:
            logger.warning('Datadog keys not set; returning empty list.')
            return []

        url = f'{base_url}/api/v2/error-tracking/issues'
        params = {
            'filter[query]': query,
            'sort': sort,
            'page[limit]': str(min(limit, 100)),
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=self._headers(api_key, app_key), params=params)
            resp.raise_for_status()
            data = resp.json()
        return data.get('data', []) if isinstance(data, dict) else []

    async def get_issue_detail(
        self,
        cfg: dict[str, str],
        *,
        issue_id: str,
    ) -> dict[str, Any]:
        """Get detailed info for a specific error tracking issue."""
        base_url, api_key, app_key = self._resolve(cfg)
        if not api_key or not app_key:
            return {}

        url = f'{base_url}/api/v2/error-tracking/issues/{issue_id}'
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=self._headers(api_key, app_key))
            resp.raise_for_status()
            return resp.json().get('data', {}) if resp.content else {}

    async def list_events(
        self,
        cfg: dict[str, str],
        *,
        query: str = 'source:error_tracking',
        time_from: str = '-24h',
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Fetch events from Datadog Events API."""
        base_url, api_key, app_key = self._resolve(cfg)
        if not api_key or not app_key:
            return []

        import time
        now = int(time.time())
        # Parse relative time
        seconds = 86400  # default 24h
        if time_from.endswith('h'):
            try:
                seconds = int(time_from.replace('-', '').replace('h', '')) * 3600
            except ValueError:
                pass
        elif time_from.endswith('d'):
            try:
                seconds = int(time_from.replace('-', '').replace('d', '')) * 86400
            except ValueError:
                pass

        url = f'{base_url}/api/v1/events'
        params = {
            'start': str(now - seconds),
            'end': str(now),
            'sources': 'error_tracking',
            'limit': str(min(limit, 100)),
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=self._headers(api_key, app_key), params=params)
            resp.raise_for_status()
            data = resp.json()
        return data.get('events', []) if isinstance(data, dict) else []

    async def update_issue_status(
        self,
        cfg: dict[str, str],
        *,
        issue_id: str,
        status: str,
    ) -> dict[str, Any]:
        """Update error tracking issue status. status: 'open', 'resolved', 'ignored'."""
        base_url, api_key, app_key = self._resolve(cfg)
        if not api_key or not app_key:
            raise ValueError('Datadog keys not set')

        url = f'{base_url}/api/v2/error-tracking/issues/{issue_id}'
        payload = {
            'data': {
                'attributes': {'status': status},
                'id': issue_id,
                'type': 'error_tracking_issue',
            }
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.patch(url, headers=self._headers(api_key, app_key), json=payload)
            resp.raise_for_status()
            return resp.json() if resp.content else {}

    def issue_to_external_task(
        self,
        issue: dict[str, Any],
        *,
        service_name: str = '',
    ) -> ExternalTask | None:
        """Convert a Datadog error tracking issue to an ExternalTask."""
        issue_id = str(issue.get('id') or '').strip()
        if not issue_id:
            return None

        attrs = issue.get('attributes', {}) if isinstance(issue.get('attributes'), dict) else {}
        title_raw = attrs.get('title') or attrs.get('name') or 'Datadog error'
        error_type = attrs.get('type') or attrs.get('error_type') or ''
        status = attrs.get('status') or 'open'
        first_seen = attrs.get('first_seen') or ''
        last_seen = attrs.get('last_seen') or ''
        count = attrs.get('occurrences') or attrs.get('count') or 0
        user_count = attrs.get('impacted_users') or 0
        service = attrs.get('service') or service_name
        env = attrs.get('env') or ''
        stack_trace = attrs.get('stack_trace') or attrs.get('message') or ''

        # Extract file path from stack trace
        file_path = ''
        line_number = ''
        import re
        # Common patterns: "at file.py:123", "File "path.py", line 123"
        for pattern in [
            r'File "([^"]+)", line (\d+)',  # Python
            r'at (\S+\.(?:js|ts|jsx|tsx)):(\d+)',  # JS/TS
            r'in (/\S+\.php):?(\d+)',  # PHP
            r'(\S+\.(?:java|kt|go|rb|rs)):(\d+)',  # Java/Go/Ruby/Rust
        ]:
            m = re.search(pattern, stack_trace)
            if m:
                file_path = m.group(1)
                line_number = m.group(2)
                break

        title = f'[{service}] {title_raw}' if service else title_raw

        desc_lines = [
            f'External Source: Datadog #{issue_id}',
            f'Service: {service}' if service else None,
            f'Environment: {env}' if env else None,
            f'Error Type: {error_type}' if error_type else None,
            f'Status: {status}',
            f'Occurrences: {count}',
            f'Impacted Users: {user_count}' if user_count else None,
            f'First Seen: {first_seen}' if first_seen else None,
            f'Last Seen: {last_seen}' if last_seen else None,
        ]
        if file_path:
            desc_lines.append(f'File: {file_path}')
            if line_number:
                desc_lines.append(f'Line: {line_number}')
        if stack_trace:
            desc_lines.append('')
            desc_lines.append('Stack Trace:')
            desc_lines.append(stack_trace[:3000])

        # Derive priority from count
        if count >= 1000:
            priority = 'critical'
        elif count >= 100:
            priority = 'high'
        elif count >= 10:
            priority = 'medium'
        else:
            priority = 'low'

        desc_lines = [l for l in desc_lines if l is not None]

        fp = hashlib.sha256(f'datadog|{service}|{title_raw}'.encode()).hexdigest()[:24]

        return ExternalTask(
            id=fp,
            title=title[:512],
            description='\n'.join(desc_lines),
            source='datadog',
            state=status,
            priority=priority,
            created_date=None,
            web_url=f'https://app.datadoghq.com/error-tracking/issue/{issue_id}' if issue_id else None,
        )

    def issues_to_external_tasks(
        self,
        issues: list[dict[str, Any]],
        *,
        service_name: str = '',
    ) -> list[ExternalTask]:
        tasks: list[ExternalTask] = []
        for issue in issues:
            parsed = self.issue_to_external_task(issue, service_name=service_name)
            if parsed is not None:
                tasks.append(parsed)
        return tasks
