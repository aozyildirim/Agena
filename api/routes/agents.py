from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentTenant, get_current_tenant
from core.database import get_db_session
from core.settings import get_settings
from models.agent_log import AgentLog
from models.task_record import TaskRecord
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


import re


def _detect_active_role(message: str) -> str | None:
    """Parse agent log message to detect which pipeline role is currently active."""
    msg = message.lower()
    # Step messages from orchestration_service
    if 'fetching context' in msg:
        return 'pm'
    if 'pm analyzing' in msg or 'pm result' in msg:
        return 'pm'
    if 'ai plan' in msg or 'planning' in msg:
        return 'pm'
    if 'developer generating' in msg or 'developer result' in msg:
        return 'developer'
    if 'ai code' in msg or 'coding' in msg:
        return 'developer'
    if 'review' in msg:
        return 'qa'
    if 'finalize' in msg:
        return 'lead_developer'
    return None


def _detect_step_label(message: str) -> str:
    """Extract human-readable step label from agent log message."""
    msg = message.lower()
    if 'fetching context' in msg:
        return 'fetch_context'
    if 'pm analyzing' in msg:
        return 'pm_analyzing'
    if 'pm result' in msg:
        return 'pm_done'
    if 'developer generating' in msg:
        return 'generating_code'
    if 'developer result' in msg:
        return 'dev_done'
    if 'flow complete' in msg:
        return 'flow_complete'
    if 'ai plan' in msg:
        return 'ai_planning'
    if 'ai code' in msg:
        return 'ai_coding'
    return message[:40]


@router.get('/live')
async def get_live_agents(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Return live agent status by parsing actual pipeline execution logs."""
    # Get running tasks
    result = await db.execute(
        select(TaskRecord)
        .where(
            TaskRecord.organization_id == tenant.organization_id,
            TaskRecord.status == 'running',
        )
        .order_by(TaskRecord.id.desc())
    )
    running_tasks = result.scalars().all()

    # For each running task, find the latest agent log to detect active role
    running_info: list[dict[str, Any]] = []
    active_roles: dict[str, dict[str, Any]] = {}  # role -> task info

    for task in running_tasks:
        log_result = await db.execute(
            select(AgentLog)
            .where(AgentLog.task_id == task.id)
            .order_by(AgentLog.id.desc())
            .limit(3)
        )
        logs = log_result.scalars().all()

        detected_role = None
        step_label = 'running'
        for log in logs:
            if log.stage == 'agent':
                role = _detect_active_role(log.message)
                if role:
                    detected_role = role
                    step_label = _detect_step_label(log.message)
                    break
            elif log.stage == 'running':
                detected_role = 'manager'
                step_label = 'starting'
                break

        task_info = {
            'task_id': task.id,
            'title': task.title,
            'active_role': detected_role or 'manager',
            'step_label': step_label,
        }
        running_info.append(task_info)
        if detected_role:
            active_roles[detected_role] = task_info

    return {
        'running_tasks': running_info,
        'active_roles': active_roles,
        'active_count': len(active_roles),
    }
