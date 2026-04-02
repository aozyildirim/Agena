from __future__ import annotations

import secrets

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.invite import Invite
from agena_models.models.organization import Organization
from agena_models.models.organization_member import OrganizationMember
from agena_models.models.user import User
from agena_services.services.quota_service import QuotaService


class OrgService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def invite_user(
        self, organization_id: int, email: str, *, invited_by: int | None = None,
    ) -> Invite:
        quota = QuotaService(self.db)
        await quota.check_member_quota(organization_id)

        invite = Invite(
            organization_id=organization_id,
            email=email,
            token=secrets.token_urlsafe(32),
            status='pending',
            invited_by=invited_by,
        )
        self.db.add(invite)
        await self.db.commit()
        await self.db.refresh(invite)
        return invite

    async def validate_invite(self, token: str) -> dict:
        """Validate a token and return invite info (no auth required)."""
        result = await self.db.execute(select(Invite).where(Invite.token == token))
        invite = result.scalar_one_or_none()
        if invite is None:
            raise ValueError('Invalid invite token')

        org_result = await self.db.execute(
            select(Organization).where(Organization.id == invite.organization_id)
        )
        org = org_result.scalar_one_or_none()

        inviter_name = None
        if invite.invited_by:
            inviter_result = await self.db.execute(
                select(User).where(User.id == invite.invited_by)
            )
            inviter = inviter_result.scalar_one_or_none()
            if inviter:
                inviter_name = inviter.full_name or inviter.email

        return {
            'email': invite.email,
            'status': invite.status,
            'organization_name': org.name if org else 'Unknown',
            'organization_id': invite.organization_id,
            'inviter_name': inviter_name,
        }

    async def accept_invite(self, token: str, user_id: int) -> Invite:
        result = await self.db.execute(select(Invite).where(Invite.token == token, Invite.status == 'pending'))
        invite = result.scalar_one_or_none()
        if invite is None:
            raise ValueError('Invalid invite token')

        quota = QuotaService(self.db)
        await quota.check_member_quota(invite.organization_id)

        exists = await self.db.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == invite.organization_id,
                OrganizationMember.user_id == user_id,
            )
        )
        if exists.scalar_one_or_none() is None:
            self.db.add(
                OrganizationMember(
                    organization_id=invite.organization_id,
                    user_id=user_id,
                    role='member',
                )
            )
        invite.status = 'accepted'
        await self.db.commit()
        return invite

    async def list_invites(self, organization_id: int) -> list[dict]:
        """List all invites for an organization."""
        result = await self.db.execute(
            select(Invite)
            .where(Invite.organization_id == organization_id)
            .order_by(Invite.created_at.desc())
        )
        invites = result.scalars().all()

        items = []
        for inv in invites:
            inviter_name = None
            if inv.invited_by:
                inviter_result = await self.db.execute(
                    select(User).where(User.id == inv.invited_by)
                )
                inviter = inviter_result.scalar_one_or_none()
                if inviter:
                    inviter_name = inviter.full_name or inviter.email
            items.append({
                'id': inv.id,
                'email': inv.email,
                'status': inv.status,
                'inviter_name': inviter_name,
                'created_at': inv.created_at.isoformat() if inv.created_at else None,
            })
        return items

    async def cancel_invite(self, invite_id: int, organization_id: int) -> None:
        """Cancel (delete) an invite."""
        result = await self.db.execute(
            select(Invite).where(
                Invite.id == invite_id,
                Invite.organization_id == organization_id,
            )
        )
        invite = result.scalar_one_or_none()
        if invite is None:
            raise ValueError('Invite not found')
        await self.db.delete(invite)
        await self.db.commit()

    async def resend_invite(self, invite_id: int, organization_id: int) -> Invite:
        """Regenerate the token for an existing invite (to resend)."""
        result = await self.db.execute(
            select(Invite).where(
                Invite.id == invite_id,
                Invite.organization_id == organization_id,
                Invite.status == 'pending',
            )
        )
        invite = result.scalar_one_or_none()
        if invite is None:
            raise ValueError('Invite not found or already accepted')
        invite.token = secrets.token_urlsafe(32)
        await self.db.commit()
        await self.db.refresh(invite)
        return invite

    async def auto_add_team_members(
        self, org_id: int, members: list[dict],
    ) -> dict[str, int]:
        """Sync a list of team members (from Azure/Jira) into organization membership.

        For each member with a valid email (uniqueName):
        - If a User with that email exists and is not already an org member, add them.
        - If no User exists and no pending invite exists, create an invite.
        Returns ``{added: int, invited: int, already_exists: int}``.
        """
        import re

        added = 0
        invited = 0
        already_exists = 0
        invited_emails: list[str] = []

        email_pattern = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
        seen_emails: set[str] = set()

        for member in members:
            email = (member.get('uniqueName') or '').strip().lower()
            if not email or not email_pattern.match(email):
                continue
            # Skip duplicates within same batch
            if email in seen_emails:
                continue
            seen_emails.add(email)

            # Check if a registered user exists with this email
            user_result = await self.db.execute(
                select(User).where(User.email == email)
            )
            user = user_result.scalar_one_or_none()

            if user is not None:
                # Check if already an org member
                mem_result = await self.db.execute(
                    select(OrganizationMember).where(
                        OrganizationMember.organization_id == org_id,
                        OrganizationMember.user_id == user.id,
                    )
                )
                if mem_result.scalar_one_or_none() is not None:
                    already_exists += 1
                else:
                    self.db.add(
                        OrganizationMember(
                            organization_id=org_id,
                            user_id=user.id,
                            role='member',
                        )
                    )
                    added += 1
            else:
                # No user — check for ANY existing invite (pending or accepted)
                inv_result = await self.db.execute(
                    select(func.count(Invite.id)).where(
                        Invite.organization_id == org_id,
                        Invite.email == email,
                    )
                )
                if (inv_result.scalar() or 0) > 0:
                    already_exists += 1
                else:
                    inv = Invite(
                        organization_id=org_id,
                        email=email,
                        token=secrets.token_urlsafe(32),
                        status='pending',
                    )
                    self.db.add(inv)
                    invited += 1
                    invited_emails.append(email)

        await self.db.flush()
        return {'added': added, 'invited': invited, 'already_exists': already_exists, 'invited_emails': invited_emails}

    async def get_user(self, user_id: int) -> User | None:
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()
