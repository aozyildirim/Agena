from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentTenant, get_current_tenant
from core.database import get_db_session
from schemas.auth import AuthResponse, LoginRequest, MeResponse, SignupRequest
from services.auth_service import AuthService

router = APIRouter(prefix='/auth', tags=['auth'])


@router.post('/signup', response_model=AuthResponse)
async def signup(payload: SignupRequest, db: AsyncSession = Depends(get_db_session)) -> AuthResponse:
    service = AuthService(db)
    try:
        token, user, org_id = await service.signup(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AuthResponse(access_token=token, user_id=user.id, organization_id=org_id, full_name=user.full_name or '', email=user.email)


@router.post('/login', response_model=AuthResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db_session)) -> AuthResponse:
    service = AuthService(db)
    try:
        token, user, org_id = await service.login(payload)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return AuthResponse(access_token=token, user_id=user.id, organization_id=org_id, full_name=user.full_name or '', email=user.email)


@router.get('/me', response_model=MeResponse)
async def me(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> MeResponse:
    from sqlalchemy import select
    from models.user import User
    result = await db.execute(select(User).where(User.id == tenant.user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail='User not found')
    return MeResponse(user_id=user.id, email=user.email, full_name=user.full_name or '', organization_id=tenant.organization_id)
