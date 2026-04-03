from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, require_platform_admin
from agena_core.database import get_db_session
from agena_models.models.contact_submission import ContactSubmission
from agena_models.models.newsletter_subscriber import NewsletterSubscriber
from agena_models.models.organization import Organization
from agena_models.models.organization_member import OrganizationMember
from agena_models.models.subscription import Subscription
from agena_models.models.task_record import TaskRecord
from agena_models.models.user import User

router = APIRouter(prefix='/admin', tags=['admin'])


# ── Organizations ──


@router.get('/organizations')
async def list_organizations(
    _: CurrentTenant = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    orgs = await db.execute(
        select(Organization).order_by(Organization.created_at.desc())
    )
    rows = []
    for org in orgs.scalars().all():
        member_count = await db.execute(
            select(func.count()).where(OrganizationMember.organization_id == org.id)
        )
        task_count = await db.execute(
            select(func.count()).where(TaskRecord.organization_id == org.id)
        )
        sub = await db.execute(
            select(Subscription).where(Subscription.organization_id == org.id)
        )
        subscription = sub.scalar_one_or_none()
        rows.append({
            'id': org.id,
            'name': org.name,
            'slug': org.slug,
            'created_at': org.created_at.isoformat() if org.created_at else None,
            'member_count': member_count.scalar() or 0,
            'task_count': task_count.scalar() or 0,
            'plan': subscription.plan_name if subscription else 'free',
            'plan_status': subscription.status if subscription else 'none',
        })
    return rows


@router.get('/organizations/{org_id}')
async def get_organization(
    org_id: int,
    _: CurrentTenant = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    org = await db.execute(select(Organization).where(Organization.id == org_id))
    org_obj = org.scalar_one_or_none()
    if not org_obj:
        raise HTTPException(status_code=404, detail='Organization not found')

    members_result = await db.execute(
        select(OrganizationMember, User)
        .join(User, User.id == OrganizationMember.user_id)
        .where(OrganizationMember.organization_id == org_id)
    )
    members = [
        {
            'user_id': m.user_id,
            'email': u.email,
            'full_name': u.full_name,
            'role': m.role,
            'joined_at': m.created_at.isoformat() if m.created_at else None,
        }
        for m, u in members_result.all()
    ]

    sub = await db.execute(select(Subscription).where(Subscription.organization_id == org_id))
    subscription = sub.scalar_one_or_none()

    return {
        'id': org_obj.id,
        'name': org_obj.name,
        'slug': org_obj.slug,
        'created_at': org_obj.created_at.isoformat() if org_obj.created_at else None,
        'members': members,
        'plan': subscription.plan_name if subscription else 'free',
        'plan_status': subscription.status if subscription else 'none',
    }


@router.put('/organizations/{org_id}/plan')
async def update_org_plan(
    org_id: int,
    plan_name: str = Query(...),
    _: CurrentTenant = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    sub = await db.execute(select(Subscription).where(Subscription.organization_id == org_id))
    subscription = sub.scalar_one_or_none()
    if not subscription:
        raise HTTPException(status_code=404, detail='Subscription not found')
    subscription.plan_name = plan_name
    await db.commit()
    return {'status': 'ok', 'plan': plan_name}


@router.delete('/organizations/{org_id}')
async def delete_organization(
    org_id: int,
    _: CurrentTenant = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    org = await db.execute(select(Organization).where(Organization.id == org_id))
    if not org.scalar_one_or_none():
        raise HTTPException(status_code=404, detail='Organization not found')
    await db.execute(
        select(Organization).where(Organization.id == org_id)
    )
    org_obj = (await db.execute(select(Organization).where(Organization.id == org_id))).scalar_one()
    await db.delete(org_obj)
    await db.commit()
    return {'status': 'deleted'}


# ── Users ──


@router.get('/users')
async def list_users(
    _: CurrentTenant = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    users = await db.execute(select(User).order_by(User.created_at.desc()))
    rows = []
    for u in users.scalars().all():
        org_result = await db.execute(
            select(OrganizationMember, Organization)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(OrganizationMember.user_id == u.id)
        )
        orgs = [{'id': o.id, 'name': o.name, 'role': m.role} for m, o in org_result.all()]
        rows.append({
            'id': u.id,
            'email': u.email,
            'full_name': u.full_name,
            'is_active': u.is_active,
            'is_platform_admin': u.is_platform_admin,
            'created_at': u.created_at.isoformat() if u.created_at else None,
            'organizations': orgs,
        })
    return rows


@router.put('/users/{user_id}/toggle-active')
async def toggle_user_active(
    user_id: int,
    _: CurrentTenant = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail='User not found')
    user.is_active = not user.is_active
    await db.commit()
    return {'id': user.id, 'is_active': user.is_active}


@router.put('/users/{user_id}/toggle-admin')
async def toggle_platform_admin(
    user_id: int,
    tenant: CurrentTenant = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    if user_id == tenant.user_id:
        raise HTTPException(status_code=400, detail='Cannot change your own admin status')
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail='User not found')
    user.is_platform_admin = not user.is_platform_admin
    await db.commit()
    return {'id': user.id, 'is_platform_admin': user.is_platform_admin}


# ── Contact Submissions ──


@router.get('/contact')
async def list_contact_submissions(
    _: CurrentTenant = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    result = await db.execute(
        select(ContactSubmission).order_by(ContactSubmission.created_at.desc())
    )
    return [
        {
            'id': c.id,
            'name': c.name,
            'email': c.email,
            'message': c.message,
            'newsletter': c.newsletter,
            'is_read': c.is_read,
            'created_at': c.created_at.isoformat() if c.created_at else None,
        }
        for c in result.scalars().all()
    ]


@router.put('/contact/{submission_id}/read')
async def mark_contact_read(
    submission_id: int,
    _: CurrentTenant = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    await db.execute(
        update(ContactSubmission).where(ContactSubmission.id == submission_id).values(is_read=True)
    )
    await db.commit()
    return {'status': 'ok'}


@router.delete('/contact/{submission_id}')
async def delete_contact_submission(
    submission_id: int,
    _: CurrentTenant = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    obj = (await db.execute(select(ContactSubmission).where(ContactSubmission.id == submission_id))).scalar_one_or_none()
    if obj:
        await db.delete(obj)
        await db.commit()
    return {'status': 'deleted'}


# ── Newsletter ──


@router.get('/newsletter')
async def list_newsletter_subscribers(
    _: CurrentTenant = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    result = await db.execute(
        select(NewsletterSubscriber).order_by(NewsletterSubscriber.created_at.desc())
    )
    return [
        {
            'id': s.id,
            'email': s.email,
            'is_active': s.is_active,
            'created_at': s.created_at.isoformat() if s.created_at else None,
        }
        for s in result.scalars().all()
    ]


@router.delete('/newsletter/{sub_id}')
async def delete_newsletter_subscriber(
    sub_id: int,
    _: CurrentTenant = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    obj = (await db.execute(select(NewsletterSubscriber).where(NewsletterSubscriber.id == sub_id))).scalar_one_or_none()
    if obj:
        await db.delete(obj)
        await db.commit()
    return {'status': 'deleted'}


# ── Platform Stats ──


@router.get('/stats')
async def platform_stats(
    _: CurrentTenant = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    org_count = (await db.execute(select(func.count()).select_from(Organization))).scalar() or 0
    user_count = (await db.execute(select(func.count()).select_from(User))).scalar() or 0
    task_count = (await db.execute(select(func.count()).select_from(TaskRecord))).scalar() or 0
    contact_count = (await db.execute(select(func.count()).select_from(ContactSubmission))).scalar() or 0
    newsletter_count = (await db.execute(select(func.count()).select_from(NewsletterSubscriber))).scalar() or 0
    unread_contact = (await db.execute(
        select(func.count()).where(ContactSubmission.is_read == False)  # noqa: E712
    )).scalar() or 0

    return {
        'organizations': org_count,
        'users': user_count,
        'tasks': task_count,
        'contact_submissions': contact_count,
        'unread_contacts': unread_contact,
        'newsletter_subscribers': newsletter_count,
    }
