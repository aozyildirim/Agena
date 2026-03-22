import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentTenant, get_current_tenant
from core.database import get_db_session
from core.settings import get_settings
from models.user_preference import UserPreference
from services.ai_usage_event_service import AIUsageEventService
from services.integration_config_service import IntegrationConfigService
from services.llm.cost_tracker import CostTracker
from services.llm.provider import LLMProvider
from services.usage_service import UsageService

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
    preferred_provider: str | None = None


class RepoProfileScanResponse(BaseModel):
    mapping_id: str
    profile: dict[str, Any]


class RepoAgentsDocResponse(BaseModel):
    mapping_id: str
    agents_md_path: str
    content: str


class RepoAgentsDocUpdateRequest(BaseModel):
    content: str


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


def _build_agents_md_from_profile(profile: dict[str, Any]) -> str:
    stack = profile.get('stack') or ['Unknown/Custom']
    tests = profile.get('suggested_test_commands') or []
    lint = profile.get('suggested_lint_commands') or []
    top_dirs = profile.get('top_directories') or []
    top_files = profile.get('top_files') or []
    return '\n'.join([
        '# AGENTS.md (Auto-Generated)',
        '',
        '## Repository Summary',
        f"- Stack: {', '.join(stack)}",
        f"- Package Manager: {profile.get('package_manager') or 'unknown'}",
        '',
        '## Recommended Workflow',
        '- Prefer editing existing modules over adding isolated mock/demo files.',
        '- Keep changes minimal and targeted to the requested task scope.',
        '- Validate via repository-native lint/test commands before finalizing.',
        '',
        '## Suggested Commands',
        *(f'- Test: `{c}`' for c in tests[:3]),
        *(f'- Lint: `{c}`' for c in lint[:3]),
        '',
        '## Structure Hints',
        f"- Top directories: {', '.join(top_dirs[:16]) if top_dirs else '(none)'}",
        f"- Top files: {', '.join(top_files[:16]) if top_files else '(none)'}",
        '',
        '## Output Contract',
        '- Generate real code changes, not markdown-only placeholder output.',
        '- Respect existing project conventions and naming.',
        '- If context is insufficient, add assumptions explicitly in task log output.',
        '',
    ])


