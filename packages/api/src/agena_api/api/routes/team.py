"""Team member product/developer classification.

Members come from external providers and carry no role field, so the
team page persists a product|developer bucket here keyed by org + email.
A bucket is either auto-derived from a member's assigned work-item types
(source='auto') or set explicitly by a user (source='manual'); a manual
override is never clobbered by a later auto pass.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_models.models.team_member_type import TeamMemberType

router = APIRouter(prefix='/team', tags=['team'])

VALID_TYPES = {'product', 'developer'}
VALID_SOURCES = {'auto', 'manual'}


class MemberTypeUpsert(BaseModel):
    email: str
    member_type: str  # product | developer
    source: str = 'manual'  # auto | manual
    display_name: str | None = None
    provider: str | None = None


class MemberTypeResponse(BaseModel):
    email: str
    member_type: str
    source: str
    display_name: str | None = None
    provider: str | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


@router.get('/member-types', response_model=list[MemberTypeResponse])
async def list_member_types(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[TeamMemberType]:
    rows = await db.execute(
        select(TeamMemberType).where(
            TeamMemberType.organization_id == tenant.organization_id
        )
    )
    return list(rows.scalars().all())


@router.put('/member-types', response_model=MemberTypeResponse)
async def upsert_member_type(
    payload: MemberTypeUpsert,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> TeamMemberType:
    email = (payload.email or '').strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail='email is required')
    if payload.member_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail='member_type must be product|developer')
    source = payload.source if payload.source in VALID_SOURCES else 'manual'

    existing = (
        await db.execute(
            select(TeamMemberType).where(
                TeamMemberType.organization_id == tenant.organization_id,
                TeamMemberType.email == email,
            )
        )
    ).scalar_one_or_none()

    if existing is not None:
        # A manual classification is authoritative — never let a later
        # auto pass silently overwrite a human decision.
        if source == 'auto' and existing.source == 'manual':
            return existing
        existing.member_type = payload.member_type
        existing.source = source
        if payload.display_name:
            existing.display_name = payload.display_name
        if payload.provider:
            existing.provider = payload.provider
        await db.commit()
        await db.refresh(existing)
        return existing

    row = TeamMemberType(
        organization_id=tenant.organization_id,
        email=email,
        display_name=payload.display_name,
        provider=payload.provider,
        member_type=payload.member_type,
        source=source,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.delete('/member-types/{email}')
async def delete_member_type(
    email: str,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    existing = (
        await db.execute(
            select(TeamMemberType).where(
                TeamMemberType.organization_id == tenant.organization_id,
                TeamMemberType.email == (email or '').strip().lower(),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        await db.delete(existing)
        await db.commit()
    return {'ok': True}
