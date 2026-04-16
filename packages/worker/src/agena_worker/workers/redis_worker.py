from __future__ import annotations

import agena_core.http  # noqa: F401 – apply SSL patch before any httpx clients are created
import asyncio
import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select

from agena_core.database import SessionLocal
from agena_core.logging import configure_logging
from agena_core.observability import init_sentry
from agena_core.settings import get_settings
from agena_models.models.task_record import TaskRecord
import agena_models.models  # noqa: F401 -- register all ORM models
from agena_services.services.event_bus import publish_fire_and_forget
from agena_services.services.orchestration_service import OrchestrationService
from agena_services.services.queue_service import QueueService
from agena_services.services.task_service import TaskService

configure_logging()
logger = logging.getLogger(__name__)
settings = get_settings()
init_sentry('worker')


def _lock_retry_delay_seconds(retry_count: int) -> int:
    # 1,2,4,8,16,30,... seconds
    return min(30, max(1, 2 ** min(max(0, retry_count), 5)))


def _is_transient_failure(message: str) -> bool:
    lowered = (message or '').lower()
    transient_markers = (
        'attempt to read property "value" on null',
        "cannot read properties of null",
        "cannot read property 'value' of null",
        'network error',
        'connection reset',
        'temporarily unavailable',
        'timeout',
    )
    return any(marker in lowered for marker in transient_markers)


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


async def _poll_newrelic_auto_imports() -> None:
    """Check for NR entity mappings with auto_import=True that are due for polling."""
    from agena_models.models.newrelic_entity_mapping import NewRelicEntityMapping

    async with SessionLocal() as session:
        now = datetime.utcnow()
        stmt = select(NewRelicEntityMapping).where(
            NewRelicEntityMapping.auto_import.is_(True),
            NewRelicEntityMapping.is_active.is_(True),
        )
        mappings = list((await session.execute(stmt)).scalars().all())
        if not mappings:
            return

        task_service = TaskService(session)
        for mapping in mappings:
            if mapping.last_import_at:
                next_due = mapping.last_import_at + timedelta(minutes=mapping.import_interval_minutes)
                if now < next_due:
                    continue

            try:
                imported, skipped = await task_service.import_from_newrelic(
                    mapping.organization_id,
                    user_id=0,
                    entity_guid=mapping.entity_guid,
                    since=f'{mapping.import_interval_minutes} minutes ago',
                )
                mapping.last_import_at = now
                await session.commit()
                if imported > 0:
                    logger.info(
                        'NR auto-import org=%s entity=%s imported=%s skipped=%s',
                        mapping.organization_id, mapping.entity_name, imported, skipped,
                    )
            except Exception:
                logger.exception('NR auto-import failed for entity %s', mapping.entity_guid)


async def _poll_sentry_auto_imports() -> None:
    """Check for Sentry project mappings with auto_import=True that are due for polling."""
    from agena_models.models.sentry_project_mapping import SentryProjectMapping

    async with SessionLocal() as session:
        now = datetime.utcnow()
        stmt = select(SentryProjectMapping).where(
            SentryProjectMapping.auto_import.is_(True),
            SentryProjectMapping.is_active.is_(True),
        )
        mappings = list((await session.execute(stmt)).scalars().all())
        if not mappings:
            return

        task_service = TaskService(session)

        # Find first admin user per org for auto-import (user_id=0 causes FK error)
        from agena_models.models.organization_member import OrganizationMember
        org_admin_cache: dict[int, int] = {}

        for mapping in mappings:
            if mapping.last_import_at:
                next_due = mapping.last_import_at + timedelta(minutes=mapping.import_interval_minutes)
                if now < next_due:
                    continue

            org_id = mapping.organization_id
            if org_id not in org_admin_cache:
                admin_result = await session.execute(
                    select(OrganizationMember.user_id).where(OrganizationMember.organization_id == org_id).order_by(OrganizationMember.id).limit(1)
                )
                admin_row = admin_result.scalar_one_or_none()
                org_admin_cache[org_id] = admin_row or 1

            try:
                imported, skipped = await task_service.import_from_sentry(
                    org_id,
                    user_id=org_admin_cache[org_id],
                    project_slug=mapping.project_slug,
                    query='is:unresolved',
                    limit=50,
                )
                mapping.last_import_at = now
                await session.commit()
                if imported > 0:
                    logger.info(
                        'Sentry auto-import org=%s project=%s imported=%s skipped=%s',
                        mapping.organization_id, mapping.project_slug, imported, skipped,
                    )
            except Exception:
                logger.exception('Sentry auto-import failed for project %s', mapping.project_slug)


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


