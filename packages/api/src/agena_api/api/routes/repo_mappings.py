from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant, require_permission, require_workspace_perm
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


@router.post(
    '',
    response_model=RepoMappingResponse,
    status_code=201,
    dependencies=[Depends(require_workspace_perm('repo:manage'))],
)
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


@router.put(
    '/{mapping_id}',
    response_model=RepoMappingResponse,
    dependencies=[Depends(require_workspace_perm('repo:manage'))],
)
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


@router.delete(
    '/{mapping_id}',
    status_code=204,
    dependencies=[Depends(require_workspace_perm('repo:manage'))],
)
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


class RepoIndexStatus(BaseModel):
    indexed: bool
    points_count: int
    head_sha: str | None
    local_repo_path: str | None
    current_head_sha: str | None
    is_fresh: bool


@router.get('/index-status', response_model=RepoIndexStatus)
async def get_repo_index_status(
    path: str,
    tenant: CurrentTenant = Depends(get_current_tenant),
) -> RepoIndexStatus:
    """Inspect the repo_files index for a given on-disk repo path. The
    indexer keys points by `(organization_id, repo_root)`, so the same
    path string the orchestrator passes in is the lookup key here.
    """
    if not path:
        return RepoIndexStatus(
            indexed=False, points_count=0, head_sha=None,
            local_repo_path=None, current_head_sha=None, is_fresh=False,
        )

    from agena_agents.memory.repo_index import RepoFileIndexer
    indexer = RepoFileIndexer()
    if not indexer.enabled:
        return RepoIndexStatus(
            indexed=False, points_count=0, head_sha=None,
            local_repo_path=path, current_head_sha=None, is_fresh=False,
        )

    current_sha = indexer._head_sha(path)
    stored_sha: str | None = None
    points_count = 0
    try:
        await indexer.ensure_collection()
        from qdrant_client.models import FieldCondition, Filter, MatchValue
        flt = Filter(must=[
            FieldCondition(key='organization_id', match=MatchValue(value=int(tenant.organization_id))),
            FieldCondition(key='repo_root', match=MatchValue(value=indexer._normalize_path(path))),
        ])
        count_resp = await indexer.client.count(
            collection_name='repo_files', count_filter=flt, exact=True,
        )
        points_count = int(getattr(count_resp, 'count', 0) or 0)
        if points_count > 0:
            batch, _ = await indexer.client.scroll(
                collection_name='repo_files',
                scroll_filter=flt,
                limit=1, with_payload=True, with_vectors=False,
            )
            if batch:
                stored_sha = (batch[0].payload or {}).get('head_sha')
    except Exception:
        pass

    return RepoIndexStatus(
        indexed=points_count > 0,
        points_count=points_count,
        head_sha=stored_sha,
        local_repo_path=path,
        current_head_sha=current_sha or None,
        is_fresh=bool(stored_sha and current_sha and stored_sha == current_sha),
    )


@router.post('/reindex', status_code=202)
async def reindex_repo_mapping(
    path: str,
    tenant: CurrentTenant = Depends(require_permission('integrations:manage')),
):
    """Fire-and-forget reindex: drops the existing points for this repo
    and rebuilds from the current on-disk source. Returns 202; poll
    `/repo-mappings/index-status` to watch progress.
    """
    import asyncio
    if not path:
        raise HTTPException(400, 'path query param is required')

    from agena_agents.memory.repo_index import RepoFileIndexer
    indexer = RepoFileIndexer()
    if not indexer.enabled:
        raise HTTPException(503, 'Qdrant is disabled; cannot reindex')

    org_id = tenant.organization_id

    async def _bg():
        try:
            await indexer._delete_for_repo(repo_path=path, organization_id=org_id)
            await indexer.ensure_indexed(repo_path=path, organization_id=org_id)
        except Exception:
            pass

    asyncio.create_task(_bg())
    return {'status': 'reindex_started', 'path': path}
