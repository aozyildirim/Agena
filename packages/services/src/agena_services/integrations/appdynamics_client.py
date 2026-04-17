"""AppDynamics APM client — fetches errors and health rule violations."""
from __future__ import annotations

import hashlib
import logging
from typing import Any

import httpx

from agena_models.schemas.task import ExternalTask

logger = logging.getLogger(__name__)


class AppDynamicsClient:
    """Async client for AppDynamics REST API."""

    def __init__(self) -> None:
        self.default_base_url = 'https://your-controller.saas.appdynamics.com'

    def _resolve(self, cfg: dict[str, str] | None) -> tuple[str, str, str]:
        cfg = cfg or {}
        base_url = (cfg.get('base_url') or self.default_base_url).strip().rstrip('/')
        token = (cfg.get('api_token') or '').strip()
        username = (cfg.get('username') or '').strip()
        return base_url, token, username

    def _headers(self, token: str, username: str = '') -> dict[str, str]:
        # AppDynamics uses Basic auth with username@account:access_key
        # or Bearer token for API clients
        if username:
            import base64
            creds = base64.b64encode(f'{username}:{token}'.encode()).decode()
            return {
                'Authorization': f'Basic {creds}',
                'Content-Type': 'application/json',
            }
        return {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        }

    async def list_applications(
        self,
        cfg: dict[str, str],
    ) -> list[dict[str, Any]]:
        """List all monitored applications."""
        base_url, token, username = self._resolve(cfg)
        if not token:
            return []
        url = f'{base_url}/controller/rest/applications?output=JSON'
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=self._headers(token, username))
            resp.raise_for_status()
            return resp.json() if isinstance(resp.json(), list) else []

    async def list_errors(
        self,
        cfg: dict[str, str],
        *,
        app_id: int | str,
        time_range: str = 'BEFORE_NOW',
        duration_minutes: int = 1440,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Fetch error snapshots for an application."""
        base_url, token, username = self._resolve(cfg)
        if not token:
            return []

        # Get business transactions with errors
        url = (
            f'{base_url}/controller/rest/applications/{app_id}'
            f'/request-snapshots?output=JSON'
            f'&time-range-type={time_range}'
            f'&duration-in-mins={duration_minutes}'
            f'&need-exit-calls=false'
            f'&need-props=false'
            f'&data-collector-type=ERROR'
            f'&maximum-results={limit}'
        )
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=self._headers(token, username))
            resp.raise_for_status()
            data = resp.json()
        return data if isinstance(data, list) else []

    async def list_health_violations(
        self,
        cfg: dict[str, str],
        *,
        app_id: int | str,
        time_range: str = 'BEFORE_NOW',
        duration_minutes: int = 1440,
    ) -> list[dict[str, Any]]:
        """Fetch health rule violations for an application."""
        base_url, token, username = self._resolve(cfg)
        if not token:
            return []

        url = (
            f'{base_url}/controller/rest/applications/{app_id}'
            f'/problems/healthrule-violations?output=JSON'
            f'&time-range-type={time_range}'
            f'&duration-in-mins={duration_minutes}'
        )
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=self._headers(token, username))
            resp.raise_for_status()
            data = resp.json()
        return data if isinstance(data, list) else []

    async def get_error_details(
        self,
        cfg: dict[str, str],
        *,
        app_id: int | str,
        request_guid: str,
    ) -> dict[str, Any]:
        """Get detailed error snapshot with stack trace."""
        base_url, token, username = self._resolve(cfg)
        if not token:
            return {}

        url = (
            f'{base_url}/controller/rest/applications/{app_id}'
            f'/request-snapshots/{request_guid}?output=JSON'
        )
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=self._headers(token, username))
            resp.raise_for_status()
            data = resp.json()
        return data if isinstance(data, dict) else (data[0] if isinstance(data, list) and data else {})

    def error_to_external_task(
        self,
        error: dict[str, Any],
        *,
        app_name: str = '',
    ) -> ExternalTask | None:
        """Convert AppDynamics error snapshot to ExternalTask."""
        error_id = str(error.get('requestGUID') or error.get('id') or '').strip()
        if not error_id:
            return None

        bt_name = error.get('businessTransactionName') or error.get('btName') or ''
        error_message = error.get('errorMessage') or error.get('summary') or 'AppDynamics error'
        error_detail = error.get('errorDetail') or ''
        url_path = error.get('URL') or error.get('url') or ''
        tier_name = error.get('applicationComponentName') or ''
        node_name = error.get('applicationComponentNodeName') or ''
        timestamp = error.get('serverStartTime') or error.get('startTime') or ''
        http_method = error.get('httpMethod') or ''

        # Stack trace from errorDetails or errorIDs
        stack_trace = ''
        error_ids = error.get('errorIDs') or error.get('errorDetails') or []
        if isinstance(error_ids, list) and error_ids:
            for eid in error_ids:
                if isinstance(eid, dict):
                    st = eid.get('stackTrace') or eid.get('value') or ''
                    if st:
                        stack_trace = str(st)[:3000]
                        break
                elif isinstance(eid, str):
                    stack_trace = eid[:3000]
                    break

        # Parse file path from stack trace
        import re
        file_path = ''
        line_number = ''
        for pattern in [
            r'at (\S+\.(?:java|kt)):(\d+)',
            r'File "([^"]+)", line (\d+)',
            r'in (/\S+\.php):?(\d+)',
            r'at (\S+\.(?:js|ts|py|go|rb)):(\d+)',
        ]:
            m = re.search(pattern, stack_trace)
            if m:
                file_path = m.group(1)
                line_number = m.group(2)
                break

        title = f'[{app_name}] {error_message[:200]}' if app_name else error_message[:200]

        desc_lines = [
            f'External Source: AppDynamics',
            f'Application: {app_name}' if app_name else None,
            f'Business Transaction: {bt_name}' if bt_name else None,
            f'Tier: {tier_name}' if tier_name else None,
            f'Node: {node_name}' if node_name else None,
            f'URL: {http_method} {url_path}'.strip() if url_path else None,
            f'Error: {error_message}',
        ]
        if file_path:
            desc_lines.append(f'File: {file_path}')
            if line_number:
                desc_lines.append(f'Line: {line_number}')
        if error_detail:
            desc_lines.append(f'Detail: {error_detail[:500]}')
        if stack_trace:
            desc_lines.append('')
            desc_lines.append('Stack Trace:')
            desc_lines.append(stack_trace)

        desc_lines = [l for l in desc_lines if l is not None]

        fp = hashlib.sha256(f'appdynamics|{app_name}|{bt_name}|{error_message}'.encode()).hexdigest()[:24]

        return ExternalTask(
            id=fp,
            title=title[:512],
            description='\n'.join(desc_lines),
            source='appdynamics',
            state='open',
            priority='high' if error.get('errorOccured') or error.get('hasErrors') else 'medium',
            created_date=None,
            web_url=None,
        )

    def errors_to_external_tasks(
        self,
        errors: list[dict[str, Any]],
        *,
        app_name: str = '',
    ) -> list[ExternalTask]:
        tasks: list[ExternalTask] = []
        for err in errors:
            parsed = self.error_to_external_task(err, app_name=app_name)
            if parsed is not None:
                tasks.append(parsed)
        return tasks
