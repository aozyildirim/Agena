"""Weekly engineering digest: preview it, or send it to yourself now."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, require_permission
from agena_core.database import get_db_session
from agena_services.services.digest_service import WeeklyDigestService
from agena_services.services.digest_text import render

router = APIRouter(prefix='/digest', tags=['digest'])


class DigestPreview(BaseModel):
    title: str
    message: str
    digest: dict[str, Any]


class DigestSent(BaseModel):
    sent: int


@router.get('/weekly/preview', response_model=DigestPreview)
async def weekly_preview(
    tenant: CurrentTenant = Depends(require_permission('digest:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> DigestPreview:
    digest = await WeeklyDigestService(db).build(tenant.organization_id)
    title, message = render(digest)
    return DigestPreview(title=title, message=message, digest=digest)


@router.post('/weekly/send', response_model=DigestSent)
async def weekly_send_to_me(
    tenant: CurrentTenant = Depends(require_permission('digest:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> DigestSent:
    """Send this week's digest to the caller only (the Monday job reaches
    every owner and admin)."""
    sent = await WeeklyDigestService(db).send(tenant.organization_id, user_ids=[tenant.user_id])
    return DigestSent(sent=sent)
