"""Bi-directional Kanban status sync between Agena, Jira, and Azure DevOps.

Agena tasks carry an internal `status` (queued / running / completed / …) plus
an externally-sourced `source` + `external_id`. The Kanban board collapses both
the internal lifecycle and any external workflow into four user-facing columns:
    todo / in_progress / review / done

This service owns the mapping in both directions:

    Agena column  ←→ Jira workflow status  ←→ Azure System.State

When the user drags a card on the Agena board (`apply_local_change`) we push
the matching state into Jira/Azure. When Jira/Azure fires a webhook with a new
status (`apply_remote_change`) we project it back to a column and update the
Agena task. A short echo-suppression window prevents the inbound webhook from
re-applying a change that Agena itself just emitted.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.task_record import TaskRecord
from agena_services.integrations.azure_client import AzureDevOpsClient
from agena_services.integrations.jira_client import JiraClient
from agena_services.services.integration_config_service import IntegrationConfigService

logger = logging.getLogger(__name__)


KANBAN_COLUMNS: tuple[str, ...] = ('todo', 'in_progress', 'review', 'done')


# Internal Agena task.status -> kanban column. Anything we don't recognise
# falls back to 'todo' so the card still shows up on the board.
_INTERNAL_TO_COLUMN: dict[str, str] = {
    'queued': 'todo',
    'pending': 'todo',
    'todo': 'todo',
    'new': 'todo',
    'open': 'todo',
    'running': 'in_progress',
    'in_progress': 'in_progress',
    'active': 'in_progress',
    'doing': 'in_progress',
    'review': 'review',
    'in_review': 'review',
    'pr_open': 'review',
    'awaiting_review': 'review',
    'completed': 'done',
    'done': 'done',
    'closed': 'done',
    'resolved': 'done',
    'merged': 'done',
}

_COLUMN_TO_INTERNAL: dict[str, str] = {
    'todo': 'queued',
    'in_progress': 'running',
    'review': 'in_review',
    'done': 'completed',
}


# Outbound: Agena column -> external state name. We send a list because Jira
# / Azure boards are configurable — we'll pick whichever name is reachable
# from the issue's current workflow.
_COLUMN_TO_JIRA_NAMES: dict[str, list[str]] = {
    'todo': ['To Do', 'Open', 'Backlog', 'Selected for Development'],
    'in_progress': ['In Progress', 'In Development', 'Doing'],
    'review': ['In Review', 'Code Review', 'Review', 'QA'],
    'done': ['Done', 'Closed', 'Resolved'],
}

_COLUMN_TO_AZURE_NAMES: dict[str, list[str]] = {
    'todo': ['To Do', 'New', 'Proposed'],
    'in_progress': ['Active', 'In Progress', 'Doing', 'Committed'],
    'review': ['Code Review', 'In Review', 'Resolved'],
    'done': ['Done', 'Closed', 'Completed'],
}


# Inbound: external state name -> kanban column. Lower-cased lookup, so the
# Jira "In Progress" and Azure "Active" both resolve.
_EXTERNAL_TO_COLUMN: dict[str, str] = {
    # Jira
    'to do': 'todo',
    'open': 'todo',
    'backlog': 'todo',
    'selected for development': 'todo',
    'in progress': 'in_progress',
    'in development': 'in_progress',
    'doing': 'in_progress',
    'in review': 'review',
    'code review': 'review',
    'review': 'review',
    'qa': 'review',
    'done': 'done',
    'closed': 'done',
    'resolved': 'done',
    # Azure
    'new': 'todo',
    'proposed': 'todo',
    'active': 'in_progress',
    'committed': 'in_progress',
    'completed': 'done',
}


# After we push a status to Jira/Azure, the platform fires a webhook back at
# us. That webhook will report the same state we just set, and if we acted on
# it we'd flip the card back & forth. Track recent outbound writes so the
# inbound handler can ignore the echo.
_ECHO_WINDOW_SECONDS = 30
_recent_outbound: dict[tuple[str, str], datetime] = {}


def _normalize(value: str | None) -> str:
    return str(value or '').strip().lower()


class KanbanSyncService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.config_service = IntegrationConfigService(db)

    # -- mapping helpers ---------------------------------------------------

    @staticmethod
    def column_for_internal_status(status: str | None) -> str:
        return _INTERNAL_TO_COLUMN.get(_normalize(status), 'todo')

    @staticmethod
    def column_for_external_status(status: str | None) -> str | None:
        return _EXTERNAL_TO_COLUMN.get(_normalize(status))

    @staticmethod
    def internal_status_for_column(column: str) -> str:
        return _COLUMN_TO_INTERNAL.get(_normalize(column), 'queued')

    # -- outbound: Agena → Jira / Azure ------------------------------------

    async def apply_local_change(self, task: TaskRecord, new_column: str) -> dict[str, Any]:
        """Update the Agena TaskRecord and push the change to the linked
        external system. Caller commits the session.
        """
        column = _normalize(new_column)
        if column not in KANBAN_COLUMNS:
            raise ValueError(f'Unknown kanban column: {new_column!r}')

        task.status = self.internal_status_for_column(column)

        result: dict[str, Any] = {
            'column': column,
            'internal_status': task.status,
            'external_synced': False,
            'external_provider': task.source,
            'external_id': task.external_id,
        }

        source = _normalize(task.source)
        external_id = (task.external_id or '').strip()
        if not external_id or source not in ('jira', 'azure', 'azure_devops'):
            return result

        try:
            if source == 'jira':
                ok = await self._push_to_jira(task, column)
                result['external_synced'] = ok
            else:
                ok = await self._push_to_azure(task, column)
                result['external_synced'] = ok
        except Exception as exc:  # noqa: BLE001 — surface as soft failure
            logger.warning(
                'Kanban sync push failed (task=%s source=%s id=%s col=%s): %s',
                task.id, task.source, task.external_id, column, exc,
            )
            result['error'] = str(exc)
        if result.get('external_synced'):
            self._mark_recent_outbound(task.source, external_id)
        return result

    async def _push_to_jira(self, task: TaskRecord, column: str) -> bool:
        cfg = await self._jira_cfg(task.organization_id)
        if not cfg:
            logger.info('Skip Jira push for task %s — no integration config', task.id)
            return False
        client = JiraClient()
        for candidate in _COLUMN_TO_JIRA_NAMES.get(column, []):
            try:
                tr_id = await client.transition_issue(
                    cfg=cfg, issue_key=task.external_id or '', target_status=candidate,
                )
            except Exception as exc:
                logger.warning('Jira transition_issue for %s → %s failed: %s', task.external_id, candidate, exc)
                continue
            if tr_id:
                logger.info('Jira: %s moved to %s (transition %s)', task.external_id, candidate, tr_id)
                return True
        return False

    async def _push_to_azure(self, task: TaskRecord, column: str) -> bool:
        cfg = await self._azure_cfg(task.organization_id)
        if not cfg:
            logger.info('Skip Azure push for task %s — no integration config', task.id)
            return False
        client = AzureDevOpsClient()
        last_error: Exception | None = None
        for candidate in _COLUMN_TO_AZURE_NAMES.get(column, []):
            try:
                await client.update_work_item_state(
                    cfg=cfg,
                    work_item_id=task.external_id or '',
                    state=candidate,
                    comment=f'Status updated from Agena Kanban: {column}',
                )
                logger.info('Azure: work item %s moved to %s', task.external_id, candidate)
                return True
            except Exception as exc:
                # Azure rejects unknown states with 400 — try the next
                # synonym before giving up. Other errors short-circuit so
                # we don't burn through PAT requests.
                msg = str(exc)
                if 'TF401320' in msg or '400' in msg or 'invalid' in msg.lower() or 'state' in msg.lower():
                    last_error = exc
                    continue
                raise
        if last_error:
            raise last_error
        return False

    # -- inbound: Jira / Azure → Agena -------------------------------------

    async def apply_remote_change(
        self,
        *,
        source: str,
        external_id: str,
        external_status: str,
    ) -> dict[str, Any]:
        """Map an inbound Jira/Azure status into a kanban column and update
        any Agena task linked by (source, external_id). Returns a small
        report describing what (if anything) was changed.
        """
        src = _normalize(source)
        if src in ('azure_devops',):
            src = 'azure'
        ext = (external_id or '').strip()
        column = self.column_for_external_status(external_status)
        result: dict[str, Any] = {
            'source': src,
            'external_id': ext,
            'external_status': external_status,
            'column': column,
            'updated_task_ids': [],
            'echo_suppressed': False,
        }
        if not ext or column is None:
            result['skipped_reason'] = 'no_mapping' if ext else 'no_external_id'
            return result

        if self._is_echo(src, ext):
            result['echo_suppressed'] = True
            return result

        from sqlalchemy import select

        stmt = select(TaskRecord).where(
            TaskRecord.source == src, TaskRecord.external_id == ext,
        )
        rows = list((await self.db.execute(stmt)).scalars().all())
        if not rows:
            result['skipped_reason'] = 'task_not_found'
            return result

        new_internal = self.internal_status_for_column(column)
        changed: list[int] = []
        for task in rows:
            if _normalize(task.status) == _normalize(new_internal):
                continue
            task.status = new_internal
            changed.append(task.id)
        if changed:
            await self.db.commit()
        result['updated_task_ids'] = changed
        return result

    # -- echo suppression --------------------------------------------------

    @staticmethod
    def _mark_recent_outbound(source: str | None, external_id: str) -> None:
        key = (_normalize(source), external_id.strip())
        if not key[0] or not key[1]:
            return
        _recent_outbound[key] = datetime.now(timezone.utc)
        # Best-effort GC so the dict doesn't grow unbounded.
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=_ECHO_WINDOW_SECONDS * 4)
        for k in list(_recent_outbound.keys()):
            if _recent_outbound[k] < cutoff:
                _recent_outbound.pop(k, None)

    @staticmethod
    def _is_echo(source: str, external_id: str) -> bool:
        ts = _recent_outbound.get((_normalize(source), external_id.strip()))
        if not ts:
            return False
        return datetime.now(timezone.utc) - ts < timedelta(seconds=_ECHO_WINDOW_SECONDS)

    # -- credential resolution ---------------------------------------------

    async def _jira_cfg(self, organization_id: int) -> dict[str, str] | None:
        config = await self.config_service.get_config(organization_id, 'jira')
        if not config or not config.secret:
            return None
        extra = config.extra_config or {}
        email = str(extra.get('email') or '').strip()
        return {
            'base_url': (config.base_url or '').strip(),
            'email': email,
            'api_token': config.secret,
        }

    async def _azure_cfg(self, organization_id: int) -> dict[str, str] | None:
        # Try both common provider keys so callers don't have to care which
        # the integration was registered under.
        for provider in ('azure_devops', 'azure'):
            config = await self.config_service.get_config(organization_id, provider)
            if config and config.secret:
                extra = config.extra_config or {}
                return {
                    'org_url': (config.base_url or '').strip(),
                    'project': str(extra.get('project') or '').strip(),
                    'pat': config.secret,
                }
        return None
