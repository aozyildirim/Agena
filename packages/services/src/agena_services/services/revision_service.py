"""Revision (follow-up) service — turns a "fix this small thing"
instruction on a completed task into one or more queued worker jobs
that re-use the existing branch + PR instead of opening fresh ones.

Lives entirely on top of TaskRevision rows + the existing
`agent_tasks` queue; no new lock layer (the worker reuses the per-repo
lock with `revision:<id>` as the owner).

The merged-PR check is best-effort: we ask the SCM provider once and
cache the answer onto `assignment.status='merged'`, so subsequent
calls skip the API hop. A stale cache self-corrects on the next probe
(we still call the API the first time the user clicks Revise on each
assignment).
"""
from __future__ import annotations

import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.task_record import TaskRecord
from agena_models.models.task_repo_assignment import TaskRepoAssignment
from agena_models.models.task_revision import TaskRevision
from agena_models.models.repo_mapping import RepoMapping

from agena_services.services.queue_service import QueueService

logger = logging.getLogger(__name__)


# What COUNTS as "currently in flight" — the only states we refuse to
# stack a revision on top of, because doing so would race the worker.
# Everything else (completed, failed, cancelled, even a fresh-after-
# error 'new') is fine: the only real prerequisite is that there is a
# branch on the remote we can land an additional commit onto, and that
# is checked per-assignment via branch_name below.
REVISE_BLOCKING_TASK_STATUSES = {'queued', 'running', 'revising'}
REVISE_BLOCKING_ASSIGNMENT_STATUSES = {'queued', 'running', 'revising'}


