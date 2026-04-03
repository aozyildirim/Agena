import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_core.settings import get_settings
from agena_agents.agents.prompts import PROMPT_DEFAULTS, normalize_prompt_overrides
from agena_models.models.prompt_override import PromptOverride
from agena_models.models.user_preference import UserPreference
from agena_services.services.ai_usage_event_service import AIUsageEventService
from agena_services.services.integration_config_service import IntegrationConfigService
from agena_services.services.llm.cost_tracker import CostTracker
from agena_agents.agents.crewai_agents import AGENT_TOKEN_LIMITS
from agena_services.services.llm.provider import LLMProvider
from agena_services.services.notification_service import NotificationService
from agena_services.services.org_service import OrgService
from agena_services.services.usage_service import UsageService
from agena_services.services.prompt_service import PromptService

router = APIRouter(prefix='/preferences', tags=['preferences'])


class PreferencePayload(BaseModel):
    azure_project: str | None = None
    azure_team: str | None = None
    azure_sprint_path: str | None = None
    my_team: list[dict[str, Any]] | None = None
    my_team_source: str | None = None
    agents: list[dict[str, Any]] | None = None
    flows: list[dict[str, Any]] | None = None
    repo_mappings: list[dict[str, Any]] | None = None
    profile_settings: dict[str, Any] | None = None


class PreferenceResponse(BaseModel):
    azure_project: str | None
    azure_team: str | None
    azure_sprint_path: str | None
    my_team: list[dict[str, Any]]
    my_team_source: str
    my_team_by_source: dict[str, list[dict[str, Any]]]
    agents: list[dict[str, Any]]
    flows: list[dict[str, Any]]
    repo_mappings: list[dict[str, Any]]
    profile_settings: dict[str, Any]


class RepoProfileScanRequest(BaseModel):
    mapping_id: str
    mapping_name: str
    local_path: str
    azure_repo_name: str | None = None
    preferred_provider: str | None = None
    analyze_prompt: str | None = None


class RepoProfileScanResponse(BaseModel):
    mapping_id: str
    profile: dict[str, Any]


class PromptOverridesPayload(BaseModel):
    overrides: dict[str, str] = {}


class PromptOverridesResponse(BaseModel):
    defaults: dict[str, str]
    overrides: dict[str, str]
    effective: dict[str, str]



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


def _read_file_safe(path: Path, max_chars: int = 5000) -> str:
    try:
        if not path.exists() or not path.is_file():
            return ''
        return path.read_text(encoding='utf-8', errors='ignore')[:max_chars]
    except Exception:
        return ''


def _build_repo_snapshot_text(root: Path) -> str:
    top_dirs: list[str] = []
    top_files: list[str] = []
    for entry in sorted(root.iterdir(), key=lambda e: e.name.lower()):
        if entry.name.startswith('.'):
            continue
        if entry.is_dir():
            top_dirs.append(entry.name)
        elif entry.is_file():
            top_files.append(entry.name)
        if len(top_dirs) + len(top_files) >= 40:
            break

    samples: list[tuple[str, str]] = []
    for rel in ['README.md', 'package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts']:
        p = root / rel
        txt = _read_file_safe(p, max_chars=3500)
        if txt.strip():
            samples.append((rel, txt))

    lines: list[str] = [
        f'Repo root: {root}',
        'Top directories: ' + (', '.join(top_dirs[:20]) if top_dirs else '(none)'),
        'Top files: ' + (', '.join(top_files[:20]) if top_files else '(none)'),
    ]
    for rel, txt in samples[:6]:
        lines.append(f'\n=== FILE: {rel} ===\n{txt}')
    return '\n'.join(lines)


