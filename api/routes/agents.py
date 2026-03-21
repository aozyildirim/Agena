from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentTenant, get_current_tenant
from core.database import get_db_session
from core.settings import get_settings
from schemas.agent import AgentRunRequest, AgentRunResponse
from services.orchestration_service import OrchestrationService
from services.task_service import TaskService

router = APIRouter(prefix='/agents', tags=['agents'])


def _can_create_pr() -> bool:
    settings = get_settings()
    token = (settings.github_token or '').strip()
    owner = (settings.github_owner or '').strip()
    repo = (settings.github_repo or '').strip()
    if not token or not owner or not repo:
        return False
    if token.startswith('your_') or owner.startswith('your_') or repo.startswith('your_'):
        return False
    return True


@router.post('/run', response_model=AgentRunResponse)
async def run_agents(
    request: AgentRunRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> AgentRunResponse:
    task_service = TaskService(db)
    task = await task_service.create_task(
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        title=request.task.title,
        description=request.task.description,
    )

    if request.async_mode:
        create_pr = request.create_pr and _can_create_pr()
        queue_key = await task_service.assign_task_to_ai(
            organization_id=tenant.organization_id,
            task_id=task.id,
            create_pr=create_pr,
        )
        return AgentRunResponse(status='queued', queue_key=queue_key)

    service = OrchestrationService(db_session=db)
    try:
        create_pr = request.create_pr and _can_create_pr()
        result = await service.run_task_record(
            organization_id=tenant.organization_id,
            task_id=task.id,
            create_pr=create_pr,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return AgentRunResponse(status='completed', result=result)