class RevisionService:
    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session
        self.queue_service = QueueService()

    async def request_revision(
        self,
        *,
        organization_id: int,
        task_id: int,
        user_id: int | None,
        instruction: str,
        repo_assignment_ids: list[int] | None,
        agent_model: str | None,
        agent_provider: str | None,
    ) -> list[TaskRevision]:
        """Validate, fan out, enqueue. Returns the newly-created
        TaskRevision rows (some may be in `skipped_merged` state — the
        UI surfaces those without queueing).
        """
        instruction = (instruction or '').strip()
        if len(instruction) < 3:
            raise ValueError('instruction is too short')

        task = await self.db_session.get(TaskRecord, task_id)
        if task is None or task.organization_id != organization_id:
            raise ValueError('Task not found')
        if (task.status or '') in REVISE_BLOCKING_TASK_STATUSES:
            raise ValueError(
                f"Task #{task_id} is currently '{task.status}' — wait for it "
                "to finish before requesting a revision."
            )

        # Resolve target assignments. Multi-repo tasks may have several;
        # a legacy single-repo task may have zero assignment rows (we
        # still allow revision in that case via a None assignment_id —
        # the orchestration layer reads task.branch_name as fallback).
        all_assignments = (await self.db_session.execute(
            select(TaskRepoAssignment).where(
                TaskRepoAssignment.task_id == task_id,
                TaskRepoAssignment.organization_id == organization_id,
            )
        )).scalars().all()

        target_assignments: list[TaskRepoAssignment] = []
        if repo_assignment_ids is not None:
            wanted = set(int(x) for x in repo_assignment_ids)
            target_assignments = [a for a in all_assignments if a.id in wanted]
            missing = wanted - {a.id for a in target_assignments}
            if missing:
                raise ValueError(f'assignments not found on this task: {sorted(missing)}')
        else:
            # Default: every assignment that has a branch on the remote
            # (branch_name set), is not currently in flight, and is not
            # already merged. Branch_name is the real prerequisite —
            # no branch means there's nothing to amend.
            target_assignments = [
                a for a in all_assignments
                if a.branch_name
                and (a.status or '').lower() not in REVISE_BLOCKING_ASSIGNMENT_STATUSES
                and (a.status or '').lower() != 'merged'
            ]

        revisions: list[TaskRevision] = []

        # Single-repo legacy task — no assignment rows. Queue a
        # revision with assignment_id=None so the worker uses
        # task.branch_name / task.pr_url directly.
        if not all_assignments and not target_assignments:
            if not task.branch_name:
                raise ValueError('Task has no recorded branch — open a fresh task instead.')
            rev = TaskRevision(
                task_id=task_id,
                organization_id=organization_id,
                assignment_id=None,
                requested_by_user_id=user_id,
                instruction=instruction,
                status='queued',
            )
            self.db_session.add(rev)
            await self.db_session.flush()
            await self.queue_service.enqueue({
                'organization_id': organization_id,
                'task_id': task_id,
                'assignment_id': None,
                'revision_id': rev.id,
                'revision_instruction': instruction,
                'create_pr': False,
                'mode': 'mcp_agent',
                'agent_model': agent_model or task.last_agent_model if hasattr(task, 'last_agent_model') else agent_model,
                'agent_provider': agent_provider or 'claude_cli',
            })
            revisions.append(rev)
            await self.db_session.commit()
            return revisions

        if not target_assignments:
            raise ValueError(
                'No revisable assignments found (all merged or already running). '
                'Open a fresh task if the PR is already merged.'
            )

        # Per-target queue. Skip if PR was already merged on this branch
        # — at that point the user wants a fresh task, not a hot-fix
        # commit on a closed PR.
        for assignment in target_assignments:
            if (assignment.status or '').lower() in REVISE_BLOCKING_ASSIGNMENT_STATUSES:
                rev = self._make_revision_row(
                    task_id, organization_id, assignment.id, user_id, instruction,
                    status='skipped_running',
                    failure_reason='Assignment already has a run in flight.',
                )
                self.db_session.add(rev)
                revisions.append(rev)
                continue

            if not assignment.branch_name:
                rev = self._make_revision_row(
                    task_id, organization_id, assignment.id, user_id, instruction,
                    status='failed',
                    failure_reason='Assignment has no branch_name on record — original run never pushed.',
                )
                self.db_session.add(rev)
                revisions.append(rev)
                continue

            if await self._is_pr_merged(assignment, organization_id):
                # Cache hit so the next call skips the round-trip.
                if (assignment.status or '').lower() != 'merged':
                    assignment.status = 'merged'
                rev = self._make_revision_row(
                    task_id, organization_id, assignment.id, user_id, instruction,
                    status='skipped_merged',
                    failure_reason='PR is already merged — open a fresh task to amend.',
                )
                self.db_session.add(rev)
                revisions.append(rev)
                continue

            rev = self._make_revision_row(
                task_id, organization_id, assignment.id, user_id, instruction,
                status='queued',
            )
            self.db_session.add(rev)
            revisions.append(rev)
            assignment.status = 'revising'

        # Bulk-flush so we have IDs before we enqueue payloads.
        await self.db_session.flush()
        for rev in revisions:
            if rev.status != 'queued':
                continue
            await self.queue_service.enqueue({
                'organization_id': organization_id,
                'task_id': task_id,
                'assignment_id': rev.assignment_id,
                'revision_id': rev.id,
                'revision_instruction': instruction,
                'create_pr': False,  # the open PR auto-updates on push
                'mode': 'mcp_agent',
                'agent_model': agent_model,
                'agent_provider': agent_provider or 'claude_cli',
            })

        # Set the parent task to a "revising" macro-status so the UI can
        # show a banner. The worker flips it back to completed at end.
        task.status = 'revising'
        await self.db_session.commit()
        return revisions

    async def list_revisions(
        self, *, organization_id: int, task_id: int,
    ) -> list[TaskRevision]:
        rows = (await self.db_session.execute(
            select(TaskRevision).where(
                TaskRevision.task_id == task_id,
                TaskRevision.organization_id == organization_id,
            ).order_by(TaskRevision.id.desc())
        )).scalars().all()
        return list(rows)

    # ── internals ────────────────────────────────────────────────────────

    def _make_revision_row(
        self, task_id: int, organization_id: int,
        assignment_id: int | None, user_id: int | None,
        instruction: str, *, status: str,
        failure_reason: str | None = None,
    ) -> TaskRevision:
        return TaskRevision(
            task_id=task_id,
            organization_id=organization_id,
            assignment_id=assignment_id,
            requested_by_user_id=user_id,
            instruction=instruction,
            status=status,
            failure_reason=failure_reason,
        )

    async def _is_pr_merged(
        self, assignment: TaskRepoAssignment, organization_id: int,
    ) -> bool:
        """Best-effort merge probe. Returns False when we can't tell —
        better to let the user attempt a revision than block them on a
        flaky API call. The worker's push will fail gracefully if the
        branch has been deleted."""
        if (assignment.status or '').lower() == 'merged':
            return True
        url = (assignment.pr_url or '').strip()
        if not url:
            return False
        # Resolve the repo mapping so we know which integration to ask.
        if not assignment.repo_mapping_id:
            return False
        repo_mapping = await self.db_session.get(RepoMapping, assignment.repo_mapping_id)
        if repo_mapping is None:
            return False
        try:
            if (repo_mapping.provider or '').lower() == 'github':
                return await self._is_github_pr_merged(url, organization_id)
            if (repo_mapping.provider or '').lower() == 'azure':
                return await self._is_azure_pr_merged(url, repo_mapping, organization_id)
            if (repo_mapping.provider or '').lower() == 'gitlab':
                return await self._is_gitlab_mr_merged(url, organization_id)
        except Exception as exc:
            logger.info('PR merge probe failed for %s: %s', url, exc)
        return False

    async def _is_github_pr_merged(self, pr_url: str, organization_id: int) -> bool:
        from agena_services.services.integration_config_service import IntegrationConfigService
        m = re.match(r'https?://github\.com/([^/]+)/([^/]+)/pull/(\d+)', pr_url)
        if not m:
            return False
        owner, repo, num = m.group(1), m.group(2), int(m.group(3))
        cfg = await IntegrationConfigService(self.db_session).get_config(organization_id, 'github')
        if cfg is None or not cfg.secret:
            return False
        import httpx
        api = f'https://api.github.com/repos/{owner}/{repo}/pulls/{num}'
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(api, headers={
                'Authorization': f'Bearer {cfg.secret}',
                'Accept': 'application/vnd.github+json',
            })
        if resp.status_code != 200:
            return False
        data = resp.json() or {}
        return bool(data.get('merged'))

    async def _is_gitlab_mr_merged(self, pr_url: str, organization_id: int) -> bool:
        from agena_services.services.integration_config_service import IntegrationConfigService
        from agena_services.services.remote_repo_service import RemoteRepoService, parse_gitlab_mr_url

        parsed = parse_gitlab_mr_url(pr_url)
        if parsed is None:
            return False
        project_path, mr_iid = parsed
        cfg = await IntegrationConfigService(self.db_session).get_config(organization_id, 'gitlab')
        if cfg is None or not cfg.secret:
            return False
        import httpx
        api = f'{RemoteRepoService.gitlab_project_api(cfg.base_url, project_path)}/merge_requests/{mr_iid}'
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(api, headers={'PRIVATE-TOKEN': cfg.secret})
        if resp.status_code != 200:
            return False
        return str((resp.json() or {}).get('state') or '') == 'merged'

    async def _is_azure_pr_merged(
        self, pr_url: str, repo_mapping: RepoMapping, organization_id: int,
    ) -> bool:
        from agena_services.services.integration_config_service import IntegrationConfigService
        m = re.search(r'/pullrequest/(\d+)', pr_url)
        if not m:
            return False
        pr_id = int(m.group(1))
        cfg = await IntegrationConfigService(self.db_session).get_config(organization_id, 'azure')
        if cfg is None or not cfg.secret or not cfg.base_url:
            return False
        import base64
        import httpx
        auth = base64.b64encode(f':{cfg.secret}'.encode()).decode()
        api = (
            f'{cfg.base_url.rstrip("/")}/{repo_mapping.owner}/_apis/git/repositories/'
            f'{repo_mapping.repo_name}/pullRequests/{pr_id}?api-version=7.1-preview.1'
        )
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(api, headers={
                'Authorization': f'Basic {auth}',
                'Accept': 'application/json',
            })
        if resp.status_code != 200:
            return False
        data = resp.json() or {}
        # Azure: status='completed' means merged; 'abandoned' / 'active' means not.
        return str(data.get('status') or '').lower() == 'completed'
