from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db_session
from models.organization_member import OrganizationMember
from models.user import User
from security.jwt import decode_token
from services.github_service import GitHubService
from services.queue_service import QueueService
from services.task_service import TaskService

bearer_scheme = HTTPBearer(auto_error=True)


@dataclass
class CurrentTenant:
    user_id: int
    organization_id: int
    email: str


def get_queue_service() -> QueueService:
    return QueueService()


def get_github_service() -> GitHubService:
    return GitHubService()


def get_task_service() -> TaskService:
    return TaskService()


async def get_current_tenant(
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
    if member_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='No organization access')

    return CurrentTenant(user_id=user_id, organization_id=org_id, email=email)
