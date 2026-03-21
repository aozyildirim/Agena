from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentTenant, get_current_tenant
from core.database import get_db_session
from schemas.org import InviteRequest, InviteResponse
from services.org_service import OrgService

router = APIRouter(prefix='/org', tags=['organization'])


class AcceptInviteRequest(BaseModel):
    token: str


@router.post('/invite', response_model=InviteResponse)
async def invite_member(
    request: InviteRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> InviteResponse:
    service = OrgService(db)
    invite = await service.invite_user(tenant.organization_id, request.email)
    return InviteResponse(invite_token=invite.token, status=invite.status)


@router.post('/invite/accept')
async def accept_invite(
    request: AcceptInviteRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    service = OrgService(db)
    try:
        await service.accept_invite(request.token, tenant.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {'status': 'accepted'}
