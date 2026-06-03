"""Org-level role catalog API: list / create / update / delete custom roles
plus the static permission catalog so the UI can render the matrix.
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_services.services.permission_catalog import PERMISSION_GROUPS
from agena_services.services.workspace_role_service import WorkspaceRoleService

router = APIRouter(prefix='/workspace-roles', tags=['workspace-roles'])


class PermissionItem(BaseModel):
    key: str
    label: str


class PermissionGroupItem(BaseModel):
    group: str
    label: str
    icon: str
    permissions: list[PermissionItem]


class RoleItem(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    permissions: list[str]
    is_builtin: bool
    is_default_for_new_members: bool
    sort_order: int


class CreateRoleRequest(BaseModel):
    name: str
    description: Optional[str] = None
    permissions: list[str] = []
    is_default_for_new_members: bool = False


class UpdateRoleRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permissions: Optional[list[str]] = None
    is_default_for_new_members: Optional[bool] = None


def _to_item(role) -> RoleItem:
    try:
        perms = json.loads(role.permissions_json or '[]')
    except (TypeError, ValueError):
        perms = []
    return RoleItem(
        id=role.id,
        name=role.name,
        description=role.description,
        permissions=perms,
        is_builtin=role.is_builtin,
        is_default_for_new_members=role.is_default_for_new_members,
        sort_order=role.sort_order,
    )


@router.get('/catalog', response_model=list[PermissionGroupItem])
async def get_catalog() -> list[PermissionGroupItem]:
    """Static catalog of permission keys grouped for the matrix UI."""
    return [
        PermissionGroupItem(
            group=g['group'],
            label=g['label'],
            icon=g['icon'],
            permissions=[PermissionItem(key=k, label=l) for k, l in g['permissions']],
        )
        for g in PERMISSION_GROUPS
    ]


@router.get('', response_model=list[RoleItem])
async def list_roles(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[RoleItem]:
    service = WorkspaceRoleService(db)
    roles = await service.list_for_org(tenant.organization_id)
    return [_to_item(r) for r in roles]


@router.post('', response_model=RoleItem)
async def create_role(
    payload: CreateRoleRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> RoleItem:
    if (tenant.role or '').lower() not in ('owner', 'admin'):
        raise HTTPException(status_code=403, detail='Only org owners and admins can create roles')
    service = WorkspaceRoleService(db)
    try:
        role = await service.create(
            organization_id=tenant.organization_id,
            name=payload.name,
            description=payload.description,
            permissions=payload.permissions,
            is_default_for_new_members=payload.is_default_for_new_members,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_item(role)


@router.put('/{role_id}', response_model=RoleItem)
async def update_role(
    role_id: int,
    payload: UpdateRoleRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> RoleItem:
    if (tenant.role or '').lower() not in ('owner', 'admin'):
        raise HTTPException(status_code=403, detail='Only org owners and admins can edit roles')
    service = WorkspaceRoleService(db)
    try:
        role = await service.update(
            role_id=role_id,
            organization_id=tenant.organization_id,
            name=payload.name,
            description=payload.description,
            permissions=payload.permissions,
            is_default_for_new_members=payload.is_default_for_new_members,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_item(role)


@router.delete('/{role_id}')
async def delete_role(
    role_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    if (tenant.role or '').lower() != 'owner':
        raise HTTPException(status_code=403, detail='Only org owners can delete roles')
    service = WorkspaceRoleService(db)
    try:
        await service.delete(role_id=role_id, organization_id=tenant.organization_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {'ok': True}


class AssignRoleRequest(BaseModel):
    role_id: int


@router.put('/assign/{workspace_id}/{user_id}', response_model=RoleItem)
async def assign_role_to_member(
    workspace_id: int,
    user_id: int,
    payload: AssignRoleRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> RoleItem:
    """Assign an org-level role to a workspace member.

    Authorization: org owner OR the member must have ``members:assign-role``
    permission in the target workspace (their own role lookup).
    """
    if (tenant.role or '').lower() != 'owner':
        # Check workspace permission
        service = WorkspaceRoleService(db)
        perms = await service.get_user_permissions(
            user_id=tenant.user_id,
            workspace_id=workspace_id,
            organization_id=tenant.organization_id,
        )
        if 'members:assign-role' not in perms:
            raise HTTPException(status_code=403, detail='Permission denied: members:assign-role')

    service = WorkspaceRoleService(db)
    try:
        await service.assign_to_member(
            workspace_id=workspace_id,
            user_id=user_id,
            role_id=payload.role_id,
            organization_id=tenant.organization_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    role = await service.get(payload.role_id, tenant.organization_id)
    if role is None:
        raise HTTPException(status_code=404, detail='Role not found')
    return _to_item(role)
