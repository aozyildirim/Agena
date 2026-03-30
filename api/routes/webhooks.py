from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db_session
from core.settings import get_settings
from models.task_record import TaskRecord
from services.flow_executor import run_pr_feedback_autofix

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