async def _resolve_repo_profile_llm(
    db: AsyncSession,
    organization_id: int,
    preferred_provider: str | None,
) -> tuple[LLMProvider | None, str]:
    settings = get_settings()
    cfg = IntegrationConfigService(db)

    pref = (preferred_provider or '').strip().lower()
    if pref not in {'openai', 'gemini'}:
        pref = ''

    order = [pref] if pref else []
    for p in ['openai', 'gemini']:
        if p not in order:
            order.append(p)

    for provider in order:
        icfg = await cfg.get_config(organization_id, provider)
        key = ((icfg.secret if icfg else '') or '').strip()
        base_url = ((icfg.base_url if icfg else '') or '').strip()
        if provider == 'openai' and (not key or key.startswith('your_')):
            key = (settings.openai_api_key or '').strip()
            base_url = base_url or (settings.openai_base_url or '').strip()
        if not key or key.startswith('your_'):
            continue
        llm = LLMProvider(
            provider=provider,
            api_key=key,
            base_url=base_url,
            small_model='gpt-4o-mini' if provider == 'openai' else 'gemini-2.5-flash',
            large_model='gpt-4.1' if provider == 'openai' else 'gemini-2.5-pro',
        )
        return llm, provider
    return None, 'local'


def _extract_json_object(text: str) -> dict[str, Any] | None:
    src = (text or '').strip()
    if not src:
        return None
    try:
        data = json.loads(src)
        return data if isinstance(data, dict) else None
    except Exception:
        pass
    start = src.find('{')
    end = src.rfind('}')
    if start >= 0 and end > start:
        try:
            data = json.loads(src[start:end + 1])
            return data if isinstance(data, dict) else None
        except Exception:
            return None
    return None



async def _get_or_create_pref(db: AsyncSession, user_id: int) -> UserPreference:
    result = await db.execute(select(UserPreference).where(UserPreference.user_id == user_id))
    pref = result.scalar_one_or_none()
    if pref is None:
        pref = UserPreference(user_id=user_id)
        db.add(pref)
        await db.flush()
    return pref


async def _get_profile_by_mapping_id(db: AsyncSession, user_id: int, mapping_id: str) -> dict[str, Any]:
    pref = await _get_or_create_pref(db, user_id)
    settings = _parse_json_obj(pref.profile_settings_json)
    repo_profiles = settings.get('repo_profiles')
    if not isinstance(repo_profiles, dict):
        raise HTTPException(status_code=404, detail='Repo profile not found')
    profile = repo_profiles.get(mapping_id)
    if not isinstance(profile, dict):
        raise HTTPException(status_code=404, detail='Repo profile not found')
    return profile


