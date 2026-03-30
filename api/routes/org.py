from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentTenant, get_current_tenant, require_permission
from core.database import get_db_session
from core.rbac import ROLES
from core.settings import get_settings
from models.organization import Organization
from models.organization_member import OrganizationMember
from models.user import User
from schemas.org import InviteRequest, InviteResponse
from services.notification_service import NotificationService
from services.org_service import OrgService

router = APIRouter(prefix='/org', tags=['organization'])


class AcceptInviteRequest(BaseModel):
    token: str


class ChangeRoleRequest(BaseModel):
    role: str


class MemberResponse(BaseModel):
    id: int
    user_id: int
    email: str
    full_name: str
    role: str


class InviteValidateResponse(BaseModel):
    email: str
    status: str
    organization_name: str
    organization_id: int
    inviter_name: str | None = None


class InviteListItem(BaseModel):
    id: int
    email: str
    status: str
    inviter_name: str | None = None
    created_at: str | None = None


class CheckSlugResponse(BaseModel):
    available: bool
    slug: str


# ── Helpers ──────────────────────────────────────────────────────────────────


def _build_invite_url(token: str) -> str:
    """Build the frontend invite acceptance URL."""
    settings = get_settings()
    base = 'http://localhost:3000'
    if settings.app_env == 'production':
        base = 'https://app.agena.dev'
    return f'{base}/invite?token={token}'


async def _send_invite_email(
    db: AsyncSession,
    *,
    organization_id: int,
    inviter_user_id: int,
    invite_email: str,
    invite_token: str,
    org_name: str,
) -> None:
    """Send an invite email using the notification service's email infrastructure."""
    notifier = NotificationService(db)
    invite_url = _build_invite_url(invite_token)

    inviter_result = await db.execute(select(User).where(User.id == inviter_user_id))
    inviter = inviter_result.scalar_one_or_none()
    inviter_name = (inviter.full_name if inviter else None) or 'A team member'

    subject = f'[AGENA] You\'ve been invited to join {org_name}'
    body = (
        f'{inviter_name} has invited you to join {org_name} on AGENA.\n\n'
        f'Click the link below to accept the invitation:\n'
        f'{invite_url}\n\n'
        f'If you don\'t have an AGENA account yet, you\'ll be able to sign up when you click the link.\n\n'
        f'-- AGENA AI'
    )

    notifier._send_email(invite_email, subject, body)

    await notifier.notify_event(
        organization_id=organization_id,
        user_id=inviter_user_id,
        event_type='invite_sent',
        title='Invite sent',
        message=f'Invitation sent to {invite_email}',
        severity='info',
        payload={'email': invite_email},
    )


# ── Slug ─────────────────────────────────────────────────────────────────────


@router.get('/check-slug', response_model=CheckSlugResponse)
async def check_slug(
    slug: str,
    db: AsyncSession = Depends(get_db_session),
) -> CheckSlugResponse:
    """Check if an organization slug is available. No auth required."""
    import re
    normalized = slug.strip().lower()
    if not re.match(r'^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$', normalized):
        return CheckSlugResponse(available=False, slug=normalized)
    result = await db.execute(select(Organization).where(Organization.slug == normalized))
    taken = result.scalar_one_or_none() is not None
    return CheckSlugResponse(available=not taken, slug=normalized)


# ── Invites ──────────────────────────────────────────────────────────────────


