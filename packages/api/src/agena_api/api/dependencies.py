from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_core.database import get_db_session
from agena_core.rbac import has_permission
from agena_models.models.organization_member import OrganizationMember
from agena_models.models.user import User
from agena_core.security.jwt import decode_token
from agena_services.services.github_service import GitHubService
from agena_services.services.queue_service import QueueService
from agena_services.services.task_service import TaskService

bearer_scheme = HTTPBearer(auto_error=True)


@dataclass
class CurrentTenant:
    user_id: int
    organization_id: int
    email: str
    role: str


def get_queue_service() -> QueueService:
    return QueueService()


def get_github_service() -> GitHubService:
    return GitHubService()


def get_task_service() -> TaskService:
    return TaskService()


async def get_current_tenant(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db_session),
) -> CurrentTenant:
    token = credentials.credentials
    try:
        payload = decode_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid token') from exc

    user_id = int(payload.get('user_id', 0) or 0)
    org_id = int(payload.get('org_id', 0) or 0)
    email = str(payload.get('sub', ''))

    if user_id <= 0 or org_id <= 0:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid auth context')

    # Enforce subdomain isolation: if middleware resolved a tenant org_id
    # from the subdomain, the JWT's org must match it.
    tenant_org_id = getattr(request.state, 'tenant_org_id', None)
    if tenant_org_id is not None and tenant_org_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Your account does not belong to this organization',
        )

    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='User not found')

    member_result = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == user_id,
        )
    )
    member = member_result.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='No organization access')

    return CurrentTenant(user_id=user_id, organization_id=org_id, email=email, role=member.role or 'member')


def require_permission(permission: str) -> Callable:
    """FastAPI dependency factory that checks the current tenant's role against
    the RBAC permission matrix.  Usage::

        @router.post('/something')
        async def endpoint(
            tenant: CurrentTenant = Depends(require_permission('billing:manage')),
        ):
            ...
    """

    async def _check(
        tenant: CurrentTenant = Depends(get_current_tenant),
    ) -> CurrentTenant:
        if not has_permission(tenant.role, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f'Permission denied: {permission}',
            )
        return tenant

    return _check