async def _update_multi_repo_task_status(session, task_id: int, organization_id: int) -> None:
    """Aggregate assignment statuses into the parent task status."""
    from agena_models.models.task_repo_assignment import TaskRepoAssignment
    rows = (await session.execute(
        select(TaskRepoAssignment).where(
            TaskRepoAssignment.task_id == task_id,
            TaskRepoAssignment.organization_id == organization_id,
        )
    )).scalars().all()
    if not rows:
        return

    statuses = [r.status for r in rows]
    task = await session.get(TaskRecord, task_id)
    if not task:
        return

    all_terminal = all(s in {'completed', 'failed'} for s in statuses)
    if not all_terminal:
        return

    all_completed = all(s == 'completed' for s in statuses)
    all_failed = all(s == 'failed' for s in statuses)

    if all_completed:
        task.status = 'completed'
    elif all_failed:
        task.status = 'failed'
        task.failure_reason = 'All repo assignments failed'
    else:
        task.status = 'completed'  # partial success is still completion
        task.failure_reason = f'{sum(1 for s in statuses if s == "failed")}/{len(statuses)} repo assignments failed'

    # Aggregate PR URLs
    pr_urls = [r.pr_url for r in rows if r.pr_url]
    if pr_urls:
        task.pr_url = pr_urls[0] if len(pr_urls) == 1 else ', '.join(pr_urls)
    await session.commit()

    publish_fire_and_forget(organization_id, 'task_status', {
        'task_id': task_id, 'status': task.status, 'title': task.title,
    })


async def _run_single_task(payload: dict) -> None:
    organization_id = int(payload.get('organization_id', 0) or 0)
    task_id = int(payload.get('task_id', 0) or 0)
    create_pr = bool(payload.get('create_pr', True))
    run_mode = str(payload.get('mode', 'flow'))
    agent_role = payload.get('agent_role') or None
    agent_model = payload.get('agent_model') or None
    agent_provider = payload.get('agent_provider') or None
    lock_retries = int(payload.get('lock_retries', 0) or 0)
    assignment_id = int(payload.get('assignment_id', 0) or 0) or None

    if organization_id <= 0 or task_id <= 0:
        logger.error('Invalid queue payload: %s', payload)
        return

    async with SessionLocal() as session:
        task_service = TaskService(session)
        task = await task_service.get_task(organization_id, task_id)
        if task is None:
            logger.warning('Task not found, skipping payload=%s', payload)
            return
        if not assignment_id and task.status in {'completed', 'failed', 'cancelled'}:
            logger.info('Skipping terminal task id=%s status=%s', task.id, task.status)
            return

        # Load assignment if multi-repo
        assignment = None
        assignment_mapping = None
        if assignment_id:
            from agena_models.models.task_repo_assignment import TaskRepoAssignment
            from agena_models.models.repo_mapping import RepoMapping
            assignment = await session.get(TaskRepoAssignment, assignment_id)
            if not assignment or assignment.task_id != task_id:
                logger.warning('Assignment %s not found for task %s', assignment_id, task_id)
                return
            if assignment.status in {'completed', 'failed'}:
                logger.info('Skipping terminal assignment id=%s', assignment_id)
                return
            assignment_mapping = await session.get(RepoMapping, assignment.repo_mapping_id)
            assignment.status = 'running'
            await session.commit()

        # Check dependencies before running (skip for multi-repo assignments)
        if not assignment_id:
            blockers = await task_service.get_dependency_blockers(organization_id, task_id)
            if blockers:
                blocker_str = ', '.join(f'#{b}' for b in blockers)
                logger.info('Task %s blocked by dependencies: %s — re-queuing', task_id, blocker_str)
                dep_delay = _lock_retry_delay_seconds(lock_retries)
                await task_service.add_log(
                    task.id,
                    organization_id,
                    'queued',
                    f'Blocked by dependencies: {blocker_str} (retry in ~{dep_delay}s)',
                )
                task.status = 'queued'
                await session.commit()
                # Re-queue with bounded backoff to avoid hot-looping.
                payload['lock_retries'] = lock_retries + 1
                queue_service = QueueService()
                await asyncio.sleep(dep_delay)
                await queue_service.enqueue(payload)
                return

        publish_fire_and_forget(organization_id, 'task_status', {
            'task_id': task_id, 'status': 'picked_up', 'title': task.title,
            **(({'assignment_id': assignment_id}) if assignment_id else {}),
        })

        # Determine lock scope
        lock_scope = None
        if assignment_mapping:
            lock_scope = assignment_mapping.local_repo_path or f"repo:{assignment_mapping.id}"
        else:
            for line in (task.description or '').splitlines():
                if line.lower().startswith('local repo path:'):
                    lock_scope = line.split(':', 1)[1].strip()
                    break
            if not lock_scope and 'external source:' in (task.description or '').lower():
                lock_scope = f"org:{organization_id}:external:{task.external_id or task.id}"

        queue_service = QueueService()
        lock_owner = f'task:{task_id}' if not assignment_id else f'assignment:{assignment_id}'
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
                # Keep waiting in queue instead of failing hard on lock contention.
                delay_sec = _lock_retry_delay_seconds(lock_retries)
                owner_hint = f' owner={current_owner}' if current_owner else ''
                await task_service.add_log(
                    task.id,
                    organization_id,
                    'queued',
                    f'Repo lock busy, re-queued (retry in ~{delay_sec}s){owner_hint}',
                )
                if assignment:
                    assignment.status = 'queued'
                    await session.commit()
                else:
                    task.status = 'queued'
                    await session.commit()
                payload['lock_retries'] = lock_retries + 1
                await asyncio.sleep(delay_sec)
                await queue_service.enqueue(payload)
                return

        # ── Flow mode: run visual flow instead of default pipeline ──
        if run_mode == 'flow_run':
            import json as _json
            from agena_services.services.flow_executor import run_flow
            flow_data = await queue_service.client.get(f'flow_def:{task_id}')
            if not flow_data:
                task.status = 'failed'
                task.failure_reason = 'Flow definition not found in Redis (expired or missing)'
                await session.commit()
                await task_service.add_log(task.id, organization_id, 'failed', task.failure_reason)
                return
            flow_info = _json.loads(flow_data)
            flow = flow_info['flow']
            flow_user_id = flow_info.get('user_id', task.created_by_user_id)
            await run_flow(
                flow=flow,
                task={
                    'id': task.id,
                    'title': task.title,
                    'description': task.description or '',
                    'source': task.source or 'internal',
                    'state': task.status,
                    'acceptance_criteria': task.acceptance_criteria,
                },
                user_id=flow_user_id,
                organization_id=organization_id,
                db=session,
            )
            await queue_service.client.delete(f'flow_def:{task_id}')
            return

        service = OrchestrationService(db_session=session)
        try:
            result = await service.run_task_record(
                organization_id=organization_id,
                task_id=task_id,
                create_pr=create_pr,
                mode=run_mode,
                agent_model=agent_model,
                agent_provider=agent_provider,
                assignment_id=assignment_id,
            )
            # Update assignment with results
            if assignment:
                assignment.status = 'completed'
                assignment.pr_url = task.pr_url
                assignment.branch_name = task.branch_name
                await session.commit()
                await _update_multi_repo_task_status(session, task_id, organization_id)
        except Exception:
            if assignment:
                assignment.status = 'failed'
                assignment.failure_reason = (task.failure_reason or 'Unknown error')[:500]
                await session.commit()
                await _update_multi_repo_task_status(session, task_id, organization_id)
            raise
        finally:
            if lock_key:
                await queue_service.release_lock(lock_key, lock_owner)


