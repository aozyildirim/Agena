from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_models.schemas.auth import AuthResponse, LoginRequest, MeResponse, SignupRequest
from agena_services.services.auth_service import AuthService

router = APIRouter(prefix='/auth', tags=['auth'])


@router.post('/signup', response_model=AuthResponse)
async def signup(payload: SignupRequest, db: AsyncSession = Depends(get_db_session)) -> AuthResponse:
    service = AuthService(db)
    try:
        token, user, org = await service.signup(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AuthResponse(access_token=token, user_id=user.id, organization_id=org.id, full_name=user.full_name or '', email=user.email, org_slug=org.slug or '', org_name=org.name or '', is_platform_admin=user.is_platform_admin)


@router.post('/login', response_model=AuthResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db_session)) -> AuthResponse:
    service = AuthService(db)
    try:
        token, user, org = await service.login(payload)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return AuthResponse(access_token=token, user_id=user.id, organization_id=org.id, full_name=user.full_name or '', email=user.email, org_slug=org.slug or '', org_name=org.name or '', is_platform_admin=user.is_platform_admin)


@router.get('/me', response_model=MeResponse)
async def me(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> MeResponse:
    from sqlalchemy import select
    from agena_models.models.organization import Organization
    from agena_models.models.user import User
    from agena_services.services.workspace_role_service import WorkspaceRoleService
    from agena_services.services.permission_catalog import all_permission_keys

    result = await db.execute(select(User).where(User.id == tenant.user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail='User not found')
    org_result = await db.execute(select(Organization).where(Organization.id == tenant.organization_id))
    org = org_result.scalar_one_or_none()

    # Permission set for the active workspace (if header present). Org owners
    # always get the full catalog so the UI never gates them out by mistake.
    permissions: list[str] = []
    if (tenant.role or '').lower() == 'owner':
        permissions = all_permission_keys()
    elif tenant.workspace_id is not None:
        service = WorkspaceRoleService(db)
        perms = await service.get_user_permissions(
            user_id=tenant.user_id,
            workspace_id=tenant.workspace_id,
            organization_id=tenant.organization_id,
        )
        permissions = sorted(perms)

    return MeResponse(
        user_id=user.id,
        email=user.email,
        full_name=user.full_name or '',
        organization_id=tenant.organization_id,
        org_slug=org.slug if org else '',
        org_name=org.name if org else '',
        is_platform_admin=user.is_platform_admin,
        org_role=tenant.role,
        permissions=permissions,
    )
