import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_core.security.jwt import create_access_token
from agena_models.models.organization import Organization
from agena_models.models.user import User
from agena_models.schemas.auth import AuthResponse, ChangePasswordRequest, LoginRequest, LogoutAllResponse, MeResponse, SignupRequest
from agena_services.services.audit_actions import client_ip
from agena_services.services.audit_service import AuditService
from agena_services.services.auth_service import AuthService

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/auth', tags=['auth'])


async def _record_auth_event(db: AsyncSession, request: Request, action: str, user, org) -> None:
    """Login/signup happen before there is a tenant on the request, so the
    audit middleware cannot see them; record them here. Never lets a
    bookkeeping failure turn into a failed sign-in."""
    try:
        await AuditService(db).record(
            organization_id=org.id,
            action=action,
            actor_user_id=user.id,
            actor_email=user.email,
            method=request.method,
            path=request.url.path,
            status_code=200,
            request_id=getattr(request.state, 'request_id', None),
            ip_address=client_ip(request.headers, request.client.host if request.client else None),
            user_agent=request.headers.get('user-agent'),
        )
    except Exception:
        logger.warning('audit: failed to record %s for user %s', action, getattr(user, 'id', None), exc_info=True)


@router.post('/signup', response_model=AuthResponse)
async def signup(payload: SignupRequest, request: Request, db: AsyncSession = Depends(get_db_session)) -> AuthResponse:
    service = AuthService(db)
    try:
        token, user, org = await service.signup(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _record_auth_event(db, request, 'auth.signup', user, org)
    return AuthResponse(access_token=token, user_id=user.id, organization_id=org.id, full_name=user.full_name or '', email=user.email, org_slug=org.slug or '', org_name=org.name or '', is_platform_admin=user.is_platform_admin)


@router.post('/login', response_model=AuthResponse)
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db_session)) -> AuthResponse:
    service = AuthService(db)
    try:
        token, user, org = await service.login(payload)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    await _record_auth_event(db, request, 'auth.login', user, org)
    return AuthResponse(access_token=token, user_id=user.id, organization_id=org.id, full_name=user.full_name or '', email=user.email, org_slug=org.slug or '', org_name=org.name or '', is_platform_admin=user.is_platform_admin)


@router.post('/change-password', response_model=AuthResponse)
async def change_password(
    payload: ChangePasswordRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> AuthResponse:
    """Changes the password and signs every *other* session out. The
    response carries a fresh token so the caller's own session continues."""
    if tenant.api_key_id is not None:
        raise HTTPException(status_code=403, detail='Passwords cannot be changed with an API key')
    user = await db.get(User, tenant.user_id)
    org = await db.get(Organization, tenant.organization_id)
    if user is None or org is None:
        raise HTTPException(status_code=404, detail='User not found')
    try:
        await AuthService(db).change_password(user, payload.current_password, payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    token = create_access_token(
        subject=user.email, org_id=org.id, user_id=user.id,
        is_platform_admin=user.is_platform_admin, token_version=user.token_version or 0,
    )
    return AuthResponse(access_token=token, user_id=user.id, organization_id=org.id, full_name=user.full_name or '', email=user.email, org_slug=org.slug or '', org_name=org.name or '', is_platform_admin=user.is_platform_admin)


@router.post('/logout-all', response_model=LogoutAllResponse)
async def logout_all(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> LogoutAllResponse:
    """Sign out everywhere — including the session making this call."""
    if tenant.api_key_id is not None:
        raise HTTPException(status_code=403, detail='Sessions cannot be revoked with an API key')
    user = await db.get(User, tenant.user_id)
    if user is None:
        raise HTTPException(status_code=404, detail='User not found')
    version = await AuthService(db).revoke_all_sessions(user)
    return LogoutAllResponse(revoked=True, token_version=version)


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
