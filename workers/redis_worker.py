from __future__ import annotations

import asyncio
import logging

from core.database import SessionLocal
from core.logging import configure_logging
from core.settings import get_settings
from db import models  # noqa: F401
from services.orchestration_service import OrchestrationService
from services.queue_service import QueueService

configure_logging()
logger = logging.getLogger(__name__)
settings = get_settings()


async def _run_single_task(payload: dict) -> None:
    organization_id = int(payload.get('organization_id', 0) or 0)
    task_id = int(payload.get('task_id', 0) or 0)
    create_pr = bool(payload.get('create_pr', True))

    if organization_id <= 0 or task_id <= 0:
        logger.error('Invalid queue payload: %s', payload)
        return

    async with SessionLocal() as session:
        service = OrchestrationService(db_session=session)
        await service.run_task_record(
            organization_id=organization_id,
            task_id=task_id,
            create_pr=create_pr,
        )


async def process_queue() -> None:
    queue_service = QueueService()
    max_workers = max(1, settings.max_workers)
    active_tasks: set[asyncio.Task] = set()

    while True:
        queue_size = await queue_service.queue_size()
        desired_concurrency = min(max_workers, max(1, queue_size))

        while len(active_tasks) < desired_concurrency:
            payload = await queue_service.dequeue(timeout=1)
            if not payload:
                break

            task = asyncio.create_task(_run_safe(payload))
            active_tasks.add(task)
            task.add_done_callback(active_tasks.discard)

        if not active_tasks:
            await asyncio.sleep(1)
            continue

        await asyncio.sleep(0.2)


async def _run_safe(payload: dict) -> None:
    try:
        await _run_single_task(payload)
    except Exception:
        logger.exception('Worker failed payload=%s', payload)


if __name__ == '__main__':
    asyncio.run(process_queue())
