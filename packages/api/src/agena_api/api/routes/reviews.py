from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_models.models.task_record import TaskRecord
from agena_models.models.task_review import TaskReview
from agena_services.services.review_service import trigger_review

router = APIRouter(prefix='/reviews', tags=['reviews'])


class TaskReviewResponse(BaseModel):
    id: int
    task_id: int
    task_title: str | None = None
    assignment_id: int | None = None
    repo_display_name: str | None = None
    reviewer_agent_role: str
    reviewer_provider: str | None = None
    reviewer_model: str | None = None
    input_snapshot: str | None = None
    output: str | None = None
    score: int | None = None
    findings_count: int | None = None
    severity: str | None = None
    status: str
    error_message: str | None = None
    requested_by_user_id: int
    created_at: datetime
    completed_at: datetime | None = None


class TriggerReviewRequest(BaseModel):
    task_id: int
    reviewer_agent_role: str = 'reviewer'
    assignment_id: int | None = None


def _to_response(row: TaskReview, task_title: str | None, repo_display_name: str | None = None) -> TaskReviewResponse:
    return TaskReviewResponse(
        id=row.id,
        task_id=row.task_id,
        task_title=task_title,
        assignment_id=getattr(row, 'assignment_id', None),
        repo_display_name=repo_display_name,
        reviewer_agent_role=row.reviewer_agent_role,
        reviewer_provider=row.reviewer_provider,
        reviewer_model=row.reviewer_model,
        input_snapshot=row.input_snapshot,
        output=row.output,
        score=row.score,
        findings_count=row.findings_count,
        severity=row.severity,
        status=row.status,
        error_message=row.error_message,
        requested_by_user_id=row.requested_by_user_id,
        created_at=row.created_at,
        completed_at=row.completed_at,
    )


@router.get('', response_model=list[TaskReviewResponse])
async def list_reviews(
    agent_role: str | None = Query(None),
    severity: str | None = Query(None),
    task_id: int | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[TaskReviewResponse]:
    stmt = (
        select(TaskReview, TaskRecord.title)
        .join(TaskRecord, TaskRecord.id == TaskReview.task_id)
        .where(TaskReview.organization_id == tenant.organization_id)
    )
    if agent_role:
        stmt = stmt.where(TaskReview.reviewer_agent_role == agent_role.strip().lower())
    if severity:
        stmt = stmt.where(TaskReview.severity == severity.strip().lower())
    if task_id is not None:
        stmt = stmt.where(TaskReview.task_id == task_id)
    stmt = stmt.order_by(desc(TaskReview.created_at)).limit(limit)

    rows = (await db.execute(stmt)).all()
    return [_to_response(row[0], row[1]) for row in rows]


@router.get('/{review_id}', response_model=TaskReviewResponse)
async def get_review(
    review_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> TaskReviewResponse:
    row = (await db.execute(
        select(TaskReview, TaskRecord.title)
        .join(TaskRecord, TaskRecord.id == TaskReview.task_id)
        .where(
            TaskReview.id == review_id,
            TaskReview.organization_id == tenant.organization_id,
        )
    )).first()
    if row is None:
        raise HTTPException(status_code=404, detail='Review not found')
    return _to_response(row[0], row[1])


@router.post('', response_model=TaskReviewResponse, status_code=201)
async def trigger_new_review(
    body: TriggerReviewRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> TaskReviewResponse:
    try:
        review = await trigger_review(
            db,
            organization_id=tenant.organization_id,
            task_id=body.task_id,
            requested_by_user_id=tenant.user_id,
            reviewer_agent_role=body.reviewer_agent_role,
            assignment_id=body.assignment_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    task = await db.get(TaskRecord, review.task_id)
    repo_display = None
    if review.assignment_id:
        from agena_models.models.task_repo_assignment import TaskRepoAssignment
        from agena_models.models.repo_mapping import RepoMapping
        assn = await db.get(TaskRepoAssignment, review.assignment_id)
        if assn and assn.repo_mapping_id:
            rm = await db.get(RepoMapping, assn.repo_mapping_id)
            if rm:
                repo_display = f'{(rm.provider or "").lower()}:{rm.owner}/{rm.repo_name}'
    return _to_response(review, task.title if task else None, repo_display)


@router.delete('/{review_id}')
async def delete_review(
    review_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    """Hard-delete a review row. Scoped to the caller's org so users
    can't nuke another tenant's audit trail. Used by the reviews list
    and detail pages so a user can prune false-positive runs."""
    row = (await db.execute(
        select(TaskReview).where(
            TaskReview.id == review_id,
            TaskReview.organization_id == tenant.organization_id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail='Review not found')
    await db.delete(row)
    await db.commit()
    return {'ok': True}


@router.get('/by-task/{task_id}', response_model=list[TaskReviewResponse])
async def list_reviews_for_task(
    task_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[TaskReviewResponse]:
    task = await db.get(TaskRecord, task_id)
    if task is None or task.organization_id != tenant.organization_id:
        raise HTTPException(status_code=404, detail='Task not found')
    rows = (await db.execute(
        select(TaskReview)
        .where(
            TaskReview.task_id == task_id,
            TaskReview.organization_id == tenant.organization_id,
        )
        .order_by(desc(TaskReview.created_at))
    )).scalars().all()
    return [_to_response(r, task.title) for r in rows]
