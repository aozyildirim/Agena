from __future__ import annotations

import base64
import logging
from typing import Any

import httpx

from core.settings import get_settings
from schemas.task import ExternalTask

logger = logging.getLogger(__name__)


class AzureDevOpsClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def fetch_new_work_items(self, cfg: dict[str, str] | None = None) -> list[ExternalTask]:
        cfg = cfg or {}
        org_url = cfg.get('org_url') or self.settings.azure_org_url
        project = cfg.get('project') or self.settings.azure_project
        pat = cfg.get('pat') or self.settings.azure_pat
        team = cfg.get('team') or ''
        sprint = cfg.get('sprint_path') or ''
        state = cfg.get('state') or 'New'

        if not org_url or not project:
            logger.warning('Azure DevOps settings are incomplete; returning empty task list.')
            return []

        wiql_url = (
            f"{org_url.rstrip('/')}/{project}"
            '/_apis/wit/wiql?api-version=7.1-preview.2'
        )
        conditions = [f'[System.State] = "{state}"'] if state else []
        iteration_path = self._build_iteration_path(project=project, team=team, sprint=sprint)
        if iteration_path:
            conditions.append(f"[System.IterationPath] UNDER '{iteration_path}'")

        where_clause = ' And '.join(conditions) if conditions else '1 = 1'
        wiql_payload = {
            'query': (
                'Select [System.Id], [System.Title], [System.Description] '
                f'From WorkItems Where {where_clause} '
                'Order By [System.ChangedDate] Desc'
            )
        }

        headers = self._headers(pat)

        async with httpx.AsyncClient(timeout=30) as client:
            details_payload = await self._fetch_details_from_wiql(
                client=client,
                wiql_url=wiql_url,
                headers=headers,
                wiql_payload=wiql_payload,
                org_url=org_url,
                fields_param=(
                    'System.Id,System.Title,System.Description,'
                    'System.AssignedTo,System.CreatedDate,Microsoft.VSTS.Common.ActivatedDate'
                ),
            )
        return [self._to_external_task(item) for item in details_payload]

    async def fetch_sprint_work_items(self, cfg: dict[str, str] | None = None) -> list[ExternalTask]:
        cfg = cfg or {}
        org_url = cfg.get('org_url') or self.settings.azure_org_url
        project = cfg.get('project') or self.settings.azure_project
        pat = cfg.get('pat') or self.settings.azure_pat
        team = cfg.get('team') or ''
        sprint = cfg.get('sprint_path') or ''

        if not org_url or not project or not sprint:
            logger.warning('Azure sprint fetch skipped because org/project/sprint is incomplete.')
            return []

        wiql_url = (
            f"{org_url.rstrip('/')}/{project}"
            '/_apis/wit/wiql?api-version=7.1-preview.2'
        )
        iteration_path = self._build_iteration_path(project=project, team=team, sprint=sprint)
        wiql_payload = {
            'query': (
                'Select [System.Id], [System.Title], [System.State] '
                f"From WorkItems Where [System.IterationPath] UNDER '{iteration_path}' "
                'Order By [System.ChangedDate] Desc'
            )
        }
        headers = self._headers(pat)

        async with httpx.AsyncClient(timeout=40) as client:
            details_payload = await self._fetch_details_from_wiql(
                client=client,
                wiql_url=wiql_url,
                headers=headers,
                wiql_payload=wiql_payload,
                org_url=org_url,
                fields_param=(
                    'System.Id,System.Title,System.Description,System.State,'
                    'System.AssignedTo,System.CreatedDate,Microsoft.VSTS.Common.ActivatedDate,'
                    'System.WorkItemType,System.IterationPath,'
                    'Microsoft.VSTS.Scheduling.StoryPoints,Microsoft.VSTS.Scheduling.Effort,'
                    'Microsoft.VSTS.Scheduling.Size'
                ),
            )
        return [self._to_external_task(item) for item in details_payload]

    def _headers(self, pat: str) -> dict[str, str]:
        token = base64.b64encode(f':{pat}'.encode()).decode()
        return {'Authorization': f'Basic {token}', 'Content-Type': 'application/json'}

    async def _fetch_details_from_wiql(
        self,
        *,
        client: httpx.AsyncClient,
        wiql_url: str,
        headers: dict[str, str],
        wiql_payload: dict[str, Any],
        org_url: str,
        fields_param: str,
    ) -> list[dict[str, Any]]:
        wiql_response = await client.post(wiql_url, headers=headers, json=wiql_payload)
        wiql_response.raise_for_status()
        try:
            work_item_refs = wiql_response.json().get('workItems', [])
        except Exception:
            logger.error('Azure WIQL response is not valid JSON: %s', wiql_response.text[:200])
            return []

        if not work_item_refs:
            return []

        ids = [str(item['id']) for item in work_item_refs if item.get('id')]
        details_payload: list[dict[str, Any]] = []
        for start in range(0, len(ids), 200):
            batch_ids = ','.join(ids[start:start + 200])
            details_url = (
                f"{org_url.rstrip('/')}/_apis/wit/workitems"
                f'?ids={batch_ids}&fields={fields_param}&api-version=7.1-preview.3'
            )
            details_response = await client.get(details_url, headers=headers)
            details_response.raise_for_status()
            try:
                details_payload.extend(details_response.json().get('value', []))
            except Exception:
                logger.error('Azure work items response is not valid JSON: %s', details_response.text[:200])
                return []
        return details_payload

    def _to_external_task(self, item: dict[str, Any]) -> ExternalTask:
        fields = item.get('fields', {})
        assigned_raw = fields.get('System.AssignedTo')
        if isinstance(assigned_raw, dict):
            assigned_to = assigned_raw.get('displayName') or assigned_raw.get('uniqueName')
        else:
            assigned_to = assigned_raw or None

        story_points = self._coerce_float(
            fields.get('Microsoft.VSTS.Scheduling.StoryPoints'),
            fields.get('Microsoft.VSTS.Scheduling.Size'),
        )
        effort = self._coerce_float(fields.get('Microsoft.VSTS.Scheduling.Effort'))
        return ExternalTask(
            id=str(fields.get('System.Id', item.get('id', ''))),
            title=fields.get('System.Title', ''),
            description=fields.get('System.Description', '') or '',
            source='azure',
            state=fields.get('System.State'),
            assigned_to=assigned_to,
            created_date=fields.get('System.CreatedDate'),
            activated_date=fields.get('Microsoft.VSTS.Common.ActivatedDate'),
            story_points=story_points,
            effort=effort,
            work_item_type=fields.get('System.WorkItemType'),
            sprint_path=fields.get('System.IterationPath'),
            web_url=((item.get('_links') or {}).get('html') or {}).get('href'),
        )

    def _coerce_float(self, *values: Any) -> float | None:
        for value in values:
            if value in (None, ''):
                continue
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
        return None

    def _build_iteration_path(self, project: str, team: str, sprint: str) -> str:
        """
        Azure iteration path formatı: sprint listesinden gelen 'path' alanı
        zaten tam formattadır, örn: 'E-commerce Web Applications\\2026_06_Nankatsu'
        Bu değeri direkt kullan — project veya team ekleme.
        """
        if not sprint:
            return ''
        # Azure'dan gelen path zaten tam — backslash veya forward slash içeriyorsa direkt kullan
        if '\\' in sprint or '/' in sprint:
            return sprint.replace('/', '\\')
        # Sadece sprint adı geldiyse (eski fallback): team\sprint formatı
        if team:
            return f'{team}\\{sprint}'
        return sprint
