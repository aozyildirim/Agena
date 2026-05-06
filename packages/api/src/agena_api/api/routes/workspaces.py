"""Workspace API: create, join, list, member management."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant, require_workspace_perm
from agena_core.database import get_db_session
from agena_services.services.workspace_service import WorkspaceService

router = APIRouter(prefix='/workspaces', tags=['workspaces'])


async def _require_workspace_perm(
    db: AsyncSession,
    tenant: CurrentTenant,
    workspace_id: int,
    permission: str,
) -> None:
    """Inline perm check for routes whose target workspace differs from the
    one in ``X-Workspace-Id``. Org owner short-circuits.
    """
    if (tenant.role or '').lower() == 'owner':
        return
    from agena_services.services.workspace_role_service import WorkspaceRoleService
    perms = await WorkspaceRoleService(db).get_user_permissions(
        user_id=tenant.user_id,
        workspace_id=workspace_id,
        organization_id=tenant.organization_id,
    )
    if permission not in perms:
        raise HTTPException(status_code=403, detail=f'Permission denied: {permission}')


class WorkspaceItem(BaseModel):
    id: int
    name: str
    slug: str
    description: Optional[str] = None
    invite_code: str
    is_default: bool
    created_at: datetime


class WorkspaceMemberItem(BaseModel):
    user_id: int
    email: str
    full_name: str
    role: str
    role_id: Optional[int] = None
    role_name: Optional[str] = None
    title: Optional[str] = None
    joined_at: datetime


class CreateWorkspaceRequest(BaseModel):
    name: str
    description: Optional[str] = None
    slug: Optional[str] = None


class JoinWorkspaceRequest(BaseModel):
    invite_code: str
    title: Optional[str] = None


class UpdateWorkspaceRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class UpdateMemberRequest(BaseModel):
    title: Optional[str] = None


@router.get('', response_model=list[WorkspaceItem])
async def list_workspaces(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[WorkspaceItem]:
    service = WorkspaceService(db)
    rows = await service.list_for_user(user_id=tenant.user_id, organization_id=tenant.organization_id)
    return [
        WorkspaceItem(
            id=ws.id, name=ws.name, slug=ws.slug, description=ws.description,
            invite_code=ws.invite_code, is_default=ws.is_default, created_at=ws.created_at,
        )
        for ws in rows
    ]


@router.post('', response_model=WorkspaceItem)
async def create_workspace(
    payload: CreateWorkspaceRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> WorkspaceItem:
    service = WorkspaceService(db)
    try:
        ws = await service.create(
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            name=payload.name,
            description=payload.description,
            slug=payload.slug,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return WorkspaceItem(
        id=ws.id, name=ws.name, slug=ws.slug, description=ws.description,
        invite_code=ws.invite_code, is_default=ws.is_default, created_at=ws.created_at,
    )


@router.post('/join', response_model=WorkspaceItem)
async def join_workspace(
    payload: JoinWorkspaceRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> WorkspaceItem:
    service = WorkspaceService(db)
    try:
        ws = await service.join_by_code(
            user_id=tenant.user_id,
            invite_code=payload.invite_code,
            title=payload.title,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return WorkspaceItem(
        id=ws.id, name=ws.name, slug=ws.slug, description=ws.description,
        invite_code=ws.invite_code, is_default=ws.is_default, created_at=ws.created_at,
    )


@router.put('/{workspace_id}', response_model=WorkspaceItem, dependencies=[Depends(require_workspace_perm('workspace:manage'))])
async def update_workspace(
    workspace_id: int,
    payload: UpdateWorkspaceRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> WorkspaceItem:
    service = WorkspaceService(db)
    try:
        ws = await service.update(
            workspace_id=workspace_id,
            organization_id=tenant.organization_id,
            name=payload.name,
            description=payload.description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return WorkspaceItem(
        id=ws.id, name=ws.name, slug=ws.slug, description=ws.description,
        invite_code=ws.invite_code, is_default=ws.is_default, created_at=ws.created_at,
    )


@router.delete('/{workspace_id}', dependencies=[Depends(require_workspace_perm('workspace:delete'))])
async def delete_workspace(
    workspace_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    service = WorkspaceService(db)
    try:
        await service.delete(workspace_id=workspace_id, organization_id=tenant.organization_id)
    except ValueError as exc:
        msg = str(exc)
        status = 404 if 'not found' in msg.lower() else 400
        raise HTTPException(status_code=status, detail=msg) from exc
    return {'ok': True}


@router.get('/{workspace_id}/members', response_model=list[WorkspaceMemberItem])
async def list_members(
    workspace_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[WorkspaceMemberItem]:
    service = WorkspaceService(db)
    ws = await service.get(workspace_id=workspace_id, organization_id=tenant.organization_id)
    if ws is None:
        raise HTTPException(status_code=404, detail='Workspace not found')
    if not await service.is_member(workspace_id=workspace_id, user_id=tenant.user_id):
        raise HTTPException(status_code=403, detail='Not a workspace member')
    members = await service.list_members_with_roles(workspace_id)
    return [
        WorkspaceMemberItem(
            user_id=member.user_id,
            email=user.email,
            full_name=user.full_name or '',
            role=member.role,
            role_id=member.role_id,
            role_name=role_name,
            title=member.title,
            joined_at=member.joined_at,
        )
        for member, user, role_name in members
    ]


@router.put('/{workspace_id}/members/{user_id}', response_model=WorkspaceMemberItem)
async def update_member(
    workspace_id: int,
    user_id: int,
    payload: UpdateMemberRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> WorkspaceMemberItem:
    service = WorkspaceService(db)
    ws = await service.get(workspace_id=workspace_id, organization_id=tenant.organization_id)
    if ws is None:
        raise HTTPException(status_code=404, detail='Workspace not found')
    # Self-edits (titles, etc.) are always allowed; editing someone else
    # needs the management permission.
    if user_id != tenant.user_id:
        await _require_workspace_perm(db, tenant, workspace_id, 'members:assign-role')
    try:
        await service.update_member_title(workspace_id=workspace_id, user_id=user_id, title=payload.title)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    members = await service.list_members(workspace_id)
    for member, user in members:
        if member.user_id == user_id:
            return WorkspaceMemberItem(
                user_id=user_id,
                email=user.email,
                full_name=user.full_name or '',
                role=member.role,
                title=member.title,
                joined_at=member.joined_at,
            )
    raise HTTPException(status_code=404, detail='Member not found')


@router.delete('/{workspace_id}/members/{user_id}')
async def remove_member(
    workspace_id: int,
    user_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    service = WorkspaceService(db)
    ws = await service.get(workspace_id=workspace_id, organization_id=tenant.organization_id)
    if ws is None:
        raise HTTPException(status_code=404, detail='Workspace not found')
    # Self-removal is allowed (treat as "leave workspace"); removing someone
    # else requires the management permission.
    if user_id != tenant.user_id:
        await _require_workspace_perm(db, tenant, workspace_id, 'members:remove')
    # The org owner's seat is anchored — removing them from a workspace
    # would orphan the workspace and make the org owner lose visibility into
    # their own org. Block server-side regardless of permission.
    from agena_models.models.organization_member import OrganizationMember
    from sqlalchemy import select
    target_om = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == tenant.organization_id,
            OrganizationMember.user_id == user_id,
        )
    )
    target_member = target_om.scalar_one_or_none()
    if target_member is not None and (target_member.role or '').lower() == 'owner':
        raise HTTPException(status_code=400, detail='Cannot remove the organization owner')
    await service.remove_member(workspace_id=workspace_id, user_id=user_id)
    return {'ok': True}


@router.post('/{workspace_id}/regenerate-code', response_model=WorkspaceItem)
async def regenerate_code(
    workspace_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> WorkspaceItem:
    service = WorkspaceService(db)
    ws = await service.get(workspace_id=workspace_id, organization_id=tenant.organization_id)
    if ws is None:
        raise HTTPException(status_code=404, detail='Workspace not found')
    await _require_workspace_perm(db, tenant, workspace_id, 'workspace:invite')
    await service.regenerate_invite_code(workspace_id)
    refreshed = await service.get(workspace_id=workspace_id, organization_id=tenant.organization_id)
    assert refreshed is not None
    return WorkspaceItem(
        id=refreshed.id, name=refreshed.name, slug=refreshed.slug, description=refreshed.description,
        invite_code=refreshed.invite_code, is_default=refreshed.is_default, created_at=refreshed.created_at,
    )
