from __future__ import annotations

import base64
import logging

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
            wiql_response = await client.post(wiql_url, headers=headers, json=wiql_payload)
            wiql_response.raise_for_status()
            work_item_refs = wiql_response.json().get('workItems', [])

            if not work_item_refs:
                return []

            ids = ','.join(str(item['id']) for item in work_item_refs)
            fields_param = (
                'System.Id,System.Title,System.Description,'
                'System.AssignedTo,System.CreatedDate,Microsoft.VSTS.Common.ActivatedDate'
            )
            details_url = (
                f"{org_url.rstrip('/')}/_apis/wit/workitems"
                f'?ids={ids}&fields={fields_param}&api-version=7.1-preview.3'
            )
            details_response = await client.get(details_url, headers=headers)
            details_response.raise_for_status()
            details_payload = details_response.json().get('value', [])

        tasks: list[ExternalTask] = []
        for item in details_payload:
            fields = item.get('fields', {})
            # AssignedTo can be a dict with displayName or a plain string
            assigned_raw = fields.get('System.AssignedTo')
            if isinstance(assigned_raw, dict):
                assigned_to = assigned_raw.get('displayName') or assigned_raw.get('uniqueName')
            else:
                assigned_to = assigned_raw or None
            tasks.append(
                ExternalTask(
                    id=str(fields.get('System.Id', item.get('id', ''))),
                    title=fields.get('System.Title', ''),
                    description=fields.get('System.Description', '') or '',
                    source='azure',
                    assigned_to=assigned_to,
                    created_date=fields.get('System.CreatedDate'),
                    activated_date=fields.get('Microsoft.VSTS.Common.ActivatedDate'),
                )
            )
        return tasks

    def _headers(self, pat: str) -> dict[str, str]:
        token = base64.b64encode(f':{pat}'.encode()).decode()
        return {'Authorization': f'Basic {token}', 'Content-Type': 'application/json'}

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
