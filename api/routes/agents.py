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


STAGE_TO_ROLE = {
    'fetch_context': 'pm',
    'analyze': 'pm',
    'generate_code': 'developer',
    'code_generation': 'developer',
    'review_code': 'reviewer',
    'code_review': 'reviewer',
    'finalize': 'finalizer',
    'code_diff': 'finalizer',
    'code_preview': 'finalizer',
}

AGENT_ROLES = [
    {'id': 1, 'name': 'PM Agent', 'role': 'pm', 'color': '#5eead4', 'icon': 'clipboard'},
    {'id': 2, 'name': 'Developer', 'role': 'developer', 'color': '#a78bfa', 'icon': 'code'},
    {'id': 3, 'name': 'Reviewer', 'role': 'reviewer', 'color': '#38bdf8', 'icon': 'search'},
    {'id': 4, 'name': 'Finalizer', 'role': 'finalizer', 'color': '#22c55e', 'icon': 'rocket'},
]


@router.get('/live')
async def get_live_agents(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Return live agent status: active agents from running tasks + idle agents from recent tasks."""
    # Get running tasks -> active agents
    result = await db.execute(
        select(TaskRecord)
        .where(
            TaskRecord.organization_id == tenant.organization_id,
            TaskRecord.status == 'running',
        )
        .order_by(TaskRecord.id.desc())
    )
    running_tasks = result.scalars().all()

    task_stages: list[dict[str, Any]] = []
    active_roles: set[str] = set()

    for task in running_tasks:
        log_result = await db.execute(
            select(AgentLog)
            .where(AgentLog.task_id == task.id)
            .order_by(AgentLog.id.desc())
            .limit(1)
        )
        latest_log = log_result.scalar_one_or_none()
        current_stage = latest_log.stage if latest_log else 'fetch_context'
        role = STAGE_TO_ROLE.get(current_stage, 'pm')
        active_roles.add(role)
        task_stages.append({
            'task_id': task.id,
            'title': task.title,
            'status': task.status,
            'current_stage': current_stage,
            'active_role': role,
        })

    # Get recently completed/failed tasks (last 24h) -> idle agents who worked before
    idle_roles: set[str] = set()
    recent_result = await db.execute(
        select(TaskRecord)
        .where(
            TaskRecord.organization_id == tenant.organization_id,
            TaskRecord.status.in_(['completed', 'failed']),
        )
        .order_by(TaskRecord.id.desc())
        .limit(10)
    )
    recent_tasks = recent_result.scalars().all()

    for task in recent_tasks:
        log_result = await db.execute(
            select(AgentLog)
            .where(AgentLog.task_id == task.id)
            .order_by(AgentLog.id.desc())
            .limit(5)
        )
        logs = log_result.scalars().all()
        for log in logs:
            role = STAGE_TO_ROLE.get(log.stage)
            if role:
                idle_roles.add(role)

    # Build agent list: active ones + idle ones (from past work)
    agents = []
    seen_roles: set[str] = set()

    # Active agents first
    for agent_def in AGENT_ROLES:
        active_task = next(
            (t for t in task_stages if t['active_role'] == agent_def['role']),
            None,
        )
        if active_task:
            seen_roles.add(agent_def['role'])
            agents.append({
                **agent_def,
                'status': 'active',
                'current_task': active_task['title'],
                'current_stage': active_task['current_stage'],
                'task_id': active_task['task_id'],
            })

    # All remaining agents show as idle (always present in office)
    for agent_def in AGENT_ROLES:
        if agent_def['role'] not in seen_roles:
            agents.append({
                **agent_def,
                'status': 'idle',
                'current_task': None,
                'current_stage': None,
                'task_id': None,
            })

    return {
        'agents': agents,
        'running_tasks': task_stages,
        'active_count': sum(1 for a in agents if a['status'] == 'active'),
    }
