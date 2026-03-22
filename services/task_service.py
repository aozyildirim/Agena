from __future__ import annotations

import json
import re
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.settings import get_settings
from integrations.azure_client import AzureDevOpsClient
from integrations.jira_client import JiraClient
from models.agent_log import AgentLog
from models.run_record import RunRecord
from models.task_dependency import TaskDependency
from models.task_record import TaskRecord
from models.user_preference import UserPreference
from schemas.task import ExternalTask
from services.integration_config_service import IntegrationConfigService
from services.notification_service import NotificationService
from services.queue_service import QueueService
from services.usage_service import UsageService


class TaskService:
    def __init__(self, db: AsyncSession | None = None) -> None:
        self.db = db
        self.settings = get_settings()
        self.jira_client = JiraClient()
        self.azure_client = AzureDevOpsClient()
        self.queue_service = QueueService()

    async def get_jira_tasks(self) -> list[ExternalTask]:
        return await self.jira_client.fetch_todo_issues()

    async def get_azure_tasks(self) -> list[ExternalTask]:
        return await self.azure_client.fetch_new_work_items()

    async def create_task(
        self,
        organization_id: int,
        user_id: int,
        title: str,
        description: str,
        story_context: str | None = None,
        acceptance_criteria: str | None = None,
        edge_cases: str | None = None,
        max_tokens: int | None = None,
        max_cost_usd: float | None = None,
    ) -> TaskRecord:
        if self.db is None:
            raise ValueError('DB session required')

        usage = UsageService(self.db)
        await usage.check_task_quota(organization_id)

        task = TaskRecord(
            organization_id=organization_id,
            created_by_user_id=user_id,
            source='internal',
            external_id='internal',
            title=title,
            description=description,
            story_context=(story_context or '').strip() or None,
            acceptance_criteria=(acceptance_criteria or '').strip() or None,
            edge_cases=(edge_cases or '').strip() or None,
            max_tokens=max(1, int(max_tokens)) if max_tokens is not None else None,
            max_cost_usd=max(0.0, float(max_cost_usd)) if max_cost_usd is not None else None,
            status='queued',
        )
        self.db.add(task)
        await self.db.commit()
        await self.db.refresh(task)
        await usage.increment_tasks(organization_id, 1)
        await self.add_log(task.id, organization_id, 'created', 'Task created')
        return task

    async def create_task_from_external(
        self,
        organization_id: int,
        user_id: int,
        source: str,
        external_id: str,
        title: str,
        description: str,
    ) -> TaskRecord:
        if self.db is None:
            raise ValueError('DB session required')

        usage = UsageService(self.db)
        await usage.check_task_quota(organization_id)

        exists_result = await self.db.execute(
            select(TaskRecord).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.source == source,
                TaskRecord.external_id == external_id,
            )
        )
        exists = exists_result.scalar_one_or_none()
        if exists:
            return exists

        task = TaskRecord(
            organization_id=organization_id,
            created_by_user_id=user_id,
            source=source,
            external_id=external_id,
            title=title,
            description=description or '',
            status='queued',
        )
        self.db.add(task)
        await self.db.commit()
        await self.db.refresh(task)
        await usage.increment_tasks(organization_id, 1)
        await self.add_log(task.id, organization_id, 'created', f'Imported from {source}')
        return task

    async def import_from_azure(
        self,
        organization_id: int,
        user_id: int,
        *,
        project: str | None = None,
        team: str | None = None,
        sprint_path: str | None = None,
        state: str | None = 'New',
    ) -> tuple[int, int]:
        if self.db is None:
            raise ValueError('DB session required')

        config_service = IntegrationConfigService(self.db)
        config = await config_service.get_config(organization_id, 'azure')
        if config is None:
            raise ValueError('Azure integration not configured for this organization')

        external_items = await self.azure_client.fetch_new_work_items(
            {
                'org_url': config.base_url,
                'project': project or config.project or '',
                'pat': config.secret,
                'team': team or '',
                'sprint_path': sprint_path or '',
                'state': state or '',
            }
        )
        imported = 0
        skipped = 0

        for item in external_items:
            try:
                before = await self.db.execute(
                    select(TaskRecord.id).where(
                        TaskRecord.organization_id == organization_id,
                        TaskRecord.source == 'azure',
                        TaskRecord.external_id == item.id,
                    )
                )
                if before.scalar_one_or_none() is not None:
                    skipped += 1
                    continue

                await self.create_task_from_external(
                    organization_id=organization_id,
                    user_id=user_id,
                    source='azure',
                    external_id=item.id,
                    title=item.title,
                    description=item.description,
                )
                imported += 1
            except PermissionError:
                break

        return imported, skipped

    async def import_from_jira(self, organization_id: int, user_id: int) -> tuple[int, int]:
        if self.db is None:
            raise ValueError('DB session required')

        config_service = IntegrationConfigService(self.db)
        config = await config_service.get_config(organization_id, 'jira')
        if config is None:
            raise ValueError('Jira integration not configured for this organization')

        external_items = await self.jira_client.fetch_todo_issues(
            {
                'base_url': config.base_url,
                'email': config.username or '',
                'api_token': config.secret,
            }
        )
        imported = 0
        skipped = 0

        for item in external_items:
            try:
                before = await self.db.execute(
                    select(TaskRecord.id).where(
                        TaskRecord.organization_id == organization_id,
                        TaskRecord.source == 'jira',
                        TaskRecord.external_id == item.id,
                    )
                )
                if before.scalar_one_or_none() is not None:
                    skipped += 1
                    continue

                await self.create_task_from_external(
                    organization_id=organization_id,
                    user_id=user_id,
                    source='jira',
                    external_id=item.id,
                    title=item.title,
                    description=item.description,
                )
                imported += 1
            except PermissionError:
                break

        return imported, skipped

    async def list_tasks(self, organization_id: int) -> list[TaskRecord]:
        if self.db is None:
            raise ValueError('DB session required')
        result = await self.db.execute(
            select(TaskRecord)
            .where(TaskRecord.organization_id == organization_id)
            .order_by(TaskRecord.created_at.desc())
        )
        return list(result.scalars().all())

    async def search_tasks(
        self,
        organization_id: int,
        *,
        status: str | None = None,
        q: str | None = None,
        created_from: datetime | None = None,
        created_to: datetime | None = None,
        page: int = 1,
        page_size: int = 12,
    ) -> tuple[list[TaskRecord], int]:
        if self.db is None:
            raise ValueError('DB session required')

        page = max(1, int(page))
        page_size = max(1, min(int(page_size), 100))

        filters = [TaskRecord.organization_id == organization_id]
        if status and status != 'all':
            filters.append(TaskRecord.status == status)
        if q:
            needle = f'%{q.strip()}%'
            if needle != '%%':
                filters.append(TaskRecord.title.ilike(needle))
        if created_from is not None:
            filters.append(TaskRecord.created_at >= created_from)
        if created_to is not None:
            filters.append(TaskRecord.created_at <= created_to)

        total_stmt = select(func.count(TaskRecord.id)).where(*filters)
        total_result = await self.db.execute(total_stmt)
        total = int(total_result.scalar_one() or 0)

        stmt = (
            select(TaskRecord)
            .where(*filters)
            .order_by(TaskRecord.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all()), total

    async def get_task(self, organization_id: int, task_id: int) -> TaskRecord | None:
        if self.db is None:
            raise ValueError('DB session required')
        result = await self.db.execute(
            select(TaskRecord).where(TaskRecord.id == task_id, TaskRecord.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def list_queue_tasks(self, organization_id: int) -> list[dict]:
        if self.db is None:
            raise ValueError('DB session required')

        payloads = await self.queue_service.list_payloads()
        # Build tenant-scoped Redis queue positions (1 = next item to start).
        org_entries: list[dict] = []
        for idx, payload in enumerate(payloads):
            if int(payload.get('organization_id', 0) or 0) != organization_id:
                continue
            task_id = int(payload.get('task_id', 0) or 0)
            if task_id <= 0:
                continue
            org_entries.append({'task_id': task_id, 'create_pr': bool(payload.get('create_pr', True))})

        redis_items: dict[int, dict] = {}
        org_total = len(org_entries)
        for idx, item in enumerate(org_entries):
            # lpush + brpop FIFO: right-most is next, so position starts from 1.
            position = org_total - idx
            redis_items[item['task_id']] = {
                'task_id': item['task_id'],
                'position': position,
                'create_pr': item['create_pr'],
            }

        result_queued = await self.db.execute(
            select(TaskRecord).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.status == 'queued',
            )
        )
        queued_tasks = list(result_queued.scalars().all())

        ids = [i['task_id'] for i in redis_items.values()]
        result = await self.db.execute(
            select(TaskRecord).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.id.in_(ids),
            )
        )
        redis_tasks = {t.id: t for t in result.scalars().all()}

        out_by_task: dict[int, dict] = {}
        for task in queued_tasks:
            redis_item = redis_items.get(task.id)
            out_by_task[task.id] = {
                'task_id': task.id,
                'title': task.title,
                'status': task.status,
                'position': redis_item['position'] if redis_item else 0,
                'create_pr': redis_item['create_pr'] if redis_item else True,
                'source': task.source,
                'created_at': task.created_at,
            }

        # Also include Redis items whose DB status is not queued yet (transient state).
        for task_id, redis_item in redis_items.items():
            if task_id in out_by_task:
                continue
            task = redis_tasks.get(task_id)
            if task is None:
                continue
            out_by_task[task_id] = {
                'task_id': task.id,
                'title': task.title,
                'status': task.status,
                'position': redis_item['position'],
                'create_pr': redis_item['create_pr'],
                'source': task.source,
                'created_at': task.created_at,
            }

        out = list(out_by_task.values())
        next_virtual_position = org_total + 1
        for item in out:
            if item['position'] <= 0:
                item['position'] = next_virtual_position
                next_virtual_position += 1
        out.sort(key=lambda x: (x['position'], x['created_at']))
        return out

    async def assign_task_to_ai(self, organization_id: int, task_id: int, create_pr: bool = True) -> str:
        if self.db is None:
            raise ValueError('DB session required')

        task = await self.get_task(organization_id, task_id)
        if task is None:
            raise ValueError('Task not found')
        if task.status == 'cancelled':
            raise ValueError('Task is cancelled')
        if task.status == 'running':
            raise ValueError('Task is already running')
        blockers = await self.get_dependency_blockers(organization_id, task.id)
        if blockers:
            blocker_ids = ', '.join(str(b) for b in blockers)
            raise ValueError(f'Task is blocked by dependencies: {blocker_ids}')

        local_repo_path = self._extract_local_repo_path(task.description)
        if local_repo_path:
            conflict = await self.db.execute(
                select(TaskRecord.id, TaskRecord.title)
                .where(
                    TaskRecord.organization_id == organization_id,
                    TaskRecord.id != task.id,
                    TaskRecord.status.in_(['queued', 'running']),
                    TaskRecord.description.like(f'%Local Repo Path: {local_repo_path}%'),
                )
                .order_by(TaskRecord.id.desc())
                .limit(1)
            )
            conflict_row = conflict.first()
            if conflict_row is not None:
                raise ValueError(f'Another active task is already running for this repo: #{conflict_row.id} {conflict_row.title}')

        # Legacy guard: external tasks without mapping should not auto-open PRs.
        # If mapping metadata exists, orchestration decides provider-specific PR flow.
        has_local_mapping = 'Local Repo Path:' in (task.description or '')
        if task.source != 'internal' and not has_local_mapping:
            create_pr = False

        was_queued = task.status == 'queued'
        was_terminal = task.status in {'failed', 'completed'}
        if was_queued:
            await self.queue_service.remove_task(
                organization_id=organization_id,
                task_id=task.id,
            )

        queue_key = await self.queue_service.enqueue(
            {
                'organization_id': organization_id,
                'task_id': task.id,
                'create_pr': create_pr,
            }
        )
        task.status = 'queued'
        task.failure_reason = None
        await self.db.commit()
        if was_queued or was_terminal:
            await self.add_log(task.id, organization_id, 'queued', 'Task re-queued for AI processing')
        else:
            await self.add_log(task.id, organization_id, 'queued', 'Task queued for AI processing')

        notifier = NotificationService(self.db)
        await notifier.notify_event(
            organization_id=organization_id,
            user_id=task.created_by_user_id,
            event_type='task_queued',
            title=f'Task #{task.id} queued',
            message=task.title,
            severity='info',
            task_id=task.id,
            payload={'create_pr': create_pr},
        )

        payloads = await self.queue_service.list_payloads()
        org_queued = sum(1 for p in payloads if int(p.get('organization_id', 0) or 0) == organization_id)
        warn_threshold = 5
        pref_result = await self.db.execute(select(UserPreference).where(UserPreference.user_id == task.created_by_user_id))
        pref = pref_result.scalar_one_or_none()
        if pref is not None and pref.profile_settings_json:
            try:
                settings = json.loads(pref.profile_settings_json)
                if isinstance(settings, dict):
                    raw = settings.get('queue_warn_threshold')
                    if isinstance(raw, int) and raw > 0:
                        warn_threshold = raw
            except Exception:
                pass
        if org_queued >= warn_threshold:
            await notifier.notify_event(
                organization_id=organization_id,
                user_id=task.created_by_user_id,
                event_type='queue_backlog_warning',
                title='Queue backlog warning',
                message=f'{org_queued} tasks are waiting in queue.',
                severity='warning',
                task_id=task.id,
                payload={'queued_count': org_queued},
            )
        return queue_key

    async def cancel_task(self, organization_id: int, task_id: int) -> TaskRecord:
        if self.db is None:
            raise ValueError('DB session required')
        task = await self.get_task(organization_id, task_id)
        if task is None:
            raise ValueError('Task not found')
        if task.status in {'completed', 'failed', 'cancelled'}:
            return task

        removed = await self.queue_service.remove_task(organization_id=organization_id, task_id=task.id)
        task.status = 'cancelled'
        task.failure_reason = 'Cancelled by user'
        await self.db.commit()
        await self.add_log(
            task.id,
            organization_id,
            'cancelled',
            'Task cancelled by user' + (f' (removed {removed} queued entry)' if removed > 0 else ''),
        )
        return task

    async def add_log(self, task_id: int, organization_id: int, stage: str, message: str) -> AgentLog:
        if self.db is None:
            raise ValueError('DB session required')
        item = AgentLog(task_id=task_id, organization_id=organization_id, stage=stage, message=message)
        self.db.add(item)
        await self.db.commit()
        await self.db.refresh(item)
        return item

    async def get_logs(self, organization_id: int, task_id: int) -> list[AgentLog]:
        if self.db is None:
            raise ValueError('DB session required')

        result = await self.db.execute(
            select(AgentLog)
            .where(AgentLog.organization_id == organization_id, AgentLog.task_id == task_id)
            .order_by(AgentLog.created_at.asc())
        )
        return list(result.scalars().all())

    async def get_task_metrics(self, organization_id: int, task_id: int) -> tuple[float | None, int | None]:
        if self.db is None:
            raise ValueError('DB session required')

        run_result = await self.db.execute(
            select(RunRecord)
            .where(RunRecord.organization_id == organization_id, RunRecord.task_id == task_id)
            .order_by(RunRecord.created_at.desc())
            .limit(1)
        )
        run = run_result.scalar_one_or_none()
        total_tokens = int(run.usage_total_tokens) if run is not None and run.usage_total_tokens is not None else None
        if total_tokens is not None and total_tokens <= 0:
            total_tokens = None

        metrics_result = await self.db.execute(
            select(AgentLog)
            .where(
                AgentLog.organization_id == organization_id,
                AgentLog.task_id == task_id,
                AgentLog.stage == 'run_metrics',
            )
            .order_by(AgentLog.created_at.desc())
            .limit(1)
        )
        metrics_log = metrics_result.scalar_one_or_none()
        duration = self._extract_duration(metrics_log.message) if metrics_log is not None else None
        return duration, total_tokens

    async def get_task_insights(self, organization_id: int, task: TaskRecord) -> dict:
        duration_sec, total_tokens = await self.get_task_metrics(organization_id, task.id)
        logs = await self.get_logs(organization_id, task.id)
        created_at = task.created_at
        running_at = next((l.created_at for l in logs if l.stage == 'running'), None)

        queue_wait_sec: int | None = None
        if created_at and running_at:
            queue_wait_sec = max(0, int((running_at - created_at).total_seconds()))
        elif created_at and task.status == 'queued':
            queue_wait_sec = max(0, int((datetime.utcnow() - created_at).total_seconds()))

        run_duration_sec = duration_sec
        if run_duration_sec is None and running_at and task.status == 'running':
            run_duration_sec = max(0.0, (datetime.utcnow() - running_at).total_seconds())

        retry_count = sum(
            1
            for l in logs
            if l.stage == 'queued' and ('re-queued' in (l.message or '').lower() or 'requeued' in (l.message or '').lower())
        )

        local_repo_path = self._extract_local_repo_path(task.description)
        lock_scope = local_repo_path
        if not lock_scope and 'external source:' in (task.description or '').lower():
            lock_scope = f'org:{organization_id}:external:{task.external_id or task.id}'

        queue_position: int | None = None
        estimated_start_sec: int | None = None
        if task.status == 'queued':
            queue_position = await self.queue_service.get_task_position(organization_id=organization_id, task_id=task.id)
            avg_run_sec = await self._get_recent_average_duration_sec(organization_id)
            workers = max(1, int(self.settings.max_workers))
            if queue_position is not None:
                estimated_start_sec = max(0, int(((queue_position - 1) / workers) * avg_run_sec))

        blocked_by_task_id: int | None = None
        blocked_by_task_title: str | None = None
        if local_repo_path and task.status in {'queued', 'running'}:
            blocker = await self._find_repo_blocker(organization_id, task.id, local_repo_path)
            if blocker is not None:
                blocked_by_task_id = blocker.id
                blocked_by_task_title = blocker.title

        dependency_blockers = await self.get_dependency_blockers(organization_id, task.id)
        dependent_task_ids = await self.get_dependents(organization_id, task.id)
        pr_risk = self._compute_pr_risk(logs)

        return {
            'duration_sec': duration_sec,
            'run_duration_sec': run_duration_sec,
            'queue_wait_sec': queue_wait_sec,
            'retry_count': retry_count,
            'queue_position': queue_position,
            'estimated_start_sec': estimated_start_sec,
            'lock_scope': lock_scope,
            'blocked_by_task_id': blocked_by_task_id,
            'blocked_by_task_title': blocked_by_task_title,
            'dependency_blockers': dependency_blockers,
            'dependent_task_ids': dependent_task_ids,
            'pr_risk_score': pr_risk['score'],
            'pr_risk_level': pr_risk['level'],
            'pr_risk_reason': pr_risk['reason'],
            'total_tokens': total_tokens,
        }

    async def get_dependencies(self, organization_id: int, task_id: int) -> list[int]:
        if self.db is None:
            raise ValueError('DB session required')
        result = await self.db.execute(
            select(TaskDependency.depends_on_task_id).where(
                TaskDependency.organization_id == organization_id,
                TaskDependency.task_id == task_id,
            )
        )
        return [int(v) for v in result.scalars().all()]

    async def get_dependents(self, organization_id: int, task_id: int) -> list[int]:
        if self.db is None:
            raise ValueError('DB session required')
        result = await self.db.execute(
            select(TaskDependency.task_id).where(
                TaskDependency.organization_id == organization_id,
                TaskDependency.depends_on_task_id == task_id,
            )
        )
        return [int(v) for v in result.scalars().all()]

    async def get_dependency_blockers(self, organization_id: int, task_id: int) -> list[int]:
        if self.db is None:
            raise ValueError('DB session required')
        deps = await self.get_dependencies(organization_id, task_id)
        if not deps:
            return []
        result = await self.db.execute(
            select(TaskRecord.id, TaskRecord.status).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.id.in_(deps),
            )
        )
        blockers: list[int] = []
        for item_id, status in result.all():
            if status != 'completed':
                blockers.append(int(item_id))
        blockers.sort()
        return blockers

    async def set_dependencies(self, organization_id: int, task_id: int, depends_on_task_ids: list[int]) -> list[int]:
        if self.db is None:
            raise ValueError('DB session required')
        task = await self.get_task(organization_id, task_id)
        if task is None:
            raise ValueError('Task not found')

        unique_ids: list[int] = sorted({int(i) for i in depends_on_task_ids if int(i) > 0})
        if task_id in unique_ids:
            raise ValueError('Task cannot depend on itself')

        if unique_ids:
            exists_result = await self.db.execute(
                select(TaskRecord.id).where(
                    TaskRecord.organization_id == organization_id,
                    TaskRecord.id.in_(unique_ids),
                )
            )
            existing_ids = {int(v) for v in exists_result.scalars().all()}
            missing = [i for i in unique_ids if i not in existing_ids]
            if missing:
                raise ValueError(f'Dependency task(s) not found: {", ".join(str(m) for m in missing)}')

            for dep_id in unique_ids:
                if await self._would_create_cycle(organization_id, task_id=task_id, depends_on_task_id=dep_id):
                    raise ValueError(f'Dependency cycle detected with task {dep_id}')

        await self.db.execute(
            TaskDependency.__table__.delete().where(
                TaskDependency.organization_id == organization_id,
                TaskDependency.task_id == task_id,
            )
        )
        for dep_id in unique_ids:
            self.db.add(
                TaskDependency(
                    organization_id=organization_id,
                    task_id=task_id,
                    depends_on_task_id=dep_id,
                )
            )
        await self.db.commit()
        await self.add_log(
            task_id,
            organization_id,
            'dependency',
            f'Dependencies updated: {", ".join(str(v) for v in unique_ids) if unique_ids else "none"}',
        )
        return unique_ids

    async def _get_recent_average_duration_sec(self, organization_id: int) -> float:
        if self.db is None:
            return 120.0
        result = await self.db.execute(
            select(AgentLog)
            .where(AgentLog.organization_id == organization_id, AgentLog.stage == 'run_metrics')
            .order_by(AgentLog.created_at.desc())
            .limit(20)
        )
        rows = list(result.scalars().all())
        values = [self._extract_duration(r.message or '') for r in rows]
        durations = [v for v in values if v is not None and v > 0]
        if not durations:
            return 120.0
        return float(sum(durations) / len(durations))

    async def _find_repo_blocker(self, organization_id: int, task_id: int, local_repo_path: str) -> TaskRecord | None:
        if self.db is None:
            return None
        result = await self.db.execute(
            select(TaskRecord)
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.id != task_id,
                TaskRecord.status.in_(['running', 'queued']),
                TaskRecord.description.like(f'%Local Repo Path: {local_repo_path}%'),
            )
            .order_by(TaskRecord.created_at.asc())
        )
        candidates = list(result.scalars().all())
        if not candidates:
            return None
        for item in candidates:
            if item.status == 'running':
                return item
        return candidates[0]

    def _extract_duration(self, message: str) -> float | None:
        match = re.search(r'DurationSec:\s*([0-9]+(?:\.[0-9]+)?)', message or '')
        if not match:
            return None
        try:
            return float(match.group(1))
        except ValueError:
            return None

    def _extract_local_repo_path(self, description: str | None) -> str | None:
        if not description:
            return None
        for raw in description.splitlines():
            if raw.lower().startswith('local repo path:'):
                return raw.split(':', 1)[1].strip() or None
        return None

    async def _would_create_cycle(self, organization_id: int, *, task_id: int, depends_on_task_id: int) -> bool:
        if self.db is None:
            raise ValueError('DB session required')
        seen: set[int] = set()
        stack: list[int] = [depends_on_task_id]
        while stack:
            current = stack.pop()
            if current == task_id:
                return True
            if current in seen:
                continue
            seen.add(current)
            next_result = await self.db.execute(
                select(TaskDependency.depends_on_task_id).where(
                    TaskDependency.organization_id == organization_id,
                    TaskDependency.task_id == current,
                )
            )
            stack.extend(int(v) for v in next_result.scalars().all())
        return False

    def _compute_pr_risk(self, logs: list[AgentLog]) -> dict[str, int | str | None]:
        diff_logs = [l for l in logs if l.stage == 'code_diff']
        if not diff_logs:
            return {'score': None, 'level': None, 'reason': None}

        files = 0
        added = 0
        removed = 0
        critical_hits = 0
        critical_markers = ('auth', 'security', 'payment', 'billing', 'alembic', 'models/', 'api/')

        for item in diff_logs[-1:]:
            lines = (item.message or '').splitlines()
            current_file = ''
            for line in lines:
                if line.startswith('File:'):
                    files += 1
                    current_file = line.replace('File:', '', 1).strip().lower()
                    if any(marker in current_file for marker in critical_markers):
                        critical_hits += 1
                    continue
                if line.startswith('+++') or line.startswith('---'):
                    continue
                if line.startswith('+'):
                    added += 1
                elif line.startswith('-'):
                    removed += 1

        churn = added + removed
        score = min(100, files * 8 + min(50, churn // 8) + critical_hits * 14)
        if score >= 67:
            level = 'high'
        elif score >= 34:
            level = 'medium'
        else:
            level = 'low'
        reason = f'{files} file(s), {churn} changed line(s), {critical_hits} critical path touch'
        return {'score': int(score), 'level': level, 'reason': reason}
