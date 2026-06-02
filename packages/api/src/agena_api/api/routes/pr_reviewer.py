"""PR Reviewer routes — live AI inline code review of pull requests.

Gated behind the `pr_reviewer` module (toggled on /dashboard/modules). The
review itself runs in the background (LLM calls are slow); the frontend polls
/pr-reviewer/history for status.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import SessionLocal, get_db_session
from agena_services.services import pr_review_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/pr-reviewer', tags=['pr-reviewer'])

# Keep background review tasks referenced so the GC can't cancel them mid-run.
_TASKS: set[asyncio.Task] = set()


class OpenPrItem(BaseModel):
    id: str
    title: str
    author: str
    source_branch: str
    target_branch: str
    created: str
    url: str


class ReviewRequest(BaseModel):
    repo_mapping_id: int
    pr_id: str
    source_branch: str
    pr_url: str | None = None
    title: str | None = None


class PrReviewItem(BaseModel):
    id: int
    provider: str
    repo: str
    pr_number: str
    pr_url: str | None = None
    title: str | None = None
    status: str
    severity: str | None = None
    score: int | None = None
    findings_count: int
    threads_posted: int
    threads_open: int
    reviewer_provider: str | None = None
    reviewer_model: str | None = None
    error_message: str | None = None
    created_at: str
    completed_at: str | None = None


@router.get('/open', response_model=list[OpenPrItem])
async def open_prs(
    repo_mapping_id: int = Query(...),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[OpenPrItem]:
    try:
        rows = await pr_review_service.list_open_prs(db, tenant.organization_id, repo_mapping_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return [OpenPrItem(**r) for r in rows]


@router.post('/review')
async def review(
    payload: ReviewRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    org_id = tenant.organization_id
    user_id = tenant.user_id

    async def _bg() -> None:
        async with SessionLocal() as bg_db:
            try:
                await pr_review_service.review_pr(
                    bg_db,
                    organization_id=org_id,
                    user_id=user_id,
                    repo_mapping_id=payload.repo_mapping_id,
                    pr_id=payload.pr_id,
                    source_branch=payload.source_branch,
                    pr_url=payload.pr_url,
                    title=payload.title,
                )
            except Exception:
                logger.exception('PR review bg task failed for pr=%s', payload.pr_id)

    task = asyncio.create_task(_bg())
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)
    return {'started': True, 'pr_id': payload.pr_id}


@router.get('/history', response_model=list[PrReviewItem])
async def history(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[PrReviewItem]:
    rows = await pr_review_service.list_history(db, tenant.organization_id)
    return [
        PrReviewItem(
            id=r.id, provider=r.provider, repo=r.repo, pr_number=r.pr_number,
            pr_url=r.pr_url, title=r.title, status=r.status, severity=r.severity,
            score=r.score, findings_count=r.findings_count, threads_posted=r.threads_posted,
            threads_open=r.threads_open, reviewer_provider=r.reviewer_provider,
            reviewer_model=r.reviewer_model, error_message=r.error_message,
            created_at=r.created_at.isoformat() if r.created_at else '',
            completed_at=r.completed_at.isoformat() if r.completed_at else None,
        )
        for r in rows
    ]
