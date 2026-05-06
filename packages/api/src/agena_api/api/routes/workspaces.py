"""Workspace API: create, join, list, member management."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_services.services.workspace_service import WorkspaceService

router = APIRouter(prefix='/workspaces', tags=['workspaces'])


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
    title: Optional[str] = None
    joined_at: datetime


class CreateWorkspaceRequest(BaseModel):
    name: str
    description: Optional[str] = None
    slug: Optional[str] = None


class JoinWorkspaceRequest(BaseModel):
    invite_code: str
    title: Optional[str] = None


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
    members = await service.list_members(workspace_id)
    return [
        WorkspaceMemberItem(
            user_id=member.user_id,
            email=user.email,
            full_name=user.full_name or '',
            role=member.role,
            title=member.title,
            joined_at=member.joined_at,
        )
        for member, user in members
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
    if not await service.is_member(workspace_id=workspace_id, user_id=tenant.user_id):
        raise HTTPException(status_code=403, detail='Not a workspace member')
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
    if not await service.is_member(workspace_id=workspace_id, user_id=tenant.user_id):
        raise HTTPException(status_code=403, detail='Not a workspace member')
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
    if not await service.is_member(workspace_id=workspace_id, user_id=tenant.user_id):
        raise HTTPException(status_code=403, detail='Not a workspace member')
    await service.regenerate_invite_code(workspace_id)
    refreshed = await service.get(workspace_id=workspace_id, organization_id=tenant.organization_id)
    assert refreshed is not None
    return WorkspaceItem(
        id=refreshed.id, name=refreshed.name, slug=refreshed.slug, description=refreshed.description,
        invite_code=refreshed.invite_code, is_default=refreshed.is_default, created_at=refreshed.created_at,
    )