@router.post('/invite', response_model=InviteResponse)
async def invite_member(
    request: InviteRequest,
    tenant: CurrentTenant = Depends(require_permission('team:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> InviteResponse:
    service = OrgService(db)
    invite = await service.invite_user(
        tenant.organization_id, request.email, invited_by=tenant.user_id,
    )

    org_result = await db.execute(
        select(Organization).where(Organization.id == tenant.organization_id)
    )
    org = org_result.scalar_one_or_none()
    org_name = org.name if org else 'your organization'

    await _send_invite_email(
        db,
        organization_id=tenant.organization_id,
        inviter_user_id=tenant.user_id,
        invite_email=request.email,
        invite_token=invite.token,
        org_name=org_name,
    )

    return InviteResponse(invite_token=invite.token, status=invite.status)


@router.get('/invite/validate', response_model=InviteValidateResponse)
async def validate_invite(
    token: str = Query(...),
    db: AsyncSession = Depends(get_db_session),
) -> InviteValidateResponse:
    """Validate an invite token and return invite info. No auth required."""
    service = OrgService(db)
    try:
        info = await service.validate_invite(token)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return InviteValidateResponse(**info)


@router.post('/invite/accept')
async def accept_invite(
    request: AcceptInviteRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    service = OrgService(db)
    try:
        invite = await service.accept_invite(request.token, tenant.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if invite.invited_by:
        notifier = NotificationService(db)
        user_result = await db.execute(select(User).where(User.id == tenant.user_id))
        user = user_result.scalar_one_or_none()
        user_name = (user.full_name if user else None) or tenant.email

        await notifier.notify_event(
            organization_id=invite.organization_id,
            user_id=invite.invited_by,
            event_type='invite_accepted',
            title='Invite accepted',
            message=f'{user_name} accepted your invitation',
            severity='success',
            payload={'email': invite.email, 'user_id': tenant.user_id},
        )

    return {'status': 'accepted'}


@router.get('/invites', response_model=list[InviteListItem])
async def list_invites(
    tenant: CurrentTenant = Depends(require_permission('team:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> list[InviteListItem]:
    """List all invites for the current organization."""
    service = OrgService(db)
    items = await service.list_invites(tenant.organization_id)
    return [InviteListItem(**item) for item in items]


@router.delete('/invites/{invite_id}')
async def cancel_invite(
    invite_id: int,
    tenant: CurrentTenant = Depends(require_permission('team:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    """Cancel (delete) a pending invite."""
    service = OrgService(db)
    try:
        await service.cancel_invite(invite_id, tenant.organization_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {'status': 'cancelled'}


@router.post('/invites/{invite_id}/resend')
async def resend_invite(
    invite_id: int,
    tenant: CurrentTenant = Depends(require_permission('team:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    """Resend an invite email (regenerates the token)."""
    service = OrgService(db)
    try:
        invite = await service.resend_invite(invite_id, tenant.organization_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    org_result = await db.execute(
        select(Organization).where(Organization.id == tenant.organization_id)
    )
    org = org_result.scalar_one_or_none()
    org_name = org.name if org else 'your organization'

    await _send_invite_email(
        db,
        organization_id=tenant.organization_id,
        inviter_user_id=tenant.user_id,
        invite_email=invite.email,
        invite_token=invite.token,
        org_name=org_name,
    )

    return {'status': 'resent'}


# ── Members ──────────────────────────────────────────────────────────────────


@router.get('/members', response_model=list[MemberResponse])
async def list_members(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[MemberResponse]:
    result = await db.execute(
        select(OrganizationMember, User)
        .join(User, OrganizationMember.user_id == User.id)
        .where(OrganizationMember.organization_id == tenant.organization_id)
    )
    rows = result.all()
    return [
        MemberResponse(
            id=member.id,
            user_id=member.user_id,
            email=user.email,
            full_name=user.full_name,
            role=member.role or 'member',
        )
        for member, user in rows
    ]


@router.put('/members/{member_id}/role', response_model=MemberResponse)
async def change_member_role(
    member_id: int,
    payload: ChangeRoleRequest,
    tenant: CurrentTenant = Depends(require_permission('roles:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> MemberResponse:
    if payload.role not in ROLES:
        raise HTTPException(status_code=400, detail=f'Invalid role. Must be one of: {", ".join(ROLES)}')

    # Only an owner can promote someone to owner
    if payload.role == 'owner' and tenant.role != 'owner':
        raise HTTPException(status_code=403, detail='Only an owner can assign the owner role')

    result = await db.execute(
        select(OrganizationMember, User)
        .join(User, OrganizationMember.user_id == User.id)
        .where(
            OrganizationMember.id == member_id,
            OrganizationMember.organization_id == tenant.organization_id,
        )
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail='Member not found')

    member, user = row

    # Prevent demoting yourself as the only owner
    if member.user_id == tenant.user_id and member.role == 'owner' and payload.role != 'owner':
        owner_count_result = await db.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == tenant.organization_id,
                OrganizationMember.role == 'owner',
            )
        )
        if len(owner_count_result.all()) <= 1:
            raise HTTPException(status_code=400, detail='Cannot demote the only owner')

    member.role = payload.role
    await db.commit()
    await db.refresh(member)

    # Notify the affected user about their role change
    notifier = NotificationService(db)
    admin_result = await db.execute(select(User).where(User.id == tenant.user_id))
    admin_user = admin_result.scalar_one_or_none()
    admin_name = admin_user.full_name if admin_user else 'An admin'

    # Notification to the member whose role changed
    await notifier.notify_event(
        organization_id=tenant.organization_id,
        user_id=member.user_id,
        event_type='role_changed',
        title='Role changed',
        message=f'Your role has been changed to {payload.role} by {admin_name}',
        severity='info',
        payload={'new_role': payload.role, 'changed_by': tenant.user_id},
    )

    # Notification to the admin who made the change (skip if same user)
    if tenant.user_id != member.user_id:
        await notifier.notify_event(
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            event_type='role_changed',
            title='Role changed',
            message=f"{user.full_name}'s role changed to {payload.role}",
            severity='info',
            payload={'new_role': payload.role, 'target_user_id': member.user_id},
        )

    return MemberResponse(
        id=member.id,
        user_id=member.user_id,
        email=user.email,
        full_name=user.full_name,
        role=member.role,
    )


# ── Team Sync ────────────────────────────────────────────────────────────────


class AutoSyncTeamRequest(BaseModel):
    members: list[dict[str, Any]]


class AutoSyncTeamResponse(BaseModel):
    added: int
    invited: int
    already_exists: int


@router.post('/auto-sync-team', response_model=AutoSyncTeamResponse)
async def auto_sync_team(
    payload: AutoSyncTeamRequest,
    tenant: CurrentTenant = Depends(require_permission('team:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> AutoSyncTeamResponse:
    """Manually sync the current my_team list into organization members/invites."""
    org_svc = OrgService(db)
    summary = await org_svc.auto_add_team_members(tenant.organization_id, payload.members)
    await db.commit()

    # Notify about newly invited members
    invited_count = summary.get('invited', 0)
    if invited_count > 0:
        notif_svc = NotificationService(db)
        await notif_svc.notify_event(
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            event_type='team_sync',
            title='Team members synced',
            message=f'{invited_count} new team member{"s" if invited_count != 1 else ""} invited to your organization.',
            severity='info',
            payload={'sync_summary': summary},
        )

    return AutoSyncTeamResponse(**summary)


class RemoveByEmailRequest(BaseModel):
    email: str


@router.post('/remove-by-email')
async def remove_member_by_email(
    payload: RemoveByEmailRequest,
    tenant: CurrentTenant = Depends(require_permission('team:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    """Remove an org member or cancel pending invite by email.
    Used when removing a team member from the sprint team."""
    email = payload.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail='Email is required')

    # Try to remove org member
    result = await db.execute(
        select(OrganizationMember, User)
        .join(User, OrganizationMember.user_id == User.id)
        .where(
            OrganizationMember.organization_id == tenant.organization_id,
            User.email == email,
        )
    )
    row = result.first()
    if row:
        member, user = row
        # Don't allow removing the last owner
        if member.role == 'owner':
            owner_count = await db.execute(
                select(func.count(OrganizationMember.id)).where(
                    OrganizationMember.organization_id == tenant.organization_id,
                    OrganizationMember.role == 'owner',
                )
            )
            if (owner_count.scalar() or 0) <= 1:
                raise HTTPException(status_code=400, detail='Cannot remove the only owner')
        await db.delete(member)
        await db.commit()
        return {'status': 'removed', 'email': email}

    # Try to cancel pending invite
    inv_result = await db.execute(
        select(Invite).where(
            Invite.organization_id == tenant.organization_id,
            Invite.email == email,
            Invite.status == 'pending',
        )
    )
    invites = inv_result.scalars().all()
    if invites:
        for inv in invites:
            await db.delete(inv)
        await db.commit()
        return {'status': 'invite_cancelled', 'email': email}

    return {'status': 'not_found', 'email': email}
