"""Push external work-item state updates as the AI agent moves a task
through its lifecycle.

Three transitions are emitted, regardless of provider:

    on_task_start  → "in_progress"  (agent picked up the task)
    on_pr_opened   → "in_review"    (PR has been created)
    on_pr_merged   → "done"         (PR landed on the base branch)

Each logical state is mapped to a provider-native value before being
pushed:

    Jira  → 'In Progress' / 'Code Review' / 'Done'
    Azure → 'Active'      / 'Resolved'    / 'Closed'

Teams whose workflow uses different names override per-org via
``integration_configs.extra_config.workflow_states``, e.g.
``{"in_progress": "Doing", "in_review": "In Review", "done": "Resolved"}``.

All operations are best-effort: any failure (auth, network, missing
transition) is logged and swallowed so the agent flow is never blocked
by a sync hiccup.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.task_record import TaskRecord
from agena_services.integrations.azure_client import AzureDevOpsClient
from agena_services.integrations.jira_client import JiraClient
from agena_services.services.integration_config_service import IntegrationConfigService

logger = logging.getLogger(__name__)


# Multiple candidate names per logical state. The first one whose
# matching transition is offered by the workflow wins. Ordering is
# intentional: most-specific English first, then common synonyms,
# then Turkish equivalents — covers the canonical Atlassian workflow,
# Azure default templates, and typical Turkish-localised setups
# without forcing every team to fill in extra_config.
_DEFAULTS: dict[str, dict[str, list[str]]] = {
    'jira': {
        'in_progress': [
            'In Progress', 'In-Progress', 'Doing', 'Devam Ediyor',
            'Yapılıyor', 'In dev',
        ],
        'in_review': [
            'Code Review', 'In Review', 'Review', 'İNCELEMEDE',
            'İncelemede', 'PR Review', 'Awaiting Review',
        ],
        'done': [
            'Done', 'Closed', 'Resolved', 'Tamam', 'Bitti', 'Completed',
        ],
    },
    'azure': {
        'in_progress': ['Active', 'Doing', 'In Progress', 'Committed'],
        'in_review': ['Resolved', 'In Review', 'Code Review', 'Review'],
        'done': ['Closed', 'Done', 'Completed', 'Removed'],
    },
}


class WorkflowSyncService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def on_task_start(self, task: TaskRecord) -> None:
        await self._push(
            task,
            logical='in_progress',
            comment='Agena: agent started working on this task',
        )

    async def on_pr_opened(self, task: TaskRecord) -> None:
        pr_url = (task.pr_url or '').strip()
        suffix = f' ({pr_url})' if pr_url else ''
        await self._push(
            task,
            logical='in_review',
            comment=f'Agena: PR opened — moved to review{suffix}',
        )

    async def on_pr_merged(self, task: TaskRecord) -> None:
        await self._push(
            task,
            logical='done',
            comment='Agena: PR merged — marking done',
        )

    async def _push(
        self,
        task: TaskRecord,
        *,
        logical: str,
        comment: str | None,
    ) -> None:
        try:
            source = (task.source or '').lower()
            external_id = (task.external_id or '').strip()
            if not external_id or source not in _DEFAULTS:
                return

            cfg_service = IntegrationConfigService(self.db)
            config = await cfg_service.get_config(task.organization_id, source)
            if not config or not config.secret:
                return

            candidates = self._resolve_candidates(config, source, logical)
            if not candidates:
                return

            if source == 'jira':
                jira_cfg = {
                    'base_url': config.base_url or '',
                    'email': config.username or '',
                    'api_token': config.secret,
                }
                client = JiraClient()
                # Try each candidate in order until one matches an
                # available transition for this issue's current state.
                # Single GET → POST per success; the transition_issue
                # helper already consults Jira's transitions list per
                # call so we don't need to dedupe here.
                for cand in candidates:
                    tr_id = await client.transition_issue(
                        cfg=jira_cfg,
                        issue_key=external_id,
                        target_status=cand,
                    )
                    if tr_id:
                        logger.info(
                            'WorkflowSync %s task=%s jira=%s → %r (transition=%s)',
                            logical, task.id, external_id, cand, tr_id,
                        )
                        return
                logger.info(
                    'WorkflowSync %s task=%s jira=%s — no transition matched any of %s',
                    logical, task.id, external_id, candidates,
                )
            else:  # azure
                azure_cfg = {
                    'org_url': config.base_url or '',
                    'pat': config.secret,
                    'project': config.project or '',
                }
                client = AzureDevOpsClient()
                last_exc: Exception | None = None
                for cand in candidates:
                    try:
                        await client.update_work_item_state(
                            cfg=azure_cfg,
                            work_item_id=external_id,
                            state=cand,
                            comment=comment,
                        )
                        logger.info(
                            'WorkflowSync %s task=%s azure=%s → %r',
                            logical, task.id, external_id, cand,
                        )
                        return
                    except Exception as exc:
                        # Azure rejects an unknown System.State with
                        # 400; we keep trying remaining synonyms.
                        last_exc = exc
                        continue
                logger.info(
                    'WorkflowSync %s task=%s azure=%s — none of %s accepted (last error: %s)',
                    logical, task.id, external_id, candidates, last_exc,
                )
        except Exception as exc:
            # Never propagate — a missing transition or expired token must
            # not poison the agent run. The warning level is enough to
            # surface real problems via standard log alerting.
            logger.warning(
                'WorkflowSync %s failed for task %s: %s',
                logical, task.id, exc,
            )

    @staticmethod
    def _resolve_candidates(config: Any, source: str, logical: str) -> list[str]:
        """Return an ordered candidate list for the logical state.
        Per-org override (``extra_config.workflow_states.<logical>``)
        is tried first, then the built-in synonym list. Override may
        be a string (single name) or a list (explicit ordering)."""
        override: list[str] = []
        extra = getattr(config, 'extra_config', None)
        if isinstance(extra, str):
            try:
                extra = json.loads(extra)
            except Exception:
                extra = None
        if isinstance(extra, dict):
            ws = extra.get('workflow_states') or {}
            if isinstance(ws, dict):
                raw = ws.get(logical)
                if isinstance(raw, str) and raw.strip():
                    override = [raw.strip()]
                elif isinstance(raw, list):
                    override = [str(x).strip() for x in raw if isinstance(x, str) and str(x).strip()]
        defaults = _DEFAULTS.get(source, {}).get(logical, [])
        # Preserve order; drop dupes (override wins for ranking).
        seen: set[str] = set()
        out: list[str] = []
        for name in override + defaults:
            key = name.casefold()
            if key in seen:
                continue
            seen.add(key)
            out.append(name)
        return out
