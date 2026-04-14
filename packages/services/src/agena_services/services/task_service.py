from __future__ import annotations

import json
import re
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_core.settings import get_settings
from agena_services.services.event_bus import publish_fire_and_forget
from agena_services.integrations.azure_client import AzureDevOpsClient
from agena_services.integrations.jira_client import JiraClient
from agena_services.integrations.newrelic_client import NewRelicClient
from agena_models.models.agent_log import AgentLog
from agena_models.models.ai_usage_event import AIUsageEvent
from agena_models.models.run_record import RunRecord
from agena_models.models.task_dependency import TaskDependency
from agena_models.models.task_record import TaskRecord
from agena_models.models.user import User
from agena_models.models.user_preference import UserPreference
from agena_models.schemas.task import ExternalTask
from agena_services.services.integration_config_service import IntegrationConfigService
from agena_services.services.notification_service import NotificationService
from agena_services.services.queue_service import QueueService
from agena_services.services.usage_service import UsageService


class TaskService:
    def __init__(self, db: AsyncSession | None = None) -> None:
        self.db = db
        self.settings = get_settings()
        self.jira_client = JiraClient()
        self.azure_client = AzureDevOpsClient()
        self.newrelic_client = NewRelicClient()
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
            status='new',
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
        sprint_name: str | None = None,
        sprint_path: str | None = None,
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
            status='new',
            sprint_name=sprint_name or None,
            sprint_path=sprint_path or None,
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
            except PermissionError as pe:
                raise ValueError(f'Task quota exceeded: {pe}') from pe

        return imported, skipped

    async def import_from_jira(
        self,
        organization_id: int,
        user_id: int,
        *,
        project_key: str | None = None,
        board_id: str | None = None,
        sprint_id: str | None = None,
        state: str | None = None,
    ) -> tuple[int, int]:
        if self.db is None:
            raise ValueError('DB session required')

        config_service = IntegrationConfigService(self.db)
        config = await config_service.get_config(organization_id, 'jira')
        if config is None:
            raise ValueError('Jira integration not configured for this organization')

        jira_cfg = {
            'base_url': config.base_url,
            'email': config.username or '',
            'api_token': config.secret,
        }
        if board_id:
            external_items = await self.jira_client.fetch_board_issues(
                jira_cfg,
                board_id=board_id,
                sprint_id=sprint_id,
                state=state,
            )
        else:
            external_items = await self.jira_client.fetch_todo_issues(jira_cfg)
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
            except PermissionError as pe:
                raise ValueError(f'Task quota exceeded: {pe}') from pe

        return imported, skipped

    async def import_from_newrelic(
        self,
        organization_id: int,
        user_id: int,
        *,
        entity_guid: str | None = None,
        since: str = '24 hours ago',
        min_occurrences: int = 1,
    ) -> tuple[int, int]:
        if self.db is None:
            raise ValueError('DB session required')

        config_service = IntegrationConfigService(self.db)
        config = await config_service.get_config(organization_id, 'newrelic')
        if config is None:
            raise ValueError('New Relic integration not configured for this organization')

        nr_cfg = {
            'api_key': config.secret,
            'base_url': config.base_url or 'https://api.newrelic.com/graphql',
        }

        from agena_models.models.newrelic_entity_mapping import NewRelicEntityMapping

        if entity_guid:
            stmt = select(NewRelicEntityMapping).where(
                NewRelicEntityMapping.organization_id == organization_id,
                NewRelicEntityMapping.entity_guid == entity_guid,
            )
            row = (await self.db.execute(stmt)).scalar_one_or_none()
            mappings = [row] if row else []
            if not mappings:
                raise ValueError(f'No entity mapping found for guid {entity_guid}')
        else:
            stmt = select(NewRelicEntityMapping).where(
                NewRelicEntityMapping.organization_id == organization_id,
                NewRelicEntityMapping.is_active.is_(True),
            )
            mappings = list((await self.db.execute(stmt)).scalars().all())
            if not mappings:
                raise ValueError('No active New Relic entity mappings found')

        imported = 0
        skipped = 0

        for mapping in mappings:
            errors = await self.newrelic_client.fetch_errors_with_details(
                nr_cfg,
                account_id=mapping.account_id,
                app_name=mapping.entity_name,
                since=since,
            )
            filtered = [e for e in errors if e.get('occurrences', 0) >= min_occurrences]
            ext_tasks = self.newrelic_client.errors_to_external_tasks(
                filtered, entity_name=mapping.entity_name, account_id=mapping.account_id,
                entity_guid=mapping.entity_guid,
            )
            for item in ext_tasks:
                try:
                    before = await self.db.execute(
                        select(TaskRecord.id).where(
                            TaskRecord.organization_id == organization_id,
                            TaskRecord.source == 'newrelic',
                            TaskRecord.external_id == item.id,
                        )
                    )
                    if before.scalar_one_or_none() is not None:
                        skipped += 1
                        continue

                    task = await self.create_task_from_external(
                        organization_id=organization_id,
                        user_id=user_id,
                        source='newrelic',
                        external_id=item.id,
                        title=item.title,
                        description=item.description,
                    )
                    if mapping.repo_mapping_id:
                        task.repo_mapping_id = mapping.repo_mapping_id
                        await self.db.commit()
                    imported += 1
                except PermissionError as pe:
                    raise ValueError(f'Task quota exceeded: {pe}') from pe

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
        source: str | None = None,
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
        if source and source != 'all':
            filters.append(TaskRecord.source == source)
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

    async def assign_task_to_ai(self, organization_id: int, task_id: int, create_pr: bool = True, mode: str = 'flow', agent_role: str | None = None, agent_model: str | None = None, agent_provider: str | None = None, force_queue: bool = False) -> str:
        if self.db is None:
            raise ValueError('DB session required')

        task = await self.get_task(organization_id, task_id)
        if task is None:
            raise ValueError('Task not found')
        if task.status == 'running' and not force_queue:
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
            if conflict_row is not None and not force_queue:
                raise ValueError(f'REPO_CONFLICT:#{conflict_row.id} {conflict_row.title}')

        # Auto-attach repo mapping if task has no Local Repo Path
        has_local_mapping = 'Local Repo Path:' in (task.description or '')
        if not has_local_mapping:
            await self._attach_default_repo_mapping(organization_id, task)
            has_local_mapping = 'Local Repo Path:' in (task.description or '')
            local_repo_path = self._extract_local_repo_path(task.description)
        has_remote_repo = 'Remote Repo:' in (task.description or '') or any(
            line.strip().startswith(('azure:', 'github:'))
            for line in (task.description or '').splitlines()
        )
        if not has_local_mapping and not has_remote_repo:
            create_pr = False

        explicit_model = (agent_model or '').strip() or None
        explicit_provider = (agent_provider or '').strip() or None
        stored_model, stored_provider = self._extract_preferred_agent_selection(task.description)

        if explicit_model or explicit_provider:
            task.description = self._upsert_description_metadata(
                task.description,
                {
                    'Preferred Agent Model': explicit_model,
                    'Preferred Agent Provider': explicit_provider,
                },
            )
            stored_model = explicit_model or stored_model
            stored_provider = explicit_provider or stored_provider

        pref_model, pref_provider = (None, None)
        if not stored_model or not stored_provider:
            pref_model, pref_provider = await self._get_user_preferred_agent_selection(task.created_by_user_id)

        effective_model = explicit_model or stored_model or pref_model
        effective_provider = explicit_provider or stored_provider or pref_provider
        if effective_model and 'Preferred Agent Model:' not in (task.description or ''):
            task.description = self._upsert_description_metadata(
                task.description,
                {'Preferred Agent Model': effective_model},
            )
        if effective_provider and 'Preferred Agent Provider:' not in (task.description or ''):
            task.description = self._upsert_description_metadata(
                task.description,
                {'Preferred Agent Provider': effective_provider},
            )

        was_queued = task.status == 'queued'
        was_terminal = task.status in {'failed', 'completed', 'cancelled'}
        if was_queued:
            await self.queue_service.remove_task(
                organization_id=organization_id,
                task_id=task.id,
            )

        task.status = 'queued'
        task.failure_reason = None
        task.last_mode = mode
        await self.db.commit()
        try:
            queue_key = await self.queue_service.enqueue(
                {
                    'organization_id': organization_id,
                    'task_id': task.id,
                    'create_pr': create_pr,
                    'mode': mode,
                    'agent_role': agent_role,
                    'agent_model': effective_model,
                    'agent_provider': effective_provider,
                }
            )
        except Exception as exc:
            task.status = 'failed'
            task.failure_reason = f'Queue enqueue failed: {str(exc)[:240]}'
            await self.db.commit()
            await self.add_log(task.id, organization_id, 'failed', task.failure_reason)
            raise
        # Build rich queue log with who started, model, params
        user_result = await self.db.execute(select(User).where(User.id == task.created_by_user_id))
        starter_user = user_result.scalar_one_or_none()
        starter_name = starter_user.full_name if starter_user else f'user#{task.created_by_user_id}'

        agent_source = 'default'
        if explicit_model or explicit_provider:
            agent_source = 'explicit_request'
        elif stored_model or stored_provider:
            agent_source = 'task_metadata'
        elif pref_model or pref_provider:
            agent_source = 'user_preference'

        queue_msg_parts = [
            f'{"Re-queued" if (was_queued or was_terminal) else "Queued"} by {starter_name}',
            f'source={task.source}',
            f'create_pr={create_pr}',
        ]
        if effective_provider:
            queue_msg_parts.append(f'provider={effective_provider}')
        if effective_model:
            queue_msg_parts.append(f'model={effective_model}')
        if effective_model or effective_provider:
            queue_msg_parts.append(f'agent_source={agent_source}')
        if local_repo_path:
            queue_msg_parts.append(f'repo={local_repo_path}')
        if blockers:
            queue_msg_parts.append(f'was_blocked_by={blockers}')
        await self.add_log(task.id, organization_id, 'queued', ' | '.join(queue_msg_parts))
        if not has_local_mapping:
            await self.add_log(task.id, organization_id, 'repo_mapping', 'No repo mapping found; PR auto-creation disabled')

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

        publish_fire_and_forget(organization_id, 'task_status', {
            'task_id': task.id, 'status': 'queued', 'title': task.title,
        })

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
        publish_fire_and_forget(organization_id, 'task_status', {
            'task_id': task.id, 'status': 'cancelled', 'title': task.title,
        })
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
            .order_by(AgentLog.id.asc())
        )
        return list(result.scalars().all())

    async def get_logs_since(self, organization_id: int, task_id: int, since_id: int) -> list[AgentLog]:
        if self.db is None:
            raise ValueError('DB session required')

        result = await self.db.execute(
            select(AgentLog)
            .where(
                AgentLog.organization_id == organization_id,
                AgentLog.task_id == task_id,
                AgentLog.id > max(0, since_id),
            )
            .order_by(AgentLog.id.asc())
        )
        return list(result.scalars().all())

    async def get_usage_events(self, organization_id: int, task_id: int) -> list[AIUsageEvent]:
        if self.db is None:
            raise ValueError('DB session required')

        result = await self.db.execute(
            select(AIUsageEvent)
            .where(AIUsageEvent.organization_id == organization_id, AIUsageEvent.task_id == task_id)
            .order_by(AIUsageEvent.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_runs(self, organization_id: int, task_id: int) -> list[RunRecord]:
        if self.db is None:
            raise ValueError('DB session required')
        result = await self.db.execute(
            select(RunRecord)
            .where(RunRecord.organization_id == organization_id, RunRecord.task_id == task_id)
            .order_by(RunRecord.created_at.asc())
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
        return self._extract_description_metadata(description, 'Local Repo Path')

    def _extract_description_metadata(self, description: str | None, label: str) -> str | None:
        if not description:
            return None
        expected = str(label or '').strip().lower()
        if not expected:
            return None
        for raw in description.splitlines():
            if ':' not in raw:
                continue
            key, value = raw.split(':', 1)
            if key.strip().lower() != expected:
                continue
            return value.strip() or None
        return None

    def _extract_preferred_agent_selection(self, description: str | None) -> tuple[str | None, str | None]:
        return (
            self._extract_description_metadata(description, 'Preferred Agent Model'),
            self._extract_description_metadata(description, 'Preferred Agent Provider'),
        )

    def _upsert_description_metadata(self, description: str | None, updates: dict[str, str | None]) -> str:
        normalized_updates = {
            key.strip().lower(): (key.strip(), value.strip())
            for key, value in updates.items()
            if str(key or '').strip() and str(value or '').strip()
        }
        if not normalized_updates:
            return description or ''

        lines = (description or '').splitlines()
        found: set[str] = set()
        rewritten: list[str] = []
        for raw in lines:
            if ':' not in raw:
                rewritten.append(raw)
                continue
            key, _value = raw.split(':', 1)
            lowered = key.strip().lower()
            if lowered in normalized_updates:
                display_key, display_value = normalized_updates[lowered]
                rewritten.append(f'{display_key}: {display_value}')
                found.add(lowered)
            else:
                rewritten.append(raw)

        for lowered, (display_key, display_value) in normalized_updates.items():
            if lowered in found:
                continue
            rewritten.append(f'{display_key}: {display_value}')

        return '\n'.join(rewritten).rstrip()

    async def _get_user_preferred_agent_selection(self, user_id: int) -> tuple[str | None, str | None]:
        if self.db is None:
            return None, None
        pref_result = await self.db.execute(
            select(UserPreference).where(UserPreference.user_id == user_id)
        )
        pref = pref_result.scalar_one_or_none()
        if pref is None:
            return None, None

        model: str | None = None
        provider: str | None = None

        # Try developer agent config first
        if pref.agents_json:
            try:
                agents = json.loads(pref.agents_json)
                dev_agent = next(
                    (a for a in agents if str(a.get('role', '')).lower() == 'developer' and a.get('enabled', True)),
                    None,
                )
                if dev_agent:
                    model = str(dev_agent.get('custom_model') or dev_agent.get('model') or '').strip() or None
                    provider = str(dev_agent.get('provider') or '').strip() or None
            except Exception:
                pass

        # Fallback to profile_settings preferred_provider / preferred_model
        if not provider or not model:
            try:
                profile = json.loads(pref.profile_settings_json or '{}')
                if not provider:
                    provider = str(profile.get('preferred_provider') or '').strip() or None
                if not model:
                    model = str(profile.get('preferred_model') or '').strip() or None
            except Exception:
                pass

        return model, provider

    async def _attach_default_repo_mapping(self, organization_id: int, task: TaskRecord) -> bool:
        if self.db is None:
            return False

        pref_result = await self.db.execute(
            select(UserPreference).where(UserPreference.user_id == task.created_by_user_id)
        )
        pref = pref_result.scalar_one_or_none()
        if pref is None or not pref.repo_mappings_json:
            return False

        try:
            mappings = json.loads(pref.repo_mappings_json)
        except Exception:
            return False
        if not isinstance(mappings, list):
            return False

        valid: list[dict] = []
        for item in mappings:
            if not isinstance(item, dict):
                continue
            local_path = str(item.get('local_path') or '').strip()
            if not local_path:
                continue
            valid.append(item)
        if not valid:
            return False

        source = (task.source or '').strip().lower()

        def score(item: dict) -> tuple[int, int]:
            provider = str(item.get('provider') or '').strip().lower()
            has_azure_meta = int(bool((item.get('azure_repo_url') or '') and (item.get('azure_project') or '')))
            has_github_meta = int(bool(item.get('github_repo_full_name') or item.get('github_repo')))
            score_source = 0
            if source == 'azure':
                if provider == 'azure':
                    score_source += 3
                score_source += has_azure_meta * 2
            elif source == 'jira':
                # Jira taskleri genelde Azure repo'ya merge edilir; Azure metadata öncelikli.
                score_source += has_azure_meta * 3
                if provider == 'azure':
                    score_source += 2
                if provider == 'github':
                    score_source += 1
            elif source == 'github':
                if provider == 'github':
                    score_source += 3
                score_source += has_github_meta * 2
            else:
                if provider:
                    score_source += 1
            return score_source, has_azure_meta + has_github_meta

        chosen = sorted(valid, key=score, reverse=True)[0]

        desc = (task.description or '').strip()
        existing = {line.split(':', 1)[0].strip().lower() for line in desc.splitlines() if ':' in line}
        lines: list[str] = []

        if 'external source' not in existing and task.external_id:
            if source == 'azure':
                lines.append(f'External Source: Azure #{task.external_id}')
            elif source == 'jira':
                lines.append(f'External Source: Jira #{task.external_id}')
            elif source == 'github':
                lines.append(f'External Source: GitHub #{task.external_id}')

        mapping_name = str(chosen.get('name') or '').strip()
        local_path = str(chosen.get('local_path') or '').strip()
        azure_project = str(chosen.get('azure_project') or '').strip()
        azure_repo_url = str(chosen.get('azure_repo_url') or '').strip()
        repo_playbook = str(chosen.get('repo_playbook') or '').replace('\n', ' ').strip()

        if mapping_name and 'local repo mapping' not in existing:
            lines.append(f'Local Repo Mapping: {mapping_name}')
        if local_path and 'local repo path' not in existing:
            lines.append(f'Local Repo Path: {local_path}')
        if azure_project and 'project' not in existing:
            lines.append(f'Project: {azure_project}')
        if azure_repo_url and 'azure repo' not in existing:
            lines.append(f'Azure Repo: {azure_repo_url}')
        if repo_playbook and 'repo playbook' not in existing:
            lines.append(f'Repo Playbook: {repo_playbook}')
        remote_repo = str(chosen.get('remote_repo') or '').strip()
        if remote_repo and 'remote repo' not in existing:
            lines.append(f'Remote Repo: {remote_repo}')

        if not lines:
            return False

        task.description = (desc + '\n\n---\n' + '\n'.join(lines)).strip() if desc else '\n'.join(lines)
        await self.db.commit()
        return True

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
