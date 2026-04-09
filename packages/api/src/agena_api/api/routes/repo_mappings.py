from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant, require_permission
from agena_core.database import get_db_session
from agena_models.models.repo_mapping import RepoMapping

router = APIRouter(prefix='/repo-mappings', tags=['repo-mappings'])


class RepoMappingCreate(BaseModel):
    provider: str  # github | azure
    owner: str
    repo_name: str
    base_branch: str = 'main'
    local_repo_path: str | None = None
    playbook: str | None = None
    is_default: bool = False


class RepoMappingUpdate(BaseModel):
    base_branch: str | None = None
    local_repo_path: str | None = None
    playbook: str | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class RepoMappingResponse(BaseModel):
    id: int
    provider: str
    owner: str
    repo_name: str
    base_branch: str
    local_repo_path: str | None
    playbook: str | None
    is_default: bool
    is_active: bool
    display_name: str = ''

    class Config:
        from_attributes = True

    def model_post_init(self, __context: object) -> None:
        if not self.display_name:
            self.display_name = f"{self.provider}:{self.owner}/{self.repo_name}"


@router.get('', response_model=list[RepoMappingResponse])
async def list_repo_mappings(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
):
    stmt = (
        select(RepoMapping)
        .where(
            RepoMapping.organization_id == tenant.organization_id,
            RepoMapping.is_active.is_(True),
        )
        .order_by(RepoMapping.is_default.desc(), RepoMapping.created_at.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.post('', response_model=RepoMappingResponse, status_code=201)
async def create_repo_mapping(
    body: RepoMappingCreate,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
):
    if body.provider not in ('github', 'azure'):
        raise HTTPException(400, 'Provider must be github or azure')

    # If setting as default, unset other defaults
    if body.is_default:
        stmt = select(RepoMapping).where(
            RepoMapping.organization_id == tenant.organization_id,
            RepoMapping.is_default.is_(True),
        )
        for row in (await db.execute(stmt)).scalars().all():
            row.is_default = False

    # Check if mapping already exists (upsert)
    existing = (await db.execute(
        select(RepoMapping).where(
            RepoMapping.organization_id == tenant.organization_id,
            RepoMapping.provider == body.provider,
            RepoMapping.owner == body.owner.strip(),
            RepoMapping.repo_name == body.repo_name.strip(),
        )
    )).scalar_one_or_none()

    if existing:
        existing.base_branch = body.base_branch
        if body.local_repo_path is not None:
            existing.local_repo_path = body.local_repo_path
        if body.playbook is not None:
            existing.playbook = body.playbook
        existing.is_active = True
        if body.is_default:
            existing.is_default = True
        await db.commit()
        await db.refresh(existing)
        return existing

    mapping = RepoMapping(
        organization_id=tenant.organization_id,
        provider=body.provider,
        owner=body.owner.strip(),
        repo_name=body.repo_name.strip(),
        base_branch=body.base_branch,
        local_repo_path=body.local_repo_path,
        playbook=body.playbook,
        is_default=body.is_default,
    )
    db.add(mapping)
    await db.commit()
    await db.refresh(mapping)
    return mapping


@router.put('/{mapping_id}', response_model=RepoMappingResponse)
async def update_repo_mapping(
    mapping_id: int,
    body: RepoMappingUpdate,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
):
    mapping = await db.get(RepoMapping, mapping_id)
    if not mapping or mapping.organization_id != tenant.organization_id:
        raise HTTPException(404, 'Repo mapping not found')

    if body.base_branch is not None:
        mapping.base_branch = body.base_branch
    if body.local_repo_path is not None:
        mapping.local_repo_path = body.local_repo_path
    if body.playbook is not None:
        mapping.playbook = body.playbook
    if body.is_active is not None:
        mapping.is_active = body.is_active
    if body.is_default is not None:
        if body.is_default:
            stmt = select(RepoMapping).where(
                RepoMapping.organization_id == tenant.organization_id,
                RepoMapping.is_default.is_(True),
                RepoMapping.id != mapping_id,
            )
            for row in (await db.execute(stmt)).scalars().all():
                row.is_default = False
        mapping.is_default = body.is_default

    await db.commit()
    await db.refresh(mapping)
    return mapping


@router.delete('/{mapping_id}', status_code=204)
async def delete_repo_mapping(
    mapping_id: int,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
    db: AsyncSession = Depends(get_db_session),
):
    mapping = await db.get(RepoMapping, mapping_id)
    if not mapping or mapping.organization_id != tenant.organization_id:
        raise HTTPException(404, 'Repo mapping not found')
    await db.delete(mapping)
    await db.commit()
