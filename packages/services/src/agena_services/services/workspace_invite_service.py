"""Token-based shareable invite links for workspaces.

Distinct from :mod:`workspace_service`'s short ``invite_code`` flow — these
links can pre-bind a role, expire, and limit total usage. Designed to be
shared externally (Slack, email, DM) and to handle the case where the
invitee does not yet have an Agena account.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.organization import Organization
from agena_models.models.organization_member import OrganizationMember
from agena_models.models.user import User
from agena_models.models.workspace import Workspace, WorkspaceMember
from agena_models.models.workspace_invite_link import WorkspaceInviteLink, generate_invite_token
from agena_models.models.workspace_role import WorkspaceRole


class WorkspaceInviteService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(
        self,
        *,
        workspace_id: int,
        organization_id: int,
        created_by_user_id: int,
        role_id: Optional[int] = None,
        max_uses: Optional[int] = None,
        expires_at: Optional[datetime] = None,
    ) -> WorkspaceInviteLink:
        ws = await self.db.execute(
            select(Workspace).where(
                Workspace.id == workspace_id,
                Workspace.organization_id == organization_id,
            )
        )
        if ws.scalar_one_or_none() is None:
            raise ValueError('Workspace not found')

        if role_id is not None:
            role_row = await self.db.execute(
                select(WorkspaceRole).where(
                    WorkspaceRole.id == role_id,
                    WorkspaceRole.organization_id == organization_id,
                )
            )
            role = role_row.scalar_one_or_none()
            if role is None:
                raise ValueError('Role not found in this organization')
            if role.is_builtin and (role.name or '').lower() == 'owner':
                raise ValueError('Owner role cannot be granted via invite')

        for _ in range(10):
            token = generate_invite_token()
            check = await self.db.execute(
                select(WorkspaceInviteLink).where(WorkspaceInviteLink.token == token)
            )
            if check.scalar_one_or_none() is None:
                break
        else:
            raise ValueError('Could not generate a unique invite token')

        link = WorkspaceInviteLink(
            workspace_id=workspace_id,
            token=token,
            role_id=role_id,
            max_uses=max_uses,
            expires_at=expires_at,
            created_by_user_id=created_by_user_id,
        )
        self.db.add(link)
        await self.db.commit()
        await self.db.refresh(link)
        return link

    async def list_for_workspace(self, *, workspace_id: int) -> list[WorkspaceInviteLink]:
        result = await self.db.execute(
            select(WorkspaceInviteLink)
            .where(WorkspaceInviteLink.workspace_id == workspace_id)
            .order_by(WorkspaceInviteLink.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_by_token(self, token: str) -> Optional[WorkspaceInviteLink]:
        result = await self.db.execute(
            select(WorkspaceInviteLink).where(WorkspaceInviteLink.token == token)
        )
        return result.scalar_one_or_none()

    async def revoke(self, *, invite_id: int, organization_id: int) -> None:
        result = await self.db.execute(
            select(WorkspaceInviteLink, Workspace)
            .join(Workspace, Workspace.id == WorkspaceInviteLink.workspace_id)
            .where(
                WorkspaceInviteLink.id == invite_id,
                Workspace.organization_id == organization_id,
            )
        )
        row = result.first()
        if row is None:
            raise ValueError('Invite not found')
        link, _ = row
        link.revoked_at = datetime.now(timezone.utc)
        await self.db.commit()

    async def resolve_preview(self, token: str) -> dict:
        """Public-safe view of a token. Returns workspace + org + role names.

        Raises ``ValueError`` for missing / revoked / expired / exhausted
        tokens — matched messages are stable strings the frontend can key
        off of.
        """
        result = await self.db.execute(
            select(WorkspaceInviteLink, Workspace, Organization, WorkspaceRole)
            .join(Workspace, Workspace.id == WorkspaceInviteLink.workspace_id)
            .join(Organization, Organization.id == Workspace.organization_id)
            .outerjoin(WorkspaceRole, WorkspaceRole.id == WorkspaceInviteLink.role_id)
            .where(WorkspaceInviteLink.token == token)
        )
        row = result.first()
        if row is None:
            raise ValueError('Invite not found')
        link, workspace, org, role = row
        self._assert_usable(link)
        return {
            'workspace_id': workspace.id,
            'workspace_name': workspace.name,
            'workspace_slug': workspace.slug,
            'organization_id': org.id,
            'organization_name': org.name,
            'organization_slug': org.slug,
            'role_id': role.id if role is not None else None,
            'role_name': role.name if role is not None else None,
            'expires_at': link.expires_at,
            'uses': link.uses,
            'max_uses': link.max_uses,
        }

    async def _resolve_default_role(self, organization_id: int) -> Optional[WorkspaceRole]:
        """Org's ``is_default_for_new_members`` role, or built-in Member fallback."""
        result = await self.db.execute(
            select(WorkspaceRole).where(
                WorkspaceRole.organization_id == organization_id,
                WorkspaceRole.is_default_for_new_members.is_(True),
            ).limit(1)
        )
        role = result.scalar_one_or_none()
        if role is not None:
            return role
        result = await self.db.execute(
            select(WorkspaceRole).where(
                WorkspaceRole.organization_id == organization_id,
                WorkspaceRole.is_builtin.is_(True),
                WorkspaceRole.name == 'Member',
            ).limit(1)
        )
        return result.scalar_one_or_none()

    def _assert_usable(self, link: WorkspaceInviteLink) -> None:
        if link.revoked_at is not None:
            raise ValueError('Invite has been revoked')
        if link.expires_at is not None and link.expires_at < datetime.now(timezone.utc).replace(tzinfo=None):
            raise ValueError('Invite has expired')
        if link.max_uses is not None and link.uses >= link.max_uses:
            raise ValueError('Invite usage limit reached')

    async def accept(self, *, token: str, user_id: int) -> Workspace:
        """Add ``user_id`` to the linked workspace + parent org as a member.

        Idempotent: if the user is already in the workspace, returns the
        workspace without bumping the use counter (so a stray re-click does
        not exhaust ``max_uses``).
        """
        result = await self.db.execute(
            select(WorkspaceInviteLink, Workspace)
            .join(Workspace, Workspace.id == WorkspaceInviteLink.workspace_id)
            .where(WorkspaceInviteLink.token == token)
        )
        row = result.first()
        if row is None:
            raise ValueError('Invite not found')
        link, workspace = row
        self._assert_usable(link)

        # Ensure the user is in the parent organization (workspaces live
        # below an org, and many features key off OrganizationMember).
        existing_org_member = await self.db.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == workspace.organization_id,
                OrganizationMember.user_id == user_id,
            )
        )
        if existing_org_member.scalar_one_or_none() is None:
            self.db.add(OrganizationMember(
                organization_id=workspace.organization_id,
                user_id=user_id,
                role='member',
            ))

        # Workspace membership — idempotent
        existing_ws_member = await self.db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.user_id == user_id,
            )
        )
        already = existing_ws_member.scalar_one_or_none()
        if already is None:
            # When the invite didn't pre-bind a role, fall back to the org's
            # ``is_default_for_new_members`` role (typically built-in Member)
            # so the new member actually has perms — otherwise role_id stays
            # NULL and they get zero permissions, including analytics:read.
            effective_role_id = link.role_id
            if effective_role_id is None:
                default_role = await self._resolve_default_role(workspace.organization_id)
                if default_role is not None:
                    effective_role_id = default_role.id
            self.db.add(WorkspaceMember(
                workspace_id=workspace.id,
                user_id=user_id,
                role='member',
                role_id=effective_role_id,
            ))
            link.uses = (link.uses or 0) + 1

        await self.db.commit()
        return workspace