async def _get_pref_settings_profile(
    db: AsyncSession,
    user_id: int,
    mapping_id: str,
) -> tuple[UserPreference, dict[str, Any], dict[str, Any], dict[str, Any]]:
    pref = await _get_or_create_pref(db, user_id)
    settings = _parse_json_obj(pref.profile_settings_json)
    repo_profiles = settings.get('repo_profiles')
    if not isinstance(repo_profiles, dict):
        raise HTTPException(status_code=404, detail='Repo profile not found')
    profile = repo_profiles.get(mapping_id)
    if not isinstance(profile, dict):
        raise HTTPException(status_code=404, detail='Repo profile not found')
    return pref, settings, repo_profiles, profile


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
            my_team=[], my_team_source='azure', my_team_by_source={'azure': [], 'jira': []},
            agents=[], flows=[], repo_mappings=[], profile_settings={},
        )
    profile_settings = _parse_json_obj(pref.profile_settings_json)
    repo_mappings = _parse_json(pref.repo_mappings_json)

    legacy_team = _parse_json(pref.my_team_json)
    my_team_source = str(profile_settings.get('my_team_source') or 'azure').strip().lower()
    if my_team_source not in {'azure', 'jira'}:
        my_team_source = 'azure'
    raw_by_source = profile_settings.get('my_team_by_source')
    my_team_by_source: dict[str, list[dict[str, Any]]] = {'azure': [], 'jira': []}
    if isinstance(raw_by_source, dict):
        for src in ('azure', 'jira'):
            value = raw_by_source.get(src)
            if isinstance(value, list):
                my_team_by_source[src] = value
    if legacy_team and not my_team_by_source.get('azure'):
        my_team_by_source['azure'] = legacy_team
    selected_my_team = my_team_by_source.get(my_team_source) or []

    return PreferenceResponse(
        azure_project=pref.azure_project,
        azure_team=pref.azure_team,
        azure_sprint_path=pref.azure_sprint_path,
        my_team=selected_my_team,
        my_team_source=my_team_source,
        my_team_by_source=my_team_by_source,
        agents=_parse_json(pref.agents_json),
        flows=_parse_json(pref.flows_json),
        repo_mappings=repo_mappings,
        profile_settings=profile_settings,
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
    current_settings = _parse_json_obj(pref.profile_settings_json)
    next_source = str(payload.my_team_source or current_settings.get('my_team_source') or 'azure').strip().lower()
    if next_source not in {'azure', 'jira'}:
        next_source = 'azure'
    raw_by_source = current_settings.get('my_team_by_source')
    by_source: dict[str, list[dict[str, Any]]] = {'azure': [], 'jira': []}
    if isinstance(raw_by_source, dict):
        for src in ('azure', 'jira'):
            value = raw_by_source.get(src)
            if isinstance(value, list):
                by_source[src] = value
    legacy_team = _parse_json(pref.my_team_json)
    if legacy_team and not by_source.get('azure'):
        by_source['azure'] = legacy_team

    if payload.my_team is not None:
        by_source[next_source] = payload.my_team
        if next_source == 'azure':
            pref.my_team_json = json.dumps(payload.my_team, ensure_ascii=False)
        elif by_source.get('azure'):
            pref.my_team_json = json.dumps(by_source['azure'], ensure_ascii=False)
        else:
            pref.my_team_json = json.dumps([], ensure_ascii=False)
    if payload.agents is not None:
        pref.agents_json = json.dumps(payload.agents, ensure_ascii=False)
    if payload.flows is not None:
        pref.flows_json = json.dumps(payload.flows, ensure_ascii=False)
    if payload.repo_mappings is not None:
        pref.repo_mappings_json = json.dumps(payload.repo_mappings, ensure_ascii=False)
    if payload.profile_settings is not None:
        merged_settings = {**current_settings, **payload.profile_settings}
        current_settings = merged_settings

    current_settings['my_team_source'] = next_source
    current_settings['my_team_by_source'] = by_source
    pref.profile_settings_json = json.dumps(current_settings, ensure_ascii=False)

    # Auto-sync team members to organization membership
    sync_summary: dict[str, int] | None = None
    if payload.my_team is not None and payload.my_team:
        org_svc = OrgService(db)
        sync_summary = await org_svc.auto_add_team_members(
            tenant.organization_id, payload.my_team,
        )

    await db.commit()
    await db.refresh(pref)

    # Notify org owner + send invite emails for newly invited members
    if sync_summary and sync_summary.get('invited', 0) > 0:
        notif_svc = NotificationService(db)
        invited_count = sync_summary['invited']
        await notif_svc.notify_event(
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            event_type='team_sync',
            title='Team members invited',
            message=f'{invited_count} new team member{"s" if invited_count != 1 else ""} invited to your organization.',
            severity='info',
            payload={'sync_summary': sync_summary},
        )
        # Send invite emails
        for email_addr in sync_summary.get('invited_emails', []):
            try:
                notif_svc._send_email(
                    email_addr,
                    'You are invited to AGENA',
                    f'You have been invited to join an organization on AGENA.\n\nVisit http://localhost:3010/invite to accept.',
                )
            except Exception:
                pass  # email sending is best-effort

    final_settings = _parse_json_obj(pref.profile_settings_json)
    final_source = str(final_settings.get('my_team_source') or 'azure').strip().lower()
    if final_source not in {'azure', 'jira'}:
        final_source = 'azure'
    final_by_source: dict[str, list[dict[str, Any]]] = {'azure': [], 'jira': []}
    raw_final_by_source = final_settings.get('my_team_by_source')
    if isinstance(raw_final_by_source, dict):
        for src in ('azure', 'jira'):
            value = raw_final_by_source.get(src)
            if isinstance(value, list):
                final_by_source[src] = value
    legacy_team_after = _parse_json(pref.my_team_json)
    if legacy_team_after and not final_by_source.get('azure'):
        final_by_source['azure'] = legacy_team_after

    return PreferenceResponse(
        azure_project=pref.azure_project,
        azure_team=pref.azure_team,
        azure_sprint_path=pref.azure_sprint_path,
        my_team=final_by_source.get(final_source) or [],
        my_team_source=final_source,
        my_team_by_source=final_by_source,
        agents=_parse_json(pref.agents_json),
        flows=_parse_json(pref.flows_json),
        repo_mappings=_parse_json(pref.repo_mappings_json),
        profile_settings=final_settings,
    )


@router.get('/prompts', response_model=PromptOverridesResponse)
async def get_prompt_overrides(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> PromptOverridesResponse:
    result = await db.execute(
        select(PromptOverride).where(PromptOverride.user_id == tenant.user_id)
    )
    rows = result.scalars().all()
    overrides = normalize_prompt_overrides({
        row.prompt_key: row.prompt_text
        for row in rows
    })
    if not overrides:
        pref = await _get_or_create_pref(db, tenant.user_id)
        settings = _parse_json_obj(pref.profile_settings_json)
        legacy = normalize_prompt_overrides(settings.get('prompt_overrides'))
        if legacy:
            for prompt_key, prompt_text in legacy.items():
                db.add(
                    PromptOverride(
                        user_id=tenant.user_id,
                        prompt_key=prompt_key,
                        prompt_text=prompt_text,
                    )
                )
            await db.commit()
            overrides = legacy
    effective = {key: (overrides.get(key) or default) for key, default in PROMPT_DEFAULTS.items()}
    return PromptOverridesResponse(
        defaults=PROMPT_DEFAULTS,
        overrides=overrides,
        effective=effective,
    )


@router.put('/prompts', response_model=PromptOverridesResponse)
async def save_prompt_overrides(
    payload: PromptOverridesPayload,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> PromptOverridesResponse:
    overrides = normalize_prompt_overrides(payload.overrides)
    await db.execute(
        delete(PromptOverride).where(PromptOverride.user_id == tenant.user_id)
    )
    for prompt_key, prompt_text in overrides.items():
        db.add(
            PromptOverride(
                user_id=tenant.user_id,
                prompt_key=prompt_key,
                prompt_text=prompt_text,
            )
        )
    # Cleanup legacy location after writing canonical table.
    pref = await _get_or_create_pref(db, tenant.user_id)
    settings = _parse_json_obj(pref.profile_settings_json)
    if 'prompt_overrides' in settings:
        del settings['prompt_overrides']
        pref.profile_settings_json = json.dumps(settings, ensure_ascii=False)
    await db.commit()
    effective = {key: (overrides.get(key) or default) for key, default in PROMPT_DEFAULTS.items()}
    return PromptOverridesResponse(
        defaults=PROMPT_DEFAULTS,
        overrides=overrides,
        effective=effective,
    )


@router.post('/repo-profile/scan', response_model=RepoProfileScanResponse)
async def scan_repo_profile(
    payload: RepoProfileScanRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> RepoProfileScanResponse:
    root = Path(payload.local_path).expanduser().resolve()
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

    llm, llm_provider = await _resolve_repo_profile_llm(db, tenant.organization_id, payload.preferred_provider)
    prompt_tokens = 0
    completion_tokens = 0
    total_tokens = 0
    cost_usd = 0.0
    used_model: str | None = None
    # Use repo's own agents.md / AGENTS.md if it exists (skip generating our own)
    _repo_root = Path(payload.local_path).expanduser().resolve() if payload.local_path else None
    _repo_agents_md: Path | None = None
    if _repo_root and _repo_root.is_dir():
        for _aname in ['agents.md', 'AGENTS.md']:
            _candidate = _repo_root / _aname
            if _candidate.is_file() and _candidate.stat().st_size > 100:
                _repo_agents_md = _candidate
                break
    if _repo_agents_md:
        profile['agents_md_path'] = str(_repo_agents_md)
        profile['agents_md_size'] = _repo_agents_md.stat().st_size
        llm = None  # skip LLM call — repo has its own agents.md

    if llm is not None:
        system_prompt = await PromptService.get(db, 'repo_analysis_system_prompt')
        user_prompt = (
            f"Mapping Name: {payload.mapping_name}\n"
            f"Azure Repo: {payload.azure_repo_name or ''}\n"
            f"Local Path: {root}\n\n"
            f"{_build_repo_snapshot_text(root)}\n\n"
            "Analyze the repository and return JSON."
        )
        try:
            output, usage_meta, model, _ = await llm.generate(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                complexity_hint='high',
                max_output_tokens=AGENT_TOKEN_LIMITS['agent_test'],
            )
            used_model = model
            prompt_tokens = int(usage_meta.get('prompt_tokens', 0))
            completion_tokens = int(usage_meta.get('completion_tokens', 0))
            total_tokens = int(usage_meta.get('total_tokens', 0))
            cost_usd = CostTracker().estimate_cost_usd(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                model=model or 'gpt-4o-mini',
            )
            parsed = _extract_json_object(output) or {}
            if isinstance(parsed.get('stack'), list) and parsed.get('stack'):
                profile['stack'] = [str(x) for x in parsed.get('stack', [])[:6]]
            if 'package_manager' in parsed:
                profile['package_manager'] = parsed.get('package_manager')
            if isinstance(parsed.get('suggested_test_commands'), list):
                profile['suggested_test_commands'] = [str(x) for x in parsed.get('suggested_test_commands', [])[:4]]
            if isinstance(parsed.get('suggested_lint_commands'), list):
                profile['suggested_lint_commands'] = [str(x) for x in parsed.get('suggested_lint_commands', [])[:4]]
            if isinstance(parsed.get('repo_rules'), list):
                profile['repo_rules'] = [str(x) for x in parsed.get('repo_rules', [])[:12]]
        except Exception:
            llm = None

    profile['scan_id'] = str(uuid4())
    profile['scanned_by_provider'] = llm_provider
    profile['scanned_model'] = used_model

    # Auto-generate agents.md only if repo doesn't have its own
    if not _repo_agents_md:
        try:
            from agena_services.services.repo_scanner import scan_repo, generate_agents_md, generate_package_mds
            scan_data = scan_repo(payload.local_path)
            agents_md_content = generate_agents_md(scan_data, payload.mapping_name)
            _ab = Path('/app/data/agents_md') if Path('/app').exists() else Path('data/agents_md')
            _od = _ab / f'org_{tenant.organization_id}'
            _od.mkdir(parents=True, exist_ok=True)
            _sn = (payload.mapping_name or payload.mapping_id).replace('/', '_').replace('\\', '_').replace(' ', '_')
            agents_md_path = _od / f'{_sn}.md'
            agents_md_path.write_text(agents_md_content, encoding='utf-8')
            pkg_dir = _od / _sn
            pkg_dir.mkdir(parents=True, exist_ok=True)
            pkg_mds = generate_package_mds(scan_data)
            for pkg_name, pkg_content in pkg_mds.items():
                safe_name = pkg_name.replace('/', '__')
                (pkg_dir / f'{safe_name}.md').write_text(pkg_content, encoding='utf-8')
            profile['agents_md_path'] = str(agents_md_path)
            profile['agents_pkg_dir'] = str(pkg_dir)
            profile['agents_md_size'] = len(agents_md_content)
            profile['agents_md_signatures'] = len(scan_data.get('signatures', []))
            profile['agents_md_files'] = len(scan_data.get('source_files', []))
        except Exception as agents_exc:
            profile['agents_md_error'] = str(agents_exc)[:200]

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
    if total_tokens <= 0:
        completion_tokens = _estimate_tokens(json.dumps(profile, ensure_ascii=False))
        prompt_tokens = 0
        total_tokens = completion_tokens
        cost_usd = 0.0
        used_model = used_model or 'filesystem-profiler-v1'
        llm_provider = 'local'
    else:
        usage_counter = UsageService(db)
        await usage_counter.increment_tokens(tenant.organization_id, total_tokens)
    await usage.create_event(
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        task_id=None,
        operation_type='repo_profile_scan',
        provider=llm_provider,
        model=used_model,
        status='completed',
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        cost_usd=cost_usd,
        started_at=started_at,
        ended_at=ended_at,
        duration_ms=duration_ms,
        local_repo_path=payload.local_path,
        profile_version=int(profile.get('profile_version') or 1),
        details_json={'mapping_id': payload.mapping_id, 'mapping_name': payload.mapping_name},
    )
    return RepoProfileScanResponse(mapping_id=payload.mapping_id, profile=profile)


class GenerateAgentsMdRequest(BaseModel):
    mapping_id: str
    local_path: str
    mapping_name: str


class AgentsMdResponse(BaseModel):
    mapping_id: str
    path: str
    size: int
    signatures: int
    files: int


@router.post('/repo-profile/agents-md', response_model=AgentsMdResponse)
async def generate_agents_md_endpoint(
    payload: GenerateAgentsMdRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> AgentsMdResponse:
    """Generate agents.md for a repo mapping."""
    from agena_services.services.repo_scanner import scan_repo, generate_agents_md, generate_package_mds
    scan_data = scan_repo(payload.local_path)
    content = generate_agents_md(scan_data, payload.mapping_name)
    _ab2 = Path('/app/data/agents_md') if Path('/app').exists() else Path('data/agents_md')
    _od2 = _ab2 / f'org_{tenant.organization_id}'
    _od2.mkdir(parents=True, exist_ok=True)
    _sn2 = (payload.mapping_name or payload.mapping_id).replace('/', '_').replace('\\', '_').replace(' ', '_')
    agents_path = _od2 / f'{_sn2}.md'
    agents_path.write_text(content, encoding='utf-8')
    # Save per-package signature files
    pkg_dir2 = _od2 / _sn2
    pkg_dir2.mkdir(parents=True, exist_ok=True)
    for pkg_name, pkg_content in generate_package_mds(scan_data).items():
        safe = pkg_name.replace('/', '__')
        (pkg_dir2 / f'{safe}.md').write_text(pkg_content, encoding='utf-8')

    # Update profile
    pref = await _get_or_create_pref(db, tenant.user_id)
    settings = _parse_json_obj(pref.profile_settings_json)
    repo_profiles = settings.get('repo_profiles', {})
    if isinstance(repo_profiles, dict) and payload.mapping_id in repo_profiles:
        repo_profiles[payload.mapping_id]['agents_md_path'] = str(agents_path)
        repo_profiles[payload.mapping_id]['agents_md_size'] = len(content)
        repo_profiles[payload.mapping_id]['agents_md_signatures'] = len(scan_data.get('signatures', []))
        repo_profiles[payload.mapping_id]['agents_md_files'] = len(scan_data.get('source_files', []))
        settings['repo_profiles'] = repo_profiles
        pref.profile_settings_json = json.dumps(settings, ensure_ascii=False)
        await db.commit()

    return AgentsMdResponse(
        mapping_id=payload.mapping_id,
        path=str(agents_path),
        size=len(content),
        signatures=len(scan_data.get('signatures', [])),
        files=len(scan_data.get('source_files', [])),
    )


@router.get('/repo-profile/agents-md/{mapping_id}')
async def get_agents_md(
    mapping_id: str,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Get agents.md content for a repo mapping."""
    pref = await _get_or_create_pref(db, tenant.user_id)
    settings = _parse_json_obj(pref.profile_settings_json)
    repo_profiles = settings.get('repo_profiles', {})
    profile = repo_profiles.get(mapping_id, {}) if isinstance(repo_profiles, dict) else {}
    md_path = profile.get('agents_md_path', '')
    if not md_path:
        raise HTTPException(status_code=404, detail='agents.md not found for this mapping')
    p = Path(md_path)
    if not p.is_file():
        raise HTTPException(status_code=404, detail='agents.md file not found on disk')
    content = p.read_text(errors='replace')
    # Append package signature files if they exist
    pkg_dir = profile.get('agents_pkg_dir', '')
    if pkg_dir and Path(pkg_dir).is_dir():
        content += '\n\n---\n\n## Package Signatures\n'
        for pkg_file in sorted(Path(pkg_dir).glob('*.md')):
            try:
                content += '\n' + pkg_file.read_text(errors='replace')
            except Exception:
                pass
    return {'mapping_id': mapping_id, 'path': md_path, 'content': content, 'size': len(content)}
