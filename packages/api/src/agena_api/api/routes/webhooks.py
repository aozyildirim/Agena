from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import logging

from agena_core.database import get_db_session
from agena_core.settings import get_settings
from agena_models.models.task_record import TaskRecord
from agena_services.services.flow_executor import run_pr_feedback_autofix

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/webhooks', tags=['webhooks'])


def _extract_pr_url(payload: dict[str, Any]) -> str:
    pr_url = str(payload.get('pr_url') or '').strip()
    if pr_url:
        return pr_url

    # Azure DevOps service hook shape.
    resource = payload.get('resource') if isinstance(payload.get('resource'), dict) else {}
    pull_request = resource.get('pullRequest') if isinstance(resource.get('pullRequest'), dict) else {}
    for candidate in (
        pull_request.get('url'),
        resource.get('url'),
        (resource.get('_links') or {}).get('web', {}).get('href') if isinstance(resource.get('_links'), dict) else None,
    ):
        url = str(candidate or '').strip()
        if url:
            return url

    # GitHub issue_comment / pull_request_review shapes.
    issue = payload.get('issue') if isinstance(payload.get('issue'), dict) else {}
    issue_pr = issue.get('pull_request') if isinstance(issue.get('pull_request'), dict) else {}
    pr = payload.get('pull_request') if isinstance(payload.get('pull_request'), dict) else {}
    for candidate in (
        issue.get('html_url'),
        issue_pr.get('html_url'),
        issue_pr.get('url'),
        pr.get('html_url'),
        pr.get('url'),
    ):
        url = str(candidate or '').strip()
        if url:
            return url
    return ''


def _extract_comment_text(payload: dict[str, Any]) -> str:
    resource = payload.get('resource') if isinstance(payload.get('resource'), dict) else {}
    comments = resource.get('comments')
    if isinstance(comments, list) and comments:
        last = comments[-1]
        if isinstance(last, dict):
            txt = str(last.get('content') or '').strip()
            if txt:
                return txt

    for key in ('comment', 'review'):
        obj = payload.get(key)
        if isinstance(obj, dict):
            txt = str(obj.get('body') or obj.get('content') or '').strip()
            if txt:
                return txt
    return ''


def _extract_pr_id(pr_url: str) -> str | None:
    for pattern in (r'/pullRequests/(\d+)', r'/pullrequest/(\d+)', r'/pull/(\d+)'):
        m = re.search(pattern, pr_url, flags=re.IGNORECASE)
        if m:
            return m.group(1)
    return None


@router.post('/pr-comment')
async def pr_comment_webhook(
    request: Request,
    x_agena_webhook_secret: str | None = Header(default=None, alias='X-Agena-Webhook-Secret'),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    settings = get_settings()
    expected = (settings.pr_webhook_secret or '').strip()
    if expected:
        provided = (x_agena_webhook_secret or '').strip()
        if provided != expected:
            raise HTTPException(status_code=401, detail='Invalid webhook secret')

    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail='Invalid payload')

    pr_url = _extract_pr_url(payload)
    if not pr_url:
        raise HTTPException(status_code=400, detail='PR URL not found in payload')

    comment_text = _extract_comment_text(payload)
    if comment_text and 'agena pr review' in comment_text.lower():
        return {'status': 'ignored', 'reason': 'bot_comment', 'pr_url': pr_url}

    task_result = await db.execute(select(TaskRecord).where(TaskRecord.pr_url == pr_url).order_by(TaskRecord.id.desc()))
    task_row = task_result.scalar_one_or_none()

    if task_row is None:
        pr_id = _extract_pr_id(pr_url)
        if pr_id:
            fallback_result = await db.execute(
                select(TaskRecord).where(
                    or_(
                        TaskRecord.pr_url.ilike(f'%/pullRequests/{pr_id}%'),
                        TaskRecord.pr_url.ilike(f'%/pullrequest/{pr_id}%'),
                        TaskRecord.pr_url.ilike(f'%/pull/{pr_id}%'),
                    )
                ).order_by(TaskRecord.id.desc())
            )
            task_row = fallback_result.scalar_one_or_none()

    if task_row is None:
        return {'status': 'ignored', 'reason': 'task_not_found', 'pr_url': pr_url}

    result = await run_pr_feedback_autofix(
        db=db,
        organization_id=task_row.organization_id,
        task_id=task_row.id,
        pr_url=pr_url,
    )
    return {
        'status': 'ok',
        'task_id': task_row.id,
        'organization_id': task_row.organization_id,
        'pr_url': pr_url,
        'review_result': result,
    }