def _build_managed_agents_path(
    organization_id: int,
    mapping_id: str,
    scan_id: str,
    local_path: str | None = None,
) -> Path:
    safe_mapping = ''.join(ch if ch.isalnum() or ch in {'-', '_'} else '_' for ch in mapping_id)[:80] or 'mapping'
    if local_path:
        try:
            root = Path(local_path).expanduser().resolve()
            if root.exists() and root.is_dir():
                # Primary storage: keep AGENTS docs inside mapped repo (durable and editable by user).
                out_dir = root / '.tiqr' / 'agents' / safe_mapping
                out_dir.mkdir(parents=True, exist_ok=True)
                return out_dir / f'{scan_id}.md'
        except Exception:
            pass

    # Fallback storage (legacy): app-local managed data directory.
    app_root = Path(__file__).resolve().parents[2]
    out_dir = app_root / 'data' / 'repo_agents' / f'org_{organization_id}' / safe_mapping
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir / f'{scan_id}.md'


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
    agents_md_content = ''
    if llm is not None:
        system_prompt = (
            'You are a principal software architect and technical writer.\n'
            'Analyze repository snapshot and return STRICT JSON object only.\n'
            'Return keys:\n'
            '- stack: string[]\n'
            '- package_manager: string|null\n'
            '- suggested_test_commands: string[]\n'
            '- suggested_lint_commands: string[]\n'
            '- top_directories: string[]\n'
            '- top_files: string[]\n'
            '- repo_rules: string[]\n'
            '- agents_md: string (full markdown)\n\n'
            'agents_md must be detailed and actionable, minimum ~1800 words,\n'
            'with these sections in exact order:\n'
            '1) System Overview\n'
            '2) Services & Responsibilities\n'
            '3) Data Flow\n'
            '4) Deployment Notes\n'
            '5) Key Decisions\n'
            '6) Future Improvements\n\n'
            'Rules:\n'
            '- No placeholders, no "etc", no "..."\n'
            '- Include concrete file/path references wherever possible\n'
            '- If uncertain, write "Assumption:" with rationale\n'
            '- Make AGENTS.md production-grade for engineers'
        )
        user_prompt = (
            f"Mapping Name: {payload.mapping_name}\n"
            f"Azure Repo: {payload.azure_repo_name or ''}\n"
            f"Local Path: {root}\n\n"
            f"{_build_repo_snapshot_text(root)}\n\n"
            "Generate comprehensive AGENTS.md based on repository evidence."
        )
        try:
            output, usage_meta, model, _ = await llm.generate(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                complexity_hint='high',
                max_output_tokens=4500,
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
            raw_agents_md = str(parsed.get('agents_md') or '').strip()
            agents_md_content = raw_agents_md if raw_agents_md else ''
        except Exception:
            # Keep deterministic local profile fallback.
            llm = None

    if not agents_md_content:
        agents_md_content = _build_agents_md_from_profile(profile)

    scan_id = str(uuid4())
    agents_file = _build_managed_agents_path(
        tenant.organization_id,
        payload.mapping_id,
        scan_id,
        local_path=payload.local_path,
    )
    agents_file.write_text(agents_md_content, encoding='utf-8')
    profile['scan_id'] = scan_id
    profile['agents_md_path'] = str(agents_file)
    profile['agents_md_last_content'] = agents_md_content
    profile['scanned_by_provider'] = llm_provider
    profile['scanned_model'] = used_model

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


@router.get('/repo-profile/agents/{mapping_id}', response_model=RepoAgentsDocResponse)
async def get_repo_agents_doc(
    mapping_id: str,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> RepoAgentsDocResponse:
    pref, settings, repo_profiles, profile = await _get_pref_settings_profile(db, tenant.user_id, mapping_id)
    agents_md_path = str(profile.get('agents_md_path') or '').strip()
    p = Path(agents_md_path).expanduser() if agents_md_path else None
    if p is None or not p.exists() or not p.is_file():
        content = str(profile.get('agents_md_last_content') or '').strip()
        if not content:
            content = _build_agents_md_from_profile(profile)
        scan_id = str(profile.get('scan_id') or uuid4())
        rebuilt = _build_managed_agents_path(
            tenant.organization_id,
            mapping_id,
            scan_id,
            local_path=str(profile.get('local_path') or ''),
        )
        rebuilt.write_text(content, encoding='utf-8')
        profile['scan_id'] = scan_id
        profile['agents_md_path'] = str(rebuilt)
        profile['agents_md_last_content'] = content
        repo_profiles[mapping_id] = profile
        settings['repo_profiles'] = repo_profiles
        pref.profile_settings_json = json.dumps(settings, ensure_ascii=False)
        await db.commit()
        p = rebuilt
    content = p.read_text(encoding='utf-8', errors='ignore')
    return RepoAgentsDocResponse(mapping_id=mapping_id, agents_md_path=str(p), content=content)


@router.put('/repo-profile/agents/{mapping_id}', response_model=RepoAgentsDocResponse)
async def save_repo_agents_doc(
    mapping_id: str,
    payload: RepoAgentsDocUpdateRequest,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> RepoAgentsDocResponse:
    pref, settings, repo_profiles, profile = await _get_pref_settings_profile(db, tenant.user_id, mapping_id)
    agents_md_path = str(profile.get('agents_md_path') or '').strip()
    p = Path(agents_md_path).expanduser() if agents_md_path else None
    if p is None or (not p.exists()) or (not p.is_file()):
        scan_id = str(profile.get('scan_id') or uuid4())
        p = _build_managed_agents_path(
            tenant.organization_id,
            mapping_id,
            scan_id,
            local_path=str(profile.get('local_path') or ''),
        )
        profile['scan_id'] = scan_id
        profile['agents_md_path'] = str(p)
    content = payload.content or ''
    p.write_text(content, encoding='utf-8')
    profile['agents_md_last_content'] = content
    repo_profiles[mapping_id] = profile
    settings['repo_profiles'] = repo_profiles
    pref.profile_settings_json = json.dumps(settings, ensure_ascii=False)
    await db.commit()
    return RepoAgentsDocResponse(mapping_id=mapping_id, agents_md_path=str(p), content=content)
