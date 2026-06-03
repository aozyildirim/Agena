"""Token-based shareable invite links for workspaces.

Two routers are exposed:
  * ``router`` — auth-required management endpoints under ``/workspaces``
  * ``public_router`` — unauthenticated preview / accept hooks under ``/invites``

The split keeps the public surface small and easy to audit: only token
preview is anonymous; accepting still needs a logged-in caller (the signup
flow handles the unauthenticated case by minting a user first).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant, require_workspace_perm
from agena_core.database import get_db_session
from agena_services.services.workspace_invite_service import WorkspaceInviteService


router = APIRouter(prefix='/workspaces', tags=['workspaces'])
public_router = APIRouter(prefix='/invites', tags=['workspaces'])


class InviteLinkItem(BaseModel):
    id: int
    token: str
    workspace_id: int
    role_id: Optional[int] = None
    role_name: Optional[str] = None
    max_uses: Optional[int] = None
    uses: int
    expires_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    created_at: datetime


class CreateInviteRequest(BaseModel):
    role_id: Optional[int] = None
    max_uses: Optional[int] = None
    expires_at: Optional[datetime] = None


class InvitePreview(BaseModel):
    workspace_id: int
    workspace_name: str
    workspace_slug: str
    organization_id: int
    organization_name: str
    organization_slug: str
    role_id: Optional[int] = None
    role_name: Optional[str] = None
    expires_at: Optional[datetime] = None
    uses: int
    max_uses: Optional[int] = None


@router.post(
    '/{workspace_id}/invites',
    response_model=InviteLinkItem,
    dependencies=[Depends(require_workspace_perm('workspace:invite'))],
)
async def create_invite(
    workspace_id: int,
    payload: CreateInviteRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> InviteLinkItem:
    service = WorkspaceInviteService(db)
    try:
        link = await service.create(
            workspace_id=workspace_id,
            organization_id=tenant.organization_id,
            created_by_user_id=tenant.user_id,
            role_id=payload.role_id,
            max_uses=payload.max_uses,
            expires_at=payload.expires_at,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return InviteLinkItem(
        id=link.id, token=link.token, workspace_id=link.workspace_id,
        role_id=link.role_id, role_name=None,
        max_uses=link.max_uses, uses=link.uses,
        expires_at=link.expires_at, revoked_at=link.revoked_at, created_at=link.created_at,
    )


@router.get('/{workspace_id}/invites', response_model=list[InviteLinkItem])
async def list_invites(
    workspace_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[InviteLinkItem]:
    from sqlalchemy import select
    from agena_models.models.workspace import Workspace
    from agena_models.models.workspace_invite_link import WorkspaceInviteLink
    from agena_models.models.workspace_role import WorkspaceRole

    ws_check = await db.execute(
        select(Workspace).where(
            Workspace.id == workspace_id,
            Workspace.organization_id == tenant.organization_id,
        )
    )
    if ws_check.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail='Workspace not found')

    rows = await db.execute(
        select(WorkspaceInviteLink, WorkspaceRole)
        .outerjoin(WorkspaceRole, WorkspaceRole.id == WorkspaceInviteLink.role_id)
        .where(WorkspaceInviteLink.workspace_id == workspace_id)
        .order_by(WorkspaceInviteLink.created_at.desc())
    )
    return [
        InviteLinkItem(
            id=link.id, token=link.token, workspace_id=link.workspace_id,
            role_id=link.role_id, role_name=role.name if role is not None else None,
            max_uses=link.max_uses, uses=link.uses,
            expires_at=link.expires_at, revoked_at=link.revoked_at, created_at=link.created_at,
        )
        for link, role in rows.all()
    ]


@router.delete(
    '/invites/{invite_id}',
    dependencies=[Depends(require_workspace_perm('workspace:invite'))],
)
async def revoke_invite(
    invite_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    service = WorkspaceInviteService(db)
    try:
        await service.revoke(invite_id=invite_id, organization_id=tenant.organization_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {'ok': True}


@public_router.get('/{token}/preview', response_model=InvitePreview)
async def preview_invite(
    token: str,
    db: AsyncSession = Depends(get_db_session),
) -> InvitePreview:
    service = WorkspaceInviteService(db)
    try:
        data = await service.resolve_preview(token)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return InvitePreview(**data)


@public_router.post('/{token}/accept')
async def accept_invite(
    token: str,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    service = WorkspaceInviteService(db)
    try:
        ws = await service.accept(token=token, user_id=tenant.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        'ok': True,
        'workspace_id': ws.id,
        'workspace_slug': ws.slug,
        'organization_id': ws.organization_id,
    }
