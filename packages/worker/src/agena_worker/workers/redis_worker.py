from __future__ import annotations

import agena_core.http  # noqa: F401 – apply SSL patch before any httpx clients are created
import asyncio
import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select

from agena_core.database import SessionLocal
from agena_core.logging import configure_logging
from agena_core.settings import get_settings
from agena_models.models.task_record import TaskRecord
from db import models  # noqa: F401
from agena_services.services.event_bus import publish_fire_and_forget
from agena_services.services.orchestration_service import OrchestrationService
from agena_services.services.queue_service import QueueService
from agena_services.services.task_service import TaskService

configure_logging()
logger = logging.getLogger(__name__)
settings = get_settings()


async def _fail_stale_running_tasks() -> None:
    timeout_min = max(1, settings.task_running_timeout_minutes)
    stale_before = datetime.utcnow() - timedelta(minutes=timeout_min)
    async with SessionLocal() as session:
        result = await session.execute(
            select(TaskRecord).where(
                TaskRecord.status == 'running',
                TaskRecord.updated_at < stale_before,
            )
        )
        stale_tasks = list(result.scalars().all())
        if not stale_tasks:
            return
        task_service = TaskService(session)
        for task in stale_tasks:
            task.status = 'failed'
            task.failure_reason = f'Task exceeded running timeout ({timeout_min} minutes)'
            await session.flush()
            await task_service.add_log(task.id, task.organization_id, 'failed', task.failure_reason)
        await session.commit()
        logger.warning('Marked %s stale running task(s) as failed', len(stale_tasks))


async def _cleanup_stale_repo_locks() -> None:
    """Best-effort cleanup for leaked repo locks from crashed/interrupted workers."""
    queue_service = QueueService()
    keys = await queue_service.client.keys('queue_lock:*')
    if not keys:
        return

    removed = 0
    async with SessionLocal() as session:
        for full_key in keys:
            lock_key = full_key.replace('queue_lock:', '', 1)
            owner = await queue_service.get_lock_owner(lock_key)
            if not owner:
                await queue_service.force_delete_lock(lock_key)
                removed += 1
                continue

            # We currently store lock owners as "task:<id>".
            if not owner.startswith('task:'):
                await queue_service.force_delete_lock(lock_key)
                removed += 1
                continue

            try:
                owner_task_id = int(owner.split(':', 1)[1])
            except Exception:
                await queue_service.force_delete_lock(lock_key)
                removed += 1
                continue

            owner_task = await session.get(TaskRecord, owner_task_id)
            if owner_task is None or owner_task.status != 'running':
                await queue_service.force_delete_lock(lock_key)
                removed += 1

    if removed > 0:
        logger.warning('Cleaned %s stale repo lock(s)', removed)


async def _run_single_task(payload: dict) -> None:
    organization_id = int(payload.get('organization_id', 0) or 0)
    task_id = int(payload.get('task_id', 0) or 0)
    create_pr = bool(payload.get('create_pr', True))
    run_mode = str(payload.get('mode', 'flow'))
    agent_role = payload.get('agent_role') or None
    agent_model = payload.get('agent_model') or None
    agent_provider = payload.get('agent_provider') or None
    lock_retries = int(payload.get('lock_retries', 0) or 0)

    if organization_id <= 0 or task_id <= 0:
        logger.error('Invalid queue payload: %s', payload)
        return

    async with SessionLocal() as session:
        task_service = TaskService(session)
        task = await task_service.get_task(organization_id, task_id)
        if task is None:
            logger.warning('Task not found, skipping payload=%s', payload)
            return
        if task.status in {'completed', 'failed', 'cancelled'}:
            logger.info('Skipping terminal task id=%s status=%s', task.id, task.status)
            return

        publish_fire_and_forget(organization_id, 'task_status', {
            'task_id': task_id, 'status': 'picked_up', 'title': task.title,
        })

        lock_scope = None
        for line in (task.description or '').splitlines():
            if line.lower().startswith('local repo path:'):
                lock_scope = line.split(':', 1)[1].strip()
                break
        if not lock_scope and 'external source:' in (task.description or '').lower():
            lock_scope = f"org:{organization_id}:external:{task.external_id or task.id}"

        queue_service = QueueService()
        lock_owner = f'task:{task_id}'
        lock_key = f'org:{organization_id}:{lock_scope}' if lock_scope else None
        if lock_key:
            acquired = await queue_service.acquire_lock(lock_key, lock_owner, ttl_sec=1800)
            if not acquired:
                current_owner = await queue_service.get_lock_owner(lock_key)
                stale_owner = False
                if current_owner and current_owner.startswith('task:'):
                    try:
                        owner_task_id = int(current_owner.split(':', 1)[1])
                    except Exception:
                        owner_task_id = 0
                    if owner_task_id > 0:
                        owner_task = await task_service.get_task(organization_id, owner_task_id)
                        if owner_task is None or owner_task.status in {'failed', 'completed', 'cancelled'}:
                            stale_owner = True
                elif not current_owner:
                    stale_owner = True

                if stale_owner:
                    await queue_service.force_delete_lock(lock_key)
                    acquired = await queue_service.acquire_lock(lock_key, lock_owner, ttl_sec=1800)

            if not acquired:
                if lock_retries >= settings.queue_lock_max_retries:
                    task.status = 'failed'
                    task.failure_reason = 'Repo lock busy for too long; task aborted after retries'
                    await session.commit()
                    await task_service.add_log(task.id, organization_id, 'failed', task.failure_reason)
                    publish_fire_and_forget(organization_id, 'task_status', {
                        'task_id': task_id, 'status': 'failed', 'title': task.title,
                    })
                    return
                await task_service.add_log(task.id, organization_id, 'queued', 'Repo lock busy, re-queued')
                task.status = 'queued'
                await session.commit()
                payload['lock_retries'] = lock_retries + 1
                await queue_service.enqueue(payload)
                return

        service = OrchestrationService(db_session=session)
        try:
            await service.run_task_record(
                organization_id=organization_id,
                task_id=task_id,
                create_pr=create_pr,
                mode=run_mode,
                agent_model=agent_model,
                agent_provider=agent_provider,
            )
        finally:
            if lock_key:
                await queue_service.release_lock(lock_key, lock_owner)


async def process_queue() -> None:
    queue_service = QueueService()
    max_workers = max(1, settings.max_workers)
    active_tasks: set[asyncio.Task] = set()
    last_health_check = 0.0

    while True:
        now = asyncio.get_running_loop().time()
        if now - last_health_check >= 30:
            await _fail_stale_running_tasks()
            await _cleanup_stale_repo_locks()
            last_health_check = now

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
        org_id = int(payload.get('organization_id', 0) or 0)
        t_id = int(payload.get('task_id', 0) or 0)
        if org_id > 0 and t_id > 0:
            publish_fire_and_forget(org_id, 'task_status', {
                'task_id': t_id, 'status': 'failed', 'title': '',
            })


if __name__ == '__main__':
    asyncio.run(process_queue())
