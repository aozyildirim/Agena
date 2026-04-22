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
from datetime import datetime
from typing import Any, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from agena_agents.memory.qdrant import QdrantMemoryStore
from agena_models.schemas.task import ExternalTask
from agena_services.integrations.azure_client import AzureDevOpsClient
from agena_services.services.integration_config_service import IntegrationConfigService

logger = logging.getLogger(__name__)

# In-memory job tracker keyed by organization_id. Survives for the lifetime
# of the backend process; fine for a one-shot manual backfill. Multi-worker
# prod would need Redis; we accept that limitation for now.
_BACKFILL_JOBS: dict[int, dict[str, Any]] = {}


def get_backfill_job(organization_id: int) -> dict[str, Any] | None:
    """Return current/last backfill job state for an org, or None if never run."""
    return _BACKFILL_JOBS.get(int(organization_id))


def _mark_job(organization_id: int, **patch: Any) -> None:
    job = _BACKFILL_JOBS.setdefault(int(organization_id), {})
    job.update(patch)


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
        progress_cb: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        def _emit(**patch: Any) -> None:
            if progress_cb:
                try:
                    progress_cb(patch)
                except Exception:
                    pass

        if not self.memory.enabled:
            err = {'error': 'Qdrant memory is disabled (QDRANT_ENABLED=false).'}
            _emit(**err, status='failed')
            return {'indexed': 0, 'skipped_no_sp': 0, 'total_seen': 0, **err}

        src = (source or 'azure').strip().lower()
        if src != 'azure':
            err = {'error': f'Source {src!r} is not supported yet.'}
            _emit(**err, status='failed')
            return {'indexed': 0, 'skipped_no_sp': 0, 'total_seen': 0, **err}

        config = await self.integration_service.get_config(organization_id, 'azure')
        if config is None or not config.secret:
            err = {'error': 'Azure entegrasyonu ayarlı değil. Önce Azure DevOps integration\'ı bağla.'}
            _emit(**err, status='failed')
            return {'indexed': 0, 'skipped_no_sp': 0, 'total_seen': 0, **err}

        resolved_project = (project or config.project or '').strip()
        if not resolved_project:
            err = {'error': 'Azure project seçilmedi. Tercihlere proje ekle ya da istek gövdesinde belirt.'}
            _emit(**err, status='failed')
            return {'indexed': 0, 'skipped_no_sp': 0, 'total_seen': 0, **err}

        _emit(status='fetching', phase='azure_wiql', message=f'Azure DevOps\'tan tamamlanmış işler çekiliyor ({resolved_project})...')
        try:
            items = await self.azure_client.fetch_completed_work_items(
                {
                    'org_url': config.base_url,
                    'project': resolved_project,
                    'pat': config.secret,
                },
                since_days=since_days,
                max_items=max_items,
            )
        except Exception as exc:
            msg = f'Azure sorgulanamadı: {exc}'
            _emit(status='failed', error=msg)
            return {'indexed': 0, 'skipped_no_sp': 0, 'total_seen': 0, 'error': msg}

        total_seen = len(items)
        indexed = 0
        skipped_no_sp = 0

        _emit(status='indexing', phase='embedding', total=total_seen, indexed=0, skipped_no_sp=0,
              message=f'{total_seen} iş tarandı; SP\'si olanlar Qdrant\'a yazılıyor...')

        for idx, item in enumerate(items):
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
            # Emit progress every 10 items to avoid chatty updates
            if (idx + 1) % 10 == 0:
                _emit(indexed=indexed, skipped_no_sp=skipped_no_sp, processed=idx + 1)

        result = {
            'indexed': indexed,
            'skipped_no_sp': skipped_no_sp,
            'total_seen': total_seen,
            'source': src,
            'project': resolved_project,
            'since_days': since_days,
            'max_items': max_items,
        }
        _emit(status='completed', **result, message=f'Bitti: {indexed} iş indexlendi, {skipped_no_sp} SP yok diye atlandı.')
        return result

    @classmethod
    async def run_backfill_job(
        cls,
        db: AsyncSession,
        organization_id: int,
        *,
        source: str = 'azure',
        project: str | None = None,
        since_days: int | None = 365,
        max_items: int = 500,
    ) -> None:
        """Entry point used by the async background task: records progress into
        the module-level _BACKFILL_JOBS dict so the status endpoint can surface it."""
        _BACKFILL_JOBS[int(organization_id)] = {
            'status': 'queued',
            'started_at': datetime.utcnow().isoformat(),
            'indexed': 0,
            'skipped_no_sp': 0,
            'total': 0,
            'message': 'Hazırlanıyor...',
        }

        def _cb(patch: dict[str, Any]) -> None:
            _mark_job(organization_id, **patch)

        indexer = cls(db)
        try:
            await indexer.backfill(
                organization_id,
                source=source,
                project=project,
                since_days=since_days,
                max_items=max_items,
                progress_cb=_cb,
            )
        except Exception as exc:
            _mark_job(organization_id, status='failed', error=str(exc)[:400])
            logger.exception('Backfill job failed for org %s', organization_id)
        finally:
            _mark_job(organization_id, finished_at=datetime.utcnow().isoformat())

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
