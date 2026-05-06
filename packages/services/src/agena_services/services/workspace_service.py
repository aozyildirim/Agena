"""Workspace operations: create, join, list, member management.

A workspace is a sub-scope inside an organization. Big teams that share
one Agena org but actually run multiple independent product squads can
create per-squad workspaces; tasks / repo mappings get filtered down to
the active workspace_id, while org-level admins still see across.
"""
from __future__ import annotations

import re
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.organization_member import OrganizationMember
from agena_models.models.user import User
from agena_models.models.workspace import Workspace, WorkspaceMember, generate_invite_code


_SLUG_RE = re.compile(r'^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$')


def _slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s[:63] or 'workspace'


class WorkspaceService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def list_for_user(self, user_id: int, organization_id: int) -> list[Workspace]:
        """Workspaces in this org that the user belongs to."""
        result = await self.db.execute(
            select(Workspace)
            .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
            .where(
                Workspace.organization_id == organization_id,
                WorkspaceMember.user_id == user_id,
            )
            .order_by(Workspace.is_default.desc(), Workspace.created_at.asc())
        )
        return list(result.scalars().all())

    async def get(self, workspace_id: int, organization_id: int) -> Optional[Workspace]:
        result = await self.db.execute(
            select(Workspace).where(
                Workspace.id == workspace_id,
                Workspace.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_by_invite_code(self, invite_code: str) -> Optional[Workspace]:
        result = await self.db.execute(
            select(Workspace).where(Workspace.invite_code == invite_code.upper())
        )
        return result.scalar_one_or_none()

    async def create(
        self,
        *,
        organization_id: int,
        user_id: int,
        name: str,
        description: Optional[str] = None,
        slug: Optional[str] = None,
    ) -> Workspace:
        name = (name or '').strip()
        if not name:
            raise ValueError('Workspace name is required')

        if slug:
            slug = slug.strip().lower()
            if not _SLUG_RE.match(slug):
                raise ValueError('Slug must be lowercase alphanumeric with hyphens (1-63 chars)')
        else:
            slug = _slugify(name)

        # Ensure uniqueness inside the org
        existing = await self.db.execute(
            select(Workspace).where(
                Workspace.organization_id == organization_id,
                Workspace.slug == slug,
            )
        )
        if existing.scalar_one_or_none():
            # Append a suffix until unique
            base = slug
            for n in range(2, 50):
                candidate = f'{base}-{n}'
                row = await self.db.execute(
                    select(Workspace).where(
                        Workspace.organization_id == organization_id,
                        Workspace.slug == candidate,
                    )
                )
                if row.scalar_one_or_none() is None:
                    slug = candidate
                    break

        # Pick a unique invite code
        for _ in range(20):
            code = generate_invite_code()
            existing_code = await self.db.execute(
                select(Workspace).where(Workspace.invite_code == code)
            )
            if existing_code.scalar_one_or_none() is None:
                break
        else:
            raise ValueError('Could not generate a unique invite code')

        ws = Workspace(
            organization_id=organization_id,
            name=name,
            slug=slug,
            description=description,
            invite_code=code,
            is_default=False,
            created_by_user_id=user_id,
        )
        self.db.add(ws)
        await self.db.flush()
        self.db.add(WorkspaceMember(workspace_id=ws.id, user_id=user_id, role='owner'))
        await self.db.commit()
        await self.db.refresh(ws)
        return ws

    async def join_by_code(self, *, user_id: int, invite_code: str, title: Optional[str] = None) -> Workspace:
        ws = await self.get_by_invite_code(invite_code.strip())
        if ws is None:
            raise ValueError('Invite code not found')

        # Ensure the user is a member of the org that owns the workspace
        org_member = await self.db.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == ws.organization_id,
                OrganizationMember.user_id == user_id,
            )
        )
        if org_member.scalar_one_or_none() is None:
            # Auto-join the org as a member (Slack-style — invite code grants access)
            self.db.add(OrganizationMember(organization_id=ws.organization_id, user_id=user_id, role='member'))
            await self.db.flush()

        existing = await self.db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == ws.id,
                WorkspaceMember.user_id == user_id,
            )
        )
        if existing.scalar_one_or_none():
            return ws

        self.db.add(WorkspaceMember(workspace_id=ws.id, user_id=user_id, role='member', title=title))
        await self.db.commit()
        await self.db.refresh(ws)
        return ws

    async def list_members(self, workspace_id: int) -> list[tuple[WorkspaceMember, User]]:
        result = await self.db.execute(
            select(WorkspaceMember, User)
            .join(User, User.id == WorkspaceMember.user_id)
            .where(WorkspaceMember.workspace_id == workspace_id)
            .order_by(WorkspaceMember.joined_at.asc())
        )
        return [(row[0], row[1]) for row in result.all()]

    async def is_member(self, *, workspace_id: int, user_id: int) -> bool:
        row = await self.db.execute(
            select(func.count())
            .select_from(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user_id,
            )
        )
        return (row.scalar() or 0) > 0

    async def update_member_title(self, *, workspace_id: int, user_id: int, title: Optional[str]) -> None:
        result = await self.db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user_id,
            )
        )
        member = result.scalar_one_or_none()
        if member is None:
            raise ValueError('Member not found')
        member.title = title
        await self.db.commit()

    async def remove_member(self, *, workspace_id: int, user_id: int) -> None:
        result = await self.db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user_id,
            )
        )
        member = result.scalar_one_or_none()
        if member is None:
            return
        await self.db.delete(member)
        await self.db.commit()

    async def regenerate_invite_code(self, workspace_id: int) -> str:
        result = await self.db.execute(select(Workspace).where(Workspace.id == workspace_id))
        ws = result.scalar_one_or_none()
        if ws is None:
            raise ValueError('Workspace not found')
        for _ in range(20):
            code = generate_invite_code()
            check = await self.db.execute(select(Workspace).where(Workspace.invite_code == code))
            if check.scalar_one_or_none() is None:
                ws.invite_code = code
                await self.db.commit()
                return code
        raise ValueError('Could not generate a unique invite code')
