from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_models.schemas.skill import SkillCreate, SkillHit, SkillResponse, SkillUpdate
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
