import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentTenant, get_current_tenant
from core.database import get_db_session
from models.user_preference import UserPreference
from services.ai_usage_event_service import AIUsageEventService

router = APIRouter(prefix='/preferences', tags=['preferences'])


class PreferencePayload(BaseModel):
    azure_project: str | None = None
    azure_team: str | None = None
    azure_sprint_path: str | None = None
    my_team: list[dict[str, Any]] | None = None
    agents: list[dict[str, Any]] | None = None
    flows: list[dict[str, Any]] | None = None
    repo_mappings: list[dict[str, Any]] | None = None
    profile_settings: dict[str, Any] | None = None


class PreferenceResponse(BaseModel):
    azure_project: str | None
    azure_team: str | None
    azure_sprint_path: str | None
    my_team: list[dict[str, Any]]
    agents: list[dict[str, Any]]
    flows: list[dict[str, Any]]
    repo_mappings: list[dict[str, Any]]
    profile_settings: dict[str, Any]


class RepoProfileScanRequest(BaseModel):
    mapping_id: str
    mapping_name: str
    local_path: str
    azure_repo_name: str | None = None


class RepoProfileScanResponse(BaseModel):
    mapping_id: str
    profile: dict[str, Any]


def _parse_json(val: str | None) -> list[dict[str, Any]]:
    if not val:
        return []
    try:
        parsed = json.loads(val)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def _parse_json_obj(val: str | None) -> dict[str, Any]:
    if not val:
        return {}
    try:
        parsed = json.loads(val)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _estimate_tokens(text: str) -> int:
    content = (text or '').strip()
    if not content:
        return 0
    return max(1, (len(content) + 3) // 4)


def _build_repo_profile(local_path: str, mapping_name: str, azure_repo_name: str | None = None) -> dict[str, Any]:
    root = Path(local_path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError(f'Local repo path is not reachable: {local_path}')

    top_dirs: list[str] = []
    top_files: list[str] = []
    for entry in sorted(root.iterdir(), key=lambda e: e.name.lower()):
        if entry.name.startswith('.'):
            continue
        if entry.is_dir():
            top_dirs.append(entry.name)
        elif entry.is_file():
            top_files.append(entry.name)
        if len(top_dirs) + len(top_files) >= 36:
            break

    stack: list[str] = []
    test_commands: list[str] = []
    lint_commands: list[str] = []
    package_manager: str | None = None

    if (root / 'package.json').exists():
        stack.append('Node.js/TypeScript')
        if (root / 'pnpm-lock.yaml').exists():
            package_manager = 'pnpm'
        elif (root / 'yarn.lock').exists():
            package_manager = 'yarn'
        elif (root / 'package-lock.json').exists():
            package_manager = 'npm'
        test_commands.append(f'{package_manager or "npm"} test')
        lint_commands.append(f'{package_manager or "npm"} run lint')
    if (root / 'requirements.txt').exists() or (root / 'pyproject.toml').exists():
        stack.append('Python')
        test_commands.append('pytest')
        lint_commands.append('ruff check .')
    if (root / 'go.mod').exists():
        stack.append('Go')
        test_commands.append('go test ./...')
        lint_commands.append('go vet ./...')
    if (root / 'pom.xml').exists():
        stack.append('Java (Maven)')
        test_commands.append('mvn test')
        lint_commands.append('mvn -q -DskipTests verify')
    if (root / 'build.gradle').exists() or (root / 'build.gradle.kts').exists():
        stack.append('Java/Kotlin (Gradle)')
        test_commands.append('./gradlew test')
        lint_commands.append('./gradlew check')
    if (root / 'Dockerfile').exists():
        stack.append('Dockerized')

    if not stack:
        stack.append('Unknown/Custom')

    return {
        'mapping_name': mapping_name,
        'azure_repo_name': azure_repo_name,
        'local_path': str(root),
        'stack': stack,
        'package_manager': package_manager,
        'suggested_test_commands': test_commands[:3],
        'suggested_lint_commands': lint_commands[:3],
        'top_directories': top_dirs[:18],
        'top_files': top_files[:18],
        'profile_version': 1,
        'scanned_at': datetime.utcnow().isoformat() + 'Z',
    }


async def _get_or_create_pref(db: AsyncSession, user_id: int) -> UserPreference:
    result = await db.execute(select(UserPreference).where(UserPreference.user_id == user_id))
    pref = result.scalar_one_or_none()
    if pref is None:
        pref = UserPreference(user_id=user_id)
        db.add(pref)
        await db.flush()
    return pref


@router.get('', response_model=PreferenceResponse)
async def get_preferences(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> PreferenceResponse:
    result = await db.execute(
        select(UserPreference).where(UserPreference.user_id == tenant.user_id)
    )
    pref = result.scalar_one_or_none()
    if pref is None:
        return PreferenceResponse(
            azure_project=None, azure_team=None, azure_sprint_path=None,
            my_team=[], agents=[], flows=[], repo_mappings=[], profile_settings={},
        )
    return PreferenceResponse(
        azure_project=pref.azure_project,
        azure_team=pref.azure_team,
        azure_sprint_path=pref.azure_sprint_path,
        my_team=_parse_json(pref.my_team_json),
        agents=_parse_json(pref.agents_json),
        flows=_parse_json(pref.flows_json),
        repo_mappings=_parse_json(pref.repo_mappings_json),
        profile_settings=_parse_json_obj(pref.profile_settings_json),
    )


@router.put('', response_model=PreferenceResponse)
async def save_preferences(
    payload: PreferencePayload,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> PreferenceResponse:
    pref = await _get_or_create_pref(db, tenant.user_id)

    if payload.azure_project is not None:
        pref.azure_project = payload.azure_project
    if payload.azure_team is not None:
        pref.azure_team = payload.azure_team
    if payload.azure_sprint_path is not None:
        pref.azure_sprint_path = payload.azure_sprint_path
    if payload.my_team is not None:
        pref.my_team_json = json.dumps(payload.my_team, ensure_ascii=False)
    if payload.agents is not None:
        pref.agents_json = json.dumps(payload.agents, ensure_ascii=False)
    if payload.flows is not None:
        pref.flows_json = json.dumps(payload.flows, ensure_ascii=False)
    if payload.repo_mappings is not None:
        pref.repo_mappings_json = json.dumps(payload.repo_mappings, ensure_ascii=False)
    if payload.profile_settings is not None:
        pref.profile_settings_json = json.dumps(payload.profile_settings, ensure_ascii=False)

    await db.commit()
    await db.refresh(pref)

    return PreferenceResponse(
        azure_project=pref.azure_project,
        azure_team=pref.azure_team,
        azure_sprint_path=pref.azure_sprint_path,
        my_team=_parse_json(pref.my_team_json),
        agents=_parse_json(pref.agents_json),
        flows=_parse_json(pref.flows_json),
        repo_mappings=_parse_json(pref.repo_mappings_json),
        profile_settings=_parse_json_obj(pref.profile_settings_json),
    )


@router.post('/repo-profile/scan', response_model=RepoProfileScanResponse)
async def scan_repo_profile(
    payload: RepoProfileScanRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> RepoProfileScanResponse:
    started_at = datetime.utcnow()
    started_clock = time.perf_counter()
    usage = AIUsageEventService(db)
    try:
        profile = _build_repo_profile(payload.local_path, payload.mapping_name, payload.azure_repo_name)
    except ValueError as exc:
        ended_at = datetime.utcnow()
        duration_ms = int((time.perf_counter() - started_clock) * 1000)
        await usage.create_event(
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            task_id=None,
            operation_type='repo_profile_scan',
            provider='local',
            model='filesystem-profiler-v1',
            status='failed',
            prompt_tokens=0,
            completion_tokens=0,
            total_tokens=0,
            cost_usd=0.0,
            started_at=started_at,
            ended_at=ended_at,
            duration_ms=duration_ms,
            local_repo_path=payload.local_path,
            error_message=str(exc),
            details_json={'mapping_id': payload.mapping_id},
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    pref = await _get_or_create_pref(db, tenant.user_id)
    settings = _parse_json_obj(pref.profile_settings_json)
    repo_profiles = settings.get('repo_profiles')
    if not isinstance(repo_profiles, dict):
        repo_profiles = {}
    repo_profiles[payload.mapping_id] = profile
    settings['repo_profiles'] = repo_profiles
    pref.profile_settings_json = json.dumps(settings, ensure_ascii=False)
    await db.commit()

    ended_at = datetime.utcnow()
    duration_ms = int((time.perf_counter() - started_clock) * 1000)
    completion_tokens = _estimate_tokens(json.dumps(profile, ensure_ascii=False))
    await usage.create_event(
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        task_id=None,
        operation_type='repo_profile_scan',
        provider='local',
        model='filesystem-profiler-v1',
        status='completed',
        prompt_tokens=0,
        completion_tokens=completion_tokens,
        total_tokens=completion_tokens,
        cost_usd=0.0,
        started_at=started_at,
        ended_at=ended_at,
        duration_ms=duration_ms,
        local_repo_path=payload.local_path,
        profile_version=int(profile.get('profile_version') or 1),
        details_json={'mapping_id': payload.mapping_id, 'mapping_name': payload.mapping_name},
    )
    return RepoProfileScanResponse(mapping_id=payload.mapping_id, profile=profile)