async def process_queue() -> None:
    queue_service = QueueService()
    max_workers = max(1, settings.max_workers)
    active_tasks: set[asyncio.Task] = set()
    last_health_check = 0.0
    last_nr_poll = 0.0
    last_sentry_poll = 0.0

    while True:
        now = asyncio.get_running_loop().time()
        if now - last_health_check >= 30:
            await _fail_stale_running_tasks()
            await _cleanup_stale_repo_locks()
            last_health_check = now

        if now - last_nr_poll >= 300:  # 5 minutes
            try:
                await _poll_newrelic_auto_imports()
            except Exception:
                logger.exception('NR auto-import poll failed')
            last_nr_poll = now

        if now - last_sentry_poll >= 300:  # 5 minutes
            try:
                await _poll_sentry_auto_imports()
            except Exception:
                logger.exception('Sentry auto-import poll failed')
            last_sentry_poll = now

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
    except Exception as exc:
        logger.exception('Worker failed payload=%s', payload)
        org_id = int(payload.get('organization_id', 0) or 0)
        t_id = int(payload.get('task_id', 0) or 0)
        assignment_id = int(payload.get('assignment_id', 0) or 0)
        if org_id > 0 and t_id > 0:
            reason = str(exc)[:500]
            auto_retry_attempt = int(payload.get('auto_retry_attempt', 0) or 0)
            if _is_transient_failure(reason) and auto_retry_attempt < 1:
                retry_payload = dict(payload)
                retry_payload['auto_retry_attempt'] = auto_retry_attempt + 1
                try:
                    async with SessionLocal() as session:
                        task_service = TaskService(session)
                        if assignment_id:
                            from agena_models.models.task_repo_assignment import TaskRepoAssignment
                            assignment = await session.get(TaskRepoAssignment, assignment_id)
                            if assignment and assignment.status != 'completed':
                                assignment.status = 'queued'
                                assignment.failure_reason = None
                        task = await session.get(TaskRecord, t_id)
                        if task and task.status != 'completed':
                            task.status = 'queued'
                            task.failure_reason = None
                        await session.commit()
                        await task_service.add_log(
                            t_id,
                            org_id,
                            'queued',
                            f'Auto-retry scheduled after transient error: {reason[:180]}',
                        )
                    await QueueService().enqueue(retry_payload)
                    publish_fire_and_forget(org_id, 'task_status', {
                        'task_id': t_id, 'status': 'queued', 'title': '',
                        'auto_retry': True,
                    })
                    return
                except Exception:
                    logger.exception('Failed to schedule transient auto-retry for task %s', t_id)
            try:
                async with SessionLocal() as session:
                    task = await session.get(TaskRecord, t_id)
                    if task and task.status != 'completed':
                        task.status = 'failed'
                        task.failure_reason = reason
                        await session.commit()
            except Exception:
                logger.exception('Failed to persist failure_reason for task %s', t_id)
            publish_fire_and_forget(org_id, 'task_status', {
                'task_id': t_id, 'status': 'failed', 'title': '',
                'failure_reason': reason,
            })


if __name__ == '__main__':
    asyncio.run(process_queue())
