"""CRUD for org-level workspace roles + permission lookups.

Built-in roles (Owner / Admin / Member / Viewer) cannot be deleted but
their permission lists may be tweaked. Custom roles ('Tech Lead',
'Senior Dev', 'QA Lead') sit alongside the built-ins.
"""
from __future__ import annotations

import json
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.organization_member import OrganizationMember
from agena_models.models.workspace import Workspace, WorkspaceMember
from agena_models.models.workspace_role import WorkspaceRole
from agena_services.services.permission_catalog import all_permission_keys


class WorkspaceRoleService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def list_for_org(self, organization_id: int) -> list[WorkspaceRole]:
        result = await self.db.execute(
            select(WorkspaceRole)
            .where(WorkspaceRole.organization_id == organization_id)
            .order_by(WorkspaceRole.sort_order.asc(), WorkspaceRole.name.asc())
        )
        return list(result.scalars().all())

    async def get(self, role_id: int, organization_id: int) -> Optional[WorkspaceRole]:
        result = await self.db.execute(
            select(WorkspaceRole).where(
                WorkspaceRole.id == role_id,
                WorkspaceRole.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def create(
        self,
        *,
        organization_id: int,
        name: str,
        description: Optional[str] = None,
        permissions: list[str] | None = None,
        is_default_for_new_members: bool = False,
    ) -> WorkspaceRole:
        name = (name or '').strip()
        if not name:
            raise ValueError('Role name is required')
        if len(name) > 80:
            raise ValueError('Role name must be 80 characters or fewer')

        # Validate permission keys
        valid_keys = set(all_permission_keys())
        cleaned = [p for p in (permissions or []) if p in valid_keys]

        # Uniqueness inside the org
        existing = await self.db.execute(
            select(WorkspaceRole).where(
                WorkspaceRole.organization_id == organization_id,
                WorkspaceRole.name == name,
            )
        )
        if existing.scalar_one_or_none():
            raise ValueError(f'A role named "{name}" already exists')

        if is_default_for_new_members:
            # Only one default at a time — clear the others
            await self._clear_default(organization_id)

        role = WorkspaceRole(
            organization_id=organization_id,
            name=name,
            description=description,
            permissions_json=json.dumps(cleaned),
            is_builtin=False,
            is_default_for_new_members=is_default_for_new_members,
            sort_order=100,
        )
        self.db.add(role)
        await self.db.commit()
        await self.db.refresh(role)
        return role

    async def update(
        self,
        *,
        role_id: int,
        organization_id: int,
        name: Optional[str] = None,
        description: Optional[str] = None,
        permissions: list[str] | None = None,
        is_default_for_new_members: Optional[bool] = None,
    ) -> WorkspaceRole:
        role = await self.get(role_id, organization_id)
        if role is None:
            raise ValueError('Role not found')

        if name is not None and name.strip() and not role.is_builtin:
            # Built-in role names are fixed (Owner/Admin/Member/Viewer)
            role.name = name.strip()
        if description is not None:
            role.description = description
        if permissions is not None:
            valid_keys = set(all_permission_keys())
            role.permissions_json = json.dumps([p for p in permissions if p in valid_keys])
        if is_default_for_new_members is True:
            await self._clear_default(organization_id)
            role.is_default_for_new_members = True
        elif is_default_for_new_members is False:
            role.is_default_for_new_members = False

        await self.db.commit()
        await self.db.refresh(role)
        return role

    async def delete(self, *, role_id: int, organization_id: int) -> None:
        role = await self.get(role_id, organization_id)
        if role is None:
            raise ValueError('Role not found')
        if role.is_builtin:
            raise ValueError('Built-in roles cannot be deleted')

        # Move members on this role back to the default role
        default_role = await self._get_default_role(organization_id)
        if default_role is None:
            raise ValueError('No default role configured — cannot reassign members')
        members = await self.db.execute(
            select(WorkspaceMember).where(WorkspaceMember.role_id == role_id)
        )
        for member in members.scalars().all():
            member.role_id = default_role.id
            member.role = default_role.name.lower()

        await self.db.delete(role)
        await self.db.commit()

    async def assign_to_member(
        self,
        *,
        workspace_id: int,
        user_id: int,
        role_id: int,
        organization_id: int,
    ) -> WorkspaceMember:
        role = await self.get(role_id, organization_id)
        if role is None:
            raise ValueError('Role not found')
        # Owner is the org founder's seat — not assignable from the UI even
        # by other owners. We avoid the "two owners, one demotes the other"
        # privilege-escalation foot-gun by blocking it server-side.
        if role.is_builtin and (role.name or '').lower() == 'owner':
            raise ValueError('Owner role cannot be assigned')
        result = await self.db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user_id,
            )
        )
        member = result.scalar_one_or_none()
        if member is None:
            raise ValueError('Member not found')
        # Symmetric guard: don't let anyone *demote* the org owner either.
        # Their seat in every workspace is anchored at "Owner" — overwriting
        # it via this endpoint would silently strip their permissions.
        from agena_models.models.organization_member import OrganizationMember
        target_om = await self.db.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.user_id == user_id,
            )
        )
        target_member = target_om.scalar_one_or_none()
        if target_member is not None and (target_member.role or '').lower() == 'owner':
            raise ValueError("Cannot change the organization owner's role")
        member.role_id = role.id
        member.role = role.name.lower()
        await self.db.commit()
        await self.db.refresh(member)
        return member

    async def get_user_permissions(
        self,
        *,
        user_id: int,
        workspace_id: int,
        organization_id: int,
    ) -> set[str]:
        """All permission keys the user holds in this workspace.

        Org owners (OrganizationMember.role == 'owner') get every known
        permission — they're implicit super-admins of every workspace
        in the org.
        """
        org_member_result = await self.db.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.user_id == user_id,
            )
        )
        org_member = org_member_result.scalar_one_or_none()
        if org_member is not None and (org_member.role or '').lower() == 'owner':
            return set(all_permission_keys())

        result = await self.db.execute(
            select(WorkspaceMember, WorkspaceRole)
            .join(WorkspaceRole, WorkspaceRole.id == WorkspaceMember.role_id, isouter=True)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user_id,
            )
        )
        row = result.first()
        if row is None:
            return set()
        _, role = row
        if role is None:
            return set()
        try:
            return set(json.loads(role.permissions_json or '[]'))
        except (TypeError, ValueError):
            return set()

    async def _clear_default(self, organization_id: int) -> None:
        result = await self.db.execute(
            select(WorkspaceRole).where(
                WorkspaceRole.organization_id == organization_id,
                WorkspaceRole.is_default_for_new_members.is_(True),
            )
        )
        for r in result.scalars().all():
            r.is_default_for_new_members = False

    async def _get_default_role(self, organization_id: int) -> Optional[WorkspaceRole]:
        result = await self.db.execute(
            select(WorkspaceRole).where(
                WorkspaceRole.organization_id == organization_id,
                WorkspaceRole.is_default_for_new_members.is_(True),
            ).limit(1)
        )
        role = result.scalar_one_or_none()
        if role is not None:
            return role
        # Fallback: builtin Member
        result = await self.db.execute(
            select(WorkspaceRole).where(
                WorkspaceRole.organization_id == organization_id,
                WorkspaceRole.name == 'Member',
            ).limit(1)
        )
        return result.scalar_one_or_none()
