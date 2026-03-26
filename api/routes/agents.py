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
            agent_role=request.agent_role,
            agent_model=request.agent_model,
            agent_provider=request.agent_provider,
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


def _parse_pipeline_state(logs: list) -> tuple[str | None, str]:
    """Parse recent agent logs to detect which role is CURRENTLY working.

    Returns (active_role, step_label). Only returns a role if that step
    is still in progress (not yet finished).

    Log sequence for flow mode:
      "Step 1/3: Fetching context"     → pm active
      "Step 2/3: PM analyzing"         → pm active
      "PM result:"                     → pm DONE
      "Step 3/3: Developer generating" → developer active
      "Developer result:"              → developer DONE
      "Flow complete"                  → nobody active
    """
    for log in logs:  # logs are newest-first
        msg = log.message.lower() if hasattr(log, 'message') else str(log).lower()
        stage = log.stage if hasattr(log, 'stage') else ''

        # Finished signals - nobody from this step is active anymore
        if 'flow complete' in msg:
            return None, 'flow_complete'
        if 'developer result' in msg:
            return None, 'dev_done'
        if 'pm result' in msg:
            return None, 'pm_done'
        if 'ai code' in msg and 'result' in msg:
            return None, 'ai_code_done'
        if 'ai plan' in msg and 'result' in msg:
            return None, 'ai_plan_done'

        # Active signals - this role is currently working
        if 'developer generating' in msg or 'step 3' in msg:
            return 'developer', 'generating_code'
        if 'ai code' in msg:
            return 'developer', 'ai_coding'
        if 'pm analyzing' in msg or 'step 2' in msg:
            return 'pm', 'pm_analyzing'
        if 'ai plan' in msg:
            return 'pm', 'ai_planning'
        if 'fetching context' in msg or 'step 1' in msg:
            return 'pm', 'fetch_context'
        if 'review' in msg and 'result' not in msg:
            return 'qa', 'reviewing'
        if 'finalize' in msg and 'result' not in msg:
            return 'lead_developer', 'finalizing'

        # Non-agent stages
        if stage == 'running':
            return 'manager', 'starting'
        if stage in ('code_ready', 'code_preview', 'code_diff', 'local_exec'):
            return 'lead_developer', stage
        if stage == 'pr':
            return 'lead_developer', 'creating_pr'
        if stage in ('completed', 'failed', 'cancelled'):
            return None, stage

    return None, 'unknown'


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

    # For each running task, parse logs to find who is CURRENTLY working
    running_info: list[dict[str, Any]] = []
    active_roles: dict[str, dict[str, Any]] = {}  # role -> task info

    for task in running_tasks:
        log_result = await db.execute(
            select(AgentLog)
            .where(AgentLog.task_id == task.id)
            .order_by(AgentLog.id.desc())
            .limit(5)
        )
        logs = log_result.scalars().all()

        detected_role, step_label = _parse_pipeline_state(logs)

        task_info = {
            'task_id': task.id,
            'title': task.title,
            'active_role': detected_role,
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
