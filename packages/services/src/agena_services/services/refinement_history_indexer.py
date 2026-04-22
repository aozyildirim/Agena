"""Index completed work items into Qdrant so refinement can ground its SP
estimates on similar prior work.

Each indexed point carries payload:
    kind='completed_task', source='azure'|'jira', external_id, title,
    story_points, assigned_to, url, completed_at, state, work_item_type
The vector is computed from the title+description. Search at refinement time
filters by kind='completed_task' and organization_id.
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from agena_agents.memory.qdrant import QdrantMemoryStore
from agena_models.schemas.task import ExternalTask
from agena_services.integrations.azure_client import AzureDevOpsClient
from agena_services.services.integration_config_service import IntegrationConfigService

logger = logging.getLogger(__name__)


class RefinementHistoryIndexer:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.integration_service = IntegrationConfigService(db)
        self.azure_client = AzureDevOpsClient()
        self.memory = QdrantMemoryStore()

    async def backfill(
        self,
        organization_id: int,
        *,
        source: str = 'azure',
        project: str | None = None,
        since_days: int | None = 365,
        max_items: int = 500,
    ) -> dict[str, Any]:
        if not self.memory.enabled:
            return {
                'indexed': 0,
                'skipped_no_sp': 0,
                'total_seen': 0,
                'error': 'Qdrant memory is disabled (QDRANT_ENABLED=false).',
            }

        src = (source or 'azure').strip().lower()
        if src != 'azure':
            return {
                'indexed': 0,
                'skipped_no_sp': 0,
                'total_seen': 0,
                'error': f'Source {src!r} is not supported yet.',
            }

        config = await self.integration_service.get_config(organization_id, 'azure')
        if config is None or not config.secret:
            return {
                'indexed': 0,
                'skipped_no_sp': 0,
                'total_seen': 0,
                'error': 'Azure integration is not configured.',
            }

        resolved_project = (project or config.project or '').strip()
        if not resolved_project:
            return {
                'indexed': 0,
                'skipped_no_sp': 0,
                'total_seen': 0,
                'error': 'Azure project is not set.',
            }

        items = await self.azure_client.fetch_completed_work_items(
            {
                'org_url': config.base_url,
                'project': resolved_project,
                'pat': config.secret,
            },
            since_days=since_days,
            max_items=max_items,
        )

        total_seen = len(items)
        indexed = 0
        skipped_no_sp = 0

        for item in items:
            sp = self._pick_story_points(item)
            if sp is None or sp <= 0:
                skipped_no_sp += 1
                continue
            try:
                await self._index_one(item, organization_id=organization_id, story_points=sp)
                indexed += 1
            except Exception as exc:
                logger.warning(
                    'Failed to index Azure item %s for org %s: %s',
                    item.id, organization_id, exc,
                )

        return {
            'indexed': indexed,
            'skipped_no_sp': skipped_no_sp,
            'total_seen': total_seen,
            'source': src,
            'project': resolved_project,
            'since_days': since_days,
            'max_items': max_items,
        }

    async def _index_one(
        self,
        item: ExternalTask,
        *,
        organization_id: int,
        story_points: int,
    ) -> None:
        title = (item.title or '').strip()
        description = (item.description or '').strip()
        input_text = title if not description else f'{title}\n\n{description}'
        # Qdrant/OpenAI tolerate long text, but we cap to avoid embedding cost blow-ups.
        if len(input_text) > 6000:
            input_text = input_text[:6000]

        payload = {
            'kind': 'completed_task',
            'source': (item.source or 'azure'),
            'external_id': str(item.id or ''),
            'title': title[:300],
            'story_points': int(story_points),
            'assigned_to': item.assigned_to or '',
            'url': item.web_url or '',
            'state': item.state or '',
            'work_item_type': item.work_item_type or '',
            'completed_at': '',  # Azure ClosedDate not surfaced in ExternalTask; left blank.
        }
        key = f'completed:{payload["source"]}:{payload["external_id"]}'
        await self.memory.upsert_memory(
            key=key,
            input_text=input_text,
            output_text='',  # full context already in payload fields
            organization_id=organization_id,
            extra=payload,
        )

    @staticmethod
    def _pick_story_points(item: ExternalTask) -> int | None:
        value = item.story_points
        if value is None:
            return None
        try:
            rounded = int(round(float(value)))
        except (TypeError, ValueError):
            return None
        return rounded if rounded > 0 else None