def _is_pr_merged(payload: dict[str, Any]) -> bool:
    """Detect if the webhook payload indicates a PR was merged/completed."""
    # Azure DevOps: eventType = "git.pullrequest.merged" or resource.status = "completed"
    event_type = str(payload.get('eventType') or '').strip()
    if 'merged' in event_type or 'completed' in event_type:
        return True
    resource = payload.get('resource') if isinstance(payload.get('resource'), dict) else {}
    if str(resource.get('status') or '').lower() in ('completed', 'merged'):
        return True
    pr = resource.get('pullRequest') if isinstance(resource.get('pullRequest'), dict) else {}
    if str(pr.get('status') or '').lower() in ('completed', 'merged'):
        return True
    # GitHub: action = "closed" + merged = true
    action = str(payload.get('action') or '').strip()
    gh_pr = payload.get('pull_request') if isinstance(payload.get('pull_request'), dict) else {}
    if action == 'closed' and gh_pr.get('merged') is True:
        return True
    return False


@router.post('/pr-merged')
async def pr_merged_webhook(
    request: Request,
    x_agena_webhook_secret: str | None = Header(default=None, alias='X-Agena-Webhook-Secret'),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Handle PR merge/complete webhook — auto-resolve linked Sentry issues."""
    settings = get_settings()
    expected = (settings.pr_webhook_secret or '').strip()
    if expected:
        provided = (x_agena_webhook_secret or '').strip()
        if provided != expected:
            raise HTTPException(status_code=401, detail='Invalid webhook secret')

    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail='Invalid payload')

    if not _is_pr_merged(payload):
        return {'status': 'ignored', 'reason': 'not_a_merge_event'}

    pr_url = _extract_pr_url(payload)
    if not pr_url:
        return {'status': 'ignored', 'reason': 'no_pr_url'}

    # Find task by PR URL
    task_result = await db.execute(
        select(TaskRecord).where(TaskRecord.pr_url == pr_url).order_by(TaskRecord.id.desc())
    )
    task = task_result.scalar_one_or_none()

    if task is None:
        pr_id = _extract_pr_id(pr_url)
        if pr_id:
            fallback = await db.execute(
                select(TaskRecord).where(
                    or_(
                        TaskRecord.pr_url.ilike(f'%/pullRequests/{pr_id}%'),
                        TaskRecord.pr_url.ilike(f'%/pullrequest/{pr_id}%'),
                        TaskRecord.pr_url.ilike(f'%/pull/{pr_id}%'),
                    )
                ).order_by(TaskRecord.id.desc())
            )
            task = fallback.scalar_one_or_none()

    if task is None:
        return {'status': 'ignored', 'reason': 'task_not_found', 'pr_url': pr_url}

    result: dict[str, Any] = {
        'status': 'ok',
        'task_id': task.id,
        'pr_url': pr_url,
        'sentry_resolved': False,
    }

    # Auto-resolve Sentry issue if task is sourced from Sentry
    if task.source == 'sentry' and task.external_id:
        try:
            from agena_services.services.integration_config_service import IntegrationConfigService
            from agena_services.integrations.sentry_client import SentryClient

            config = await IntegrationConfigService(db).get_config(task.organization_id, 'sentry')
            if config and config.secret:
                extra = config.extra_config or {}
                org_slug = str(extra.get('organization_slug') or '').strip()
                if org_slug:
                    parts = task.external_id.split(':', 1)
                    issue_id = parts[1] if len(parts) > 1 else parts[0]
                    sentry_cfg = {'api_token': config.secret, 'base_url': config.base_url or 'https://sentry.io/api/0'}
                    client = SentryClient()
                    await client.update_issue_status(sentry_cfg, organization_slug=org_slug, issue_id=issue_id, status='resolved')
                    await client.add_issue_comment(sentry_cfg, organization_slug=org_slug, issue_id=issue_id,
                        text=f'✅ **Agena** — PR merged, issue auto-resolved.\n\n[PR #{task.id}: {task.title}]({pr_url})')
                    # Update task description
                    if task.description:
                        import re as _re
                        task.description = _re.sub(r'Status: \w+', 'Status: resolved', task.description, count=1)
                        await db.commit()
                    result['sentry_resolved'] = True
                    logger.info('Auto-resolved Sentry issue %s after PR merge for task #%s', issue_id, task.id)
        except Exception as exc:
            logger.warning('Failed to auto-resolve Sentry issue for task #%s: %s', task.id, exc)
            result['sentry_error'] = str(exc)

    # Mirror the merge to the upstream tracker (Jira / Azure) so the
    # ticket lands in its terminal state without any manual click.
    # Separate try/except so a sync failure can't mask the Sentry
    # resolve result that was already returned above.
    if task.source in ('jira', 'azure') and task.external_id:
        try:
            from agena_services.services.workflow_sync_service import WorkflowSyncService
            await WorkflowSyncService(db).on_pr_merged(task)
            result['workflow_synced'] = True
        except Exception as exc:
            logger.warning('Workflow sync (pr_merged) failed for task #%s: %s', task.id, exc)
            result['workflow_sync_error'] = str(exc)

    return result
