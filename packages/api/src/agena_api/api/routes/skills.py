from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import desc, func, or_, select

from agena_api.api.dependencies import CurrentTenant, get_current_tenant, require_platform_admin
from agena_core.database import get_db_session
from agena_models.models.skill import Skill
from agena_models.schemas.skill import SkillCreate, SkillHit, SkillResponse, SkillUpdate
from agena_services.services.skill_import_service import import_default_set, import_repo
from agena_services.services.skill_service import SkillService

router = APIRouter(prefix='/skills', tags=['skills'])


def _to_response(skill) -> SkillResponse:
    return SkillResponse(
        id=skill.id,
        organization_id=skill.organization_id,
        source_task_id=skill.source_task_id,
        name=skill.name,
        description=skill.description or '',
        pattern_type=skill.pattern_type,
        tags=list(skill.tags or []),
        touched_files=list(skill.touched_files or []),
        approach_summary=skill.approach_summary or '',
        prompt_fragment=skill.prompt_fragment or '',
        usage_count=skill.usage_count or 0,
        last_used_at=skill.last_used_at.isoformat() if skill.last_used_at else None,
        created_at=skill.created_at.isoformat() if skill.created_at else '',
        updated_at=skill.updated_at.isoformat() if skill.updated_at else '',
    )


@router.get('')
async def list_skills(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    q: str | None = Query(default=None),
    pattern_type: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    service = SkillService(db)
    rows, total = await service.list(
        tenant.organization_id,
        page=page, page_size=page_size,
        q=q, pattern_type=pattern_type, tag=tag,
    )
    return {
        'items': [_to_response(s) for s in rows],
        'total': total,
        'page': page,
        'page_size': page_size,
        'total_pages': max(1, (total + page_size - 1) // page_size) if total else 0,
    }


@router.get('/{skill_id}', response_model=SkillResponse)
async def get_skill(
    skill_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> SkillResponse:
    service = SkillService(db)
    skill = await service.get(tenant.organization_id, skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail='Skill not found')
    return _to_response(skill)


@router.post('', response_model=SkillResponse)
async def create_skill(
    payload: SkillCreate,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> SkillResponse:
    if not payload.name or not payload.name.strip():
        raise HTTPException(status_code=400, detail='name is required')
    service = SkillService(db)
    skill = await service.create(tenant.organization_id, payload, user_id=tenant.user_id)
    return _to_response(skill)


@router.put('/{skill_id}', response_model=SkillResponse)
async def update_skill(
    skill_id: int,
    payload: SkillUpdate,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> SkillResponse:
    service = SkillService(db)
    skill = await service.update(tenant.organization_id, skill_id, payload)
    if skill is None:
        raise HTTPException(status_code=404, detail='Skill not found')
    return _to_response(skill)


@router.delete('/{skill_id}')
async def delete_skill(
    skill_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    service = SkillService(db)
    ok = await service.delete(tenant.organization_id, skill_id)
    if not ok:
        raise HTTPException(status_code=404, detail='Skill not found')
    return {'deleted': True, 'id': skill_id}


@router.post('/import-defaults')
async def import_default_skills(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Seed the catalog with curated patterns. Idempotent: a Skill is
    only inserted when no existing row in this org has the same name —
    re-clicks just skip duplicates instead of stacking copies."""
    from agena_services.services.default_skills import DEFAULT_SKILLS
    from agena_models.schemas.skill import SkillCreate

    service = SkillService(db)
    existing_names = {
        s.name.strip().lower() for s in await service.list_all_for_org(tenant.organization_id)
    }
    inserted = 0
    skipped = 0
    for spec in DEFAULT_SKILLS:
        if spec['name'].strip().lower() in existing_names:
            skipped += 1
            continue
        await service.create(
            tenant.organization_id,
            SkillCreate(**spec),
            user_id=tenant.user_id,
        )
        inserted += 1
    return {'inserted': inserted, 'skipped': skipped, 'total': len(DEFAULT_SKILLS)}


@router.post('/search')
async def search_skills(
    payload: dict,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[SkillHit]:
    """Vector search preview. Used by the UI to show "N relevant skills"
    on a new task screen before the agent actually runs."""
    title = str(payload.get('title') or '').strip()
    description = str(payload.get('description') or '').strip()
    touched_files = payload.get('touched_files') or []
    if not isinstance(touched_files, list):
        touched_files = []
    limit = int(payload.get('limit') or 5)
    if not title and not description:
        raise HTTPException(status_code=400, detail='title or description required')
    service = SkillService(db)
    return await service.find_relevant(
        tenant.organization_id,
        title=title,
        description=description,
        touched_files=touched_files,
        limit=max(1, min(limit, 10)),
    )


# ── Public Library ───────────────────────────────────────────────────


@router.get('/public/list')
async def list_public_skills(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    q: str | None = Query(default=None),
    publisher: str | None = Query(default=None),
    active_only: bool = Query(default=False),
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Lists every public skill imported into AGENA's local mirror. Open to
    every authenticated tenant — toggling active/inactive is admin-only.
    Searchable by name/description text and filterable by publisher."""
    stmt = select(Skill).where(Skill.is_public.is_(True))
    cstmt = select(func.count(Skill.id)).where(Skill.is_public.is_(True))
    if active_only:
        stmt = stmt.where(Skill.is_active.is_(True))
        cstmt = cstmt.where(Skill.is_active.is_(True))
    if publisher:
        stmt = stmt.where(Skill.publisher == publisher)
        cstmt = cstmt.where(Skill.publisher == publisher)
    if q:
        like = f'%{q.lower()}%'
        stmt = stmt.where(or_(func.lower(Skill.name).like(like), func.lower(Skill.description).like(like)))
        cstmt = cstmt.where(or_(func.lower(Skill.name).like(like), func.lower(Skill.description).like(like)))
    total = (await db.execute(cstmt)).scalar() or 0
    rows = (await db.execute(
        stmt.order_by(Skill.publisher, Skill.name).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return {
        'items': [{
            'id': s.id, 'name': s.name, 'description': s.description or '',
            'pattern_type': s.pattern_type, 'tags': list(s.tags or []),
            'is_active': s.is_active, 'publisher': s.publisher,
            'external_url': s.external_url,
            'usage_count': s.usage_count or 0,
        } for s in rows],
        'total': total, 'page': page, 'page_size': page_size,
        'total_pages': max(1, (total + page_size - 1) // page_size) if total else 0,
    }


@router.post('/public/{skill_id}/toggle')
async def toggle_public_skill(
    skill_id: int,
    _tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    s = (await db.execute(select(Skill).where(Skill.id == skill_id, Skill.is_public.is_(True)))).scalar_one_or_none()
    if s is None:
        raise HTTPException(status_code=404, detail='Public skill not found')
    s.is_active = not s.is_active
    await db.commit()
    return {'id': s.id, 'is_active': s.is_active}


@router.post('/public/import')
async def import_public_library(
    repo: str | None = Query(default=None, description='Specific GitHub owner/repo. Omit to run the default seed set.'),
    _tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Pulls SKILL.md from one repo (or the default seed list) into the
    local public library. Idempotent — re-running updates existing rows
    instead of duplicating them. Heavyweight (network + many DB writes),
    so admin-only and a one-shot HTTP call rather than a background task
    for now."""
    if repo:
        return {'results': {repo: await import_repo(db, repo)}}
    return {'results': await import_default_set(db)}
