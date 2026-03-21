from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from integrations.azure_client import AzureDevOpsClient
from integrations.jira_client import JiraClient
from models.agent_log import AgentLog
from models.run_record import RunRecord
from models.task_record import TaskRecord
from schemas.task import ExternalTask
from services.integration_config_service import IntegrationConfigService
from services.queue_service import QueueService
from services.usage_service import UsageService


class TaskService:
    def __init__(self, db: AsyncSession | None = None) -> None:
        self.db = db
        self.jira_client = JiraClient()
        self.azure_client = AzureDevOpsClient()
        self.queue_service = QueueService()

    async def get_jira_tasks(self) -> list[ExternalTask]:
        return await self.jira_client.fetch_todo_issues()

    async def get_azure_tasks(self) -> list[ExternalTask]:
        return await self.azure_client.fetch_new_work_items()

    async def create_task(self, organization_id: int, user_id: int, title: str, description: str) -> TaskRecord:
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

    async def get_task(self, organization_id: int, task_id: int) -> TaskRecord | None:
        if self.db is None:
            raise ValueError('DB session required')
        result = await self.db.execute(
            select(TaskRecord).where(TaskRecord.id == task_id, TaskRecord.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def assign_task_to_ai(self, organization_id: int, task_id: int, create_pr: bool = True) -> str:
        if self.db is None:
            raise ValueError('DB session required')

        task = await self.get_task(organization_id, task_id)
        if task is None:
            raise ValueError('Task not found')

        # Legacy guard: external tasks without mapping should not auto-open PRs.
        # If mapping metadata exists, orchestration decides provider-specific PR flow.
        has_local_mapping = 'Local Repo Path:' in (task.description or '')
        if task.source != 'internal' and not has_local_mapping:
            create_pr = False

        queue_key = await self.queue_service.enqueue(
            {
                'organization_id': organization_id,
                'task_id': task.id,
                'create_pr': create_pr,
            }
        )
        task.status = 'queued'
        await self.db.commit()
        await self.add_log(task.id, organization_id, 'queued', 'Task queued for AI processing')
        return queue_key

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

    def _extract_duration(self, message: str) -> float | None:
        match = re.search(r'DurationSec:\s*([0-9]+(?:\.[0-9]+)?)', message or '')
        if not match:
            return None
        try:
            return float(match.group(1))
        except ValueError:
            return None
