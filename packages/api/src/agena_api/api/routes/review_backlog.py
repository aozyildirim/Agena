"""/review-backlog — PRs sitting unreviewed past warn/critical thresholds."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_models.models.git_pull_request import GitPullRequest
from agena_models.models.integration_config import IntegrationConfig
from agena_models.models.repo_mapping import RepoMapping
from agena_models.models.review_backlog_nudge import ReviewBacklogNudge
from agena_services.services import review_backlog_service

router = APIRouter(prefix='/review-backlog', tags=['review-backlog'])


class NudgeResponse(BaseModel):
    id: int
    pr_id: int
    pr_external_id: str | None = None
    pr_title: str | None = None
    pr_author: str | None = None
    pr_provider: str | None = None
    pr_status: str | None = None  # active / abandoned / completed / open / closed (provider-dependent)
    pr_url: str | None = None  # human-friendly link rendered on the row title
    repo_mapping_id: str | None = None
    repo_display_name: str | None = None
    age_hours: int
    severity: str | None = None
    nudge_count: int
    last_nudged_at: datetime | None = None
    last_nudge_channel: str | None = None
    escalated_at: datetime | None = None
    resolved_at: datetime | None = None


class NudgeRequest(BaseModel):
    channel: str = 'slack_dm'  # slack_dm | email | manual


def _build_pr_url(
    *,
    provider: str | None,
    pr_external_id: str | None,
    mapping: RepoMapping | None,
    azure_base_url: str | None,
) -> str | None:
    """Best-effort web URL for a PR row. GitHub is straightforward; Azure
    uses the org's integration_configs.base_url for the org host so it
    works on both dev.azure.com and on-prem TFS."""
    if not pr_external_id or mapping is None:
        return None
    p = (provider or '').strip().lower()
    owner = (mapping.owner or '').strip()
    repo = (mapping.repo_name or '').strip()
    if not owner or not repo:
        return None
    if p == 'github':
        return f'https://github.com/{owner}/{repo}/pull/{pr_external_id}'
    if p == 'azure':
        base = (azure_base_url or '').rstrip('/')
        if not base:
            return None
        # base_url shape: https://dev.azure.com/{org}/  → add project/_git/repo/pullrequest/N
        return f'{base}/{owner}/_git/{repo}/pullrequest/{pr_external_id}'
    return None


@router.get('', response_model=list[NudgeResponse])
async def list_backlog(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
    include_resolved: bool = False,
    limit: int = 100,
) -> list[NudgeResponse]:
    stmt = (
        select(ReviewBacklogNudge, GitPullRequest)
        .join(GitPullRequest, GitPullRequest.id == ReviewBacklogNudge.pr_id)
        .where(ReviewBacklogNudge.organization_id == tenant.organization_id)
        .order_by(desc(ReviewBacklogNudge.age_hours))
        .limit(min(limit, 500))
    )
    if not include_resolved:
        stmt = stmt.where(ReviewBacklogNudge.resolved_at.is_(None))
    rows = (await db.execute(stmt)).all()

    # Resolve repo mappings + the org's azure base URL once for the batch
    # so we can stamp each row with a clickable PR url.
    mapping_ids: set[int] = set()
    for (n, _pr) in rows:
        mid = (n.repo_mapping_id or '').strip()
        if mid.isdigit():
            mapping_ids.add(int(mid))
    mappings_by_id: dict[int, RepoMapping] = {}
    if mapping_ids:
        mrows = (await db.execute(
            select(RepoMapping).where(
                RepoMapping.id.in_(list(mapping_ids)),
                RepoMapping.organization_id == tenant.organization_id,
            )
        )).scalars().all()
        mappings_by_id = {m.id: m for m in mrows}
    azure_cfg = (await db.execute(
        select(IntegrationConfig).where(
            IntegrationConfig.organization_id == tenant.organization_id,
            IntegrationConfig.provider == 'azure',
        )
    )).scalar_one_or_none()
    azure_base_url = azure_cfg.base_url if azure_cfg else None

    out: list[NudgeResponse] = []
    for (n, pr) in rows:
        m_id = (n.repo_mapping_id or '').strip()
        m = mappings_by_id.get(int(m_id)) if m_id.isdigit() else None
        pr_url = _build_pr_url(
            provider=pr.provider, pr_external_id=pr.external_id,
            mapping=m, azure_base_url=azure_base_url,
        )
        repo_display = ''
        if m:
            repo_display = f'{(m.provider or "").lower()}:{m.owner}/{m.repo_name}'
        out.append(NudgeResponse(
            id=n.id, pr_id=n.pr_id,
            pr_external_id=pr.external_id, pr_title=pr.title, pr_author=pr.author,
            pr_provider=pr.provider, pr_status=pr.status, pr_url=pr_url,
            repo_mapping_id=n.repo_mapping_id, repo_display_name=repo_display or None,
            age_hours=n.age_hours, severity=n.severity, nudge_count=n.nudge_count,
            last_nudged_at=n.last_nudged_at, last_nudge_channel=n.last_nudge_channel,
            escalated_at=n.escalated_at, resolved_at=n.resolved_at,
        ))
    return out


@router.post('/scan')
async def scan_now(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    return await review_backlog_service.scan_for_org(db, tenant.organization_id)


@router.post('/{nudge_id}/nudge')
async def nudge(
    nudge_id: int,
    body: NudgeRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    try:
        n, status = await review_backlog_service.record_nudge(
            db, nudge_id,
            organization_id=tenant.organization_id,
            channel=body.channel,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {
        'ok': status != 'rate_limited',
        'status': status,  # sent | rate_limited | comment_failed
        'nudge_count': n.nudge_count,
        'last_nudged_at': n.last_nudged_at.isoformat() if n.last_nudged_at else None,
    }
