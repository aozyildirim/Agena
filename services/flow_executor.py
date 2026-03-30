"""Flow executor — node tipine göre adımları sırayla çalıştırır."""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.agent_log import AgentLog
from models.flow_run import FlowRun, FlowRunStep
from models.task_record import TaskRecord
from services.azure_pr_service import AzurePRService
from services.github_service import GitHubService
from services.integration_config_service import IntegrationConfigService
from services.llm.provider import LLMProvider
from agents.crewai_agents import AGENT_TOKEN_LIMITS
from services.orchestration_service import OrchestrationService

logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _resolve_agent_model(
    db: AsyncSession,
    user_id: int,
    node_role: str,
    node_model: str,
    default: str = 'gpt-4o',
) -> tuple[str, str]:
    """Node'da model bos ise kullanicinin agent config'inden role'a gore model/provider al."""
    if node_model:
        return node_model, ''
    from models.user_preference import UserPreference
    result = await db.execute(select(UserPreference).where(UserPreference.user_id == user_id))
    pref = result.scalar_one_or_none()
    if pref and pref.agents_json:
        try:
            agents = json.loads(pref.agents_json)
            role_map = {
                'pm': ['pm', 'product_review', 'product_manager'],
                'developer': ['developer', 'dev'],
                'lead_developer': ['lead_developer', 'lead'],
                'qa': ['qa', 'tester'],
            }
            match_roles = role_map.get(node_role.lower(), [node_role.lower()])
            for a in agents:
                a_role = str(a.get('role', '')).strip().lower()
                if a_role in match_roles and a.get('enabled', True):
                    m = str(a.get('custom_model') or a.get('model') or '').strip()
                    p = str(a.get('provider') or '').strip()
                    if m:
                        return m, p
        except Exception:
            pass
    return default, ''


# ── Node executor dispatch ────────────────────────────────────────────────────

async def execute_node(
    node: dict[str, Any],
    context: dict[str, Any],
    db: AsyncSession,
    organization_id: int,
) -> dict[str, Any]:
    """Her node tipini çalıştırır, output döndürür."""
    node_type: str = node.get('type', 'agent')

    if node_type == 'trigger':
        return {'status': 'ok', 'message': 'Triggered', 'task': context.get('task', {})}

    elif node_type == 'agent':
        return await _run_agent_node(node, context, db, organization_id)

    elif node_type == 'http':
        return await _run_http_node(node, context)

    elif node_type == 'github':
        return await _run_github_node(node, context, db, organization_id)

    elif node_type == 'azure_update':
        return await _run_azure_update_node(node, context, db, organization_id)

    elif node_type == 'notify':
        return await _run_notify_node(node, context)

    elif node_type == 'condition':
        return _run_condition_node(node, context)

    else:
        return {'status': 'skipped', 'message': f'Unknown node type: {node_type}'}


def _bool_val(raw: Any, default: bool = False) -> bool:
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)):
        return raw != 0
    if isinstance(raw, str):
        return raw.strip().lower() in {'1', 'true', 'yes', 'on'}
    return default


def _extract_handled_pr_comment_ids(description: str) -> set[str]:
    handled: set[str] = set()
    for line in (description or '').splitlines():
        s = line.strip()
        if not s.startswith('Handled PR Comment IDs:'):
            continue
        raw = s.split(':', 1)[1].strip()
        if not raw:
            continue
        for part in raw.split(','):
            cid = part.strip()
            if cid:
                handled.add(cid)
    return handled


def _extract_pr_comment_baseline(description: str, pr_url: str) -> int:
    target = pr_url.strip()
    prefix = 'Handled PR Baseline:'
    for line in (description or '').splitlines():
        s = line.strip()
        if not s.startswith(prefix):
            continue
        raw = s[len(prefix):].strip()
        if '::' not in raw:
            continue
        left, right = raw.split('::', 1)
        if left.strip() != target:
            continue
        try:
            return int(right.strip())
        except Exception:
            return 0
    return 0


def _upsert_pr_comment_baseline(description: str, pr_url: str, baseline_id: int) -> str:
    target = pr_url.strip()
    prefix = 'Handled PR Baseline:'
    lines = (description or '').splitlines()
    out: list[str] = []
    replaced = False
    for line in lines:
        s = line.strip()
        if s.startswith(prefix):
            raw = s[len(prefix):].strip()
            if '::' in raw and raw.split('::', 1)[0].strip() == target:
                out.append(f'{prefix} {target}::{int(baseline_id)}')
                replaced = True
                continue
        out.append(line)
    if not replaced:
        if out and out[-1].strip():
            out.append('')
        out.append(f'{prefix} {target}::{int(baseline_id)}')
    return '\n'.join(out).strip()


def _has_lead_review_comment_marker(description: str, pr_url: str) -> bool:
    target = pr_url.strip()
    prefix = 'Lead PR Review Comment Posted:'
    for line in (description or '').splitlines():
        s = line.strip()
        if not s.startswith(prefix):
            continue
        raw = s[len(prefix):].strip()
        if raw == target:
            return True
    return False


def _append_lead_review_comment_marker(description: str, pr_url: str) -> str:
    target = pr_url.strip()
    prefix = 'Lead PR Review Comment Posted:'
    lines = (description or '').splitlines()
    for line in lines:
        s = line.strip()
        if s.startswith(prefix) and s[len(prefix):].strip() == target:
            return (description or '').strip()
    out = list(lines)
    if out and out[-1].strip():
        out.append('')
    out.append(f'{prefix} {target}')
    return '\n'.join(out).strip()


def _parse_task_meta_from_description(description: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in (description or '').splitlines():
        if ':' not in raw:
            continue
        key, value = raw.split(':', 1)
        out[key.strip().lower()] = value.strip()
    return out


def _is_fix_request_comment(content: str) -> bool:
    text = (content or '').strip().lower()
    if not text:
        return False
    triggers = (
        '/fix',
        '/agena fix',
        'request changes',
        'needs changes',
        'please fix',
        'lütfen düzelt',
        'lutfen duzelt',
        'duzelt',
        'düzelt',
    )
    return any(token in text for token in triggers)


async def _load_latest_code_diff(db: AsyncSession, task_id: int, organization_id: int) -> str:
    row = await db.execute(
        select(AgentLog.message).where(
            AgentLog.task_id == task_id,
            AgentLog.organization_id == organization_id,
            AgentLog.stage == 'code_diff',
        ).order_by(AgentLog.id.desc()).limit(1)
    )
    msg = row.scalar_one_or_none()
    return str(msg or '').strip()


async def _build_lead_llm_for_task(
    db: AsyncSession,
    organization_id: int,
    task_row: TaskRecord,
    node: dict[str, Any],
) -> LLMProvider | None:
    meta = _parse_task_meta_from_description(str(task_row.description or ''))
    provider = (str(node.get('provider') or '') or meta.get('preferred agent provider') or 'openai').strip().lower()
    if provider not in {'openai', 'gemini'}:
        provider = 'openai'
    model = (str(node.get('model') or '') or meta.get('preferred agent model') or '').strip() or None

    cfg = await IntegrationConfigService(db).get_config(organization_id, provider)
    key = (cfg.secret if cfg else '') or ''
    base_url = (cfg.base_url if cfg else '') or ''

    if (not key or key.startswith('your_')) and provider != 'openai':
        fallback = await IntegrationConfigService(db).get_config(organization_id, 'openai')
        key = (fallback.secret if fallback else '') or ''
        base_url = (fallback.base_url if fallback else '') or ''
        provider = 'openai'

    llm = LLMProvider(
        provider=provider,
        api_key=key or None,
        base_url=base_url or None,
        small_model=model,
        large_model=model,
    )
    return llm


async def _run_product_review_node(
    node: dict[str, Any],
    context: dict[str, Any],
    db: AsyncSession,
    organization_id: int,
) -> dict[str, Any]:
    """Product Review agent: LLM ile task'ı analiz edip structured spec üretir, context'e yazar."""
    task = context.get('task', {})
    role = node.get('role', 'product_review')
    user_id = context.get('user_id', 0)

    # Resolve model from node config or user's agent settings
    resolved_model, resolved_provider = await _resolve_agent_model(
        db, user_id, role, node.get('model', ''), default='gpt-4o',
    )
    model = resolved_model

    # LLM resolve — org'un kayıtlı provider'ını kullan
    provider = (str(node.get('provider') or resolved_provider or '') or 'openai').strip().lower()
    if provider not in {'openai', 'gemini'}:
        provider = 'openai'
    cfg = await IntegrationConfigService(db).get_config(organization_id, provider)
    api_key = (cfg.secret if cfg else '') or ''
    base_url = (cfg.base_url if cfg else '') or ''
    if not api_key or api_key.startswith('your_'):
        fallback = await IntegrationConfigService(db).get_config(organization_id, 'openai')
        api_key = (fallback.secret if fallback else '') or ''
        base_url = (fallback.base_url if fallback else '') or ''
        provider = 'openai'

    llm = LLMProvider(
        provider=provider,
        api_key=api_key or None,
        base_url=base_url or None,
        small_model=model,
        large_model=model,
    )

    system_prompt = (
        'You are a senior product manager and technical lead.\n'
        'Analyze the incoming task and produce a structured implementation brief for a developer agent.\n'
        'Return a JSON object with these keys:\n'
        '- goal: string (one-sentence implementation goal)\n'
        '- requirements: string[] (concrete functional requirements, 3-7 items)\n'
        '- acceptance_criteria: string[] (testable acceptance criteria, 3-5 items)\n'
        '- edge_cases: string[] (important edge cases to handle, 2-4 items)\n'
        '- technical_notes: string[] (architectural hints, affected files/services, 2-5 items)\n'
        '- story_context: string (full narrative context for the developer, 2-4 sentences)\n\n'
        'Rules:\n'
        '- Be concrete and specific — no vague statements\n'
        '- Reference real file paths or service names if inferable from the task\n'
        '- Return only valid JSON, no prose before or after'
    )
    user_prompt = (
        f"Task title: {task.get('title', '')}\n"
        f"Task description: {task.get('description', '')}\n"
        f"Source: {task.get('source', 'internal')}\n"
    )
    if task.get('acceptance_criteria'):
        user_prompt += f"Existing acceptance criteria: {task['acceptance_criteria']}\n"

    # Inject repo source files if available in description
    desc = task.get('description', '')
    if '=== RELEVANT SOURCE FILES ===' in desc:
        start = desc.index('=== RELEVANT SOURCE FILES ===')
        end_marker = '=== END SOURCE FILES ==='
        end = desc.index(end_marker) + len(end_marker) if end_marker in desc else len(desc)
        user_prompt += f'\n{desc[start:end]}\n'
    elif context.get('outputs'):
        # Check if a previous node already produced repo context
        for out in context['outputs'].values():
            raw = str(out.get('output', '') or '')
            if '=== RELEVANT SOURCE FILES ===' in raw:
                si = raw.index('=== RELEVANT SOURCE FILES ===')
                ei_m = '=== END SOURCE FILES ==='
                ei = raw.index(ei_m) + len(ei_m) if ei_m in raw else len(raw)
                user_prompt += f'\n{raw[si:ei]}\n'
                break

    # Also build repo context from local_repo_path if available
    local_repo = ''
    for line in desc.splitlines():
        if line.strip().startswith('Local Repo Path:'):
            local_repo = line.split(':', 1)[1].strip()
            break
    if local_repo and '=== RELEVANT SOURCE FILES ===' not in user_prompt:
        from services.orchestration_service import OrchestrationService
        orch = OrchestrationService(db)
        repo_ctx = await orch._build_repo_context(
            local_repo_path=local_repo,
            organization_id=organization_id,
            user_id=context.get('user_id'),
            task_title=task.get('title', ''),
            task_description=desc,
        )
        if repo_ctx:
            user_prompt += f'\n{repo_ctx}\n'

    try:
        output, usage_meta, used_model, _ = await llm.generate(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            complexity_hint='high',
            max_output_tokens=AGENT_TOKEN_LIMITS['flow_node'],
        )
        parsed: dict[str, Any] = {}
        try:
            raw = output.strip()
            if raw.startswith('```'):
                raw = raw.split('\n', 1)[1].rsplit('```', 1)[0]
            parsed = json.loads(raw)
        except Exception:
            parsed = {}

        # context'e yaz — developer node okuyacak
        context['product_review_output'] = parsed
        context['product_review_raw'] = output

        return {
            'status': 'ok',
            'role': role,
            'model': used_model,
            'output': parsed,
            'usage': usage_meta,
        }
    except Exception as exc:
        logger.warning('Product review LLM call failed: %s', exc)
        context['product_review_output'] = {}
        return {'status': 'error', 'role': role, 'message': str(exc)}


async def _run_agent_node(
    node: dict[str, Any],
    context: dict[str, Any],
    db: AsyncSession,
    organization_id: int,
) -> dict[str, Any]:
    """Agent node çalıştırır. İstenirse gerçek task pipeline tetikler."""
    task = context.get('task', {})
    action = node.get('action', '')
    role = node.get('role', 'developer')
    user_id = context.get('user_id', 0)
    resolved_model, _resolved_provider = await _resolve_agent_model(
        db, user_id, role, node.get('model', ''), default='gpt-4o',
    )
    model = resolved_model
    action_text = str(action or '').lower()
    role_lower = str(role).strip().lower()

    # Product Review node → gerçek LLM spec üretimi
    if role_lower in ('product_review', 'pm', 'product_manager'):
        return await _run_product_review_node(node, context, db, organization_id)

    execute_task_pipeline = _bool_val(node.get('execute_task_pipeline'), False) or (
        role_lower == 'developer' and ('pr' in action_text or not action_text)
    )
    create_pr = _bool_val(node.get('create_pr'), True)

    if execute_task_pipeline:
        task_id = await _resolve_or_create_task_id(
            task=task,
            context=context,
            db=db,
            organization_id=organization_id,
        )
        if task_id is None:
            return {'status': 'error', 'message': 'Task id could not be resolved for pipeline execution'}

        # Product Review çıktısı varsa task record'a yaz
        review: dict[str, Any] = context.get('product_review_output') or {}
        if review:
            task_row = await db.get(TaskRecord, task_id)
            if task_row is not None:
                if review.get('story_context') and not task_row.story_context:
                    task_row.story_context = str(review['story_context'])
                if review.get('acceptance_criteria'):
                    criteria = review['acceptance_criteria']
                    formatted = '\n'.join(f'- {c}' for c in criteria) if isinstance(criteria, list) else str(criteria)
                    task_row.acceptance_criteria = formatted
                if review.get('edge_cases'):
                    edges = review['edge_cases']
                    formatted_edges = '\n'.join(f'- {e}' for e in edges) if isinstance(edges, list) else str(edges)
                    task_row.edge_cases = formatted_edges
                await db.commit()

        service = OrchestrationService(db)
        result = await service.run_task_record(
            organization_id=organization_id,
            task_id=task_id,
            create_pr=create_pr,
        )
        usage = result.usage.model_dump() if hasattr(result.usage, 'model_dump') else {
            'prompt_tokens': int(getattr(result.usage, 'prompt_tokens', 0)),
            'completion_tokens': int(getattr(result.usage, 'completion_tokens', 0)),
            'total_tokens': int(getattr(result.usage, 'total_tokens', 0)),
        }
        return {
            'status': 'ok',
            'mode': 'task_pipeline',
            'role': role,
            'task_id': task_id,
            'pr_url': result.pr_url,
            'usage': usage,
            'message': 'Task pipeline executed from flow agent node',
        }

    if role_lower == 'lead_developer' and (
        'review pr' in action_text
        or _bool_val(node.get('review_pr'), False)
        or _bool_val(node.get('review_only'), False)
    ):
        return await _run_lead_pr_review_node(
            node=node,
            context=context,
            db=db,
            organization_id=organization_id,
        )

    # Diğer roller için LLM çağrısı
    provider = (str(node.get('provider') or '') or 'openai').strip().lower()
    if provider not in {'openai', 'gemini'}:
        provider = 'openai'
    cfg = await IntegrationConfigService(db).get_config(organization_id, provider)
    api_key = (cfg.secret if cfg else '') or ''
    base_url = (cfg.base_url if cfg else '') or ''
    if not api_key or api_key.startswith('your_'):
        fallback = await IntegrationConfigService(db).get_config(organization_id, 'openai')
        api_key = (fallback.secret if fallback else '') or ''
        base_url = (fallback.base_url if fallback else '') or ''
        provider = 'openai'

    llm = LLMProvider(
        provider=provider,
        api_key=api_key or None,
        base_url=base_url or None,
        small_model=model,
        large_model=model,
    )
    system_prompt = f'You are a {role}. Complete the following task clearly and concisely.'
    user_prompt = (
        f"Task: {task.get('title', '')}\n"
        f"Description: {task.get('description', '')}\n"
        f"Action: {action}\n"
    )
    try:
        output, usage_meta, used_model, _ = await llm.generate(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            complexity_hint='normal',
            max_output_tokens=AGENT_TOKEN_LIMITS['agent_node'],
        )
        return {'status': 'ok', 'output': output, 'role': role, 'model': used_model, 'usage': usage_meta}
    except Exception as exc:
        logger.warning('Agent node LLM call failed role=%s: %s', role, exc)
        return {'status': 'error', 'role': role, 'message': str(exc)}


async def _run_http_node(node: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """HTTP isteği atar."""
    url: str = node.get('url', '')
    method: str = node.get('method', 'GET').upper()
    headers: dict[str, str] = node.get('headers', {})
    body_template: str = node.get('body', '')

    if not url:
        return {'status': 'error', 'message': 'URL belirtilmedi'}

    # Context değişkenlerini body'ye inject et
    task = context.get('task', {})
    body_str = body_template
    for k, v in task.items():
        body_str = body_str.replace(f'{{{{{k}}}}}', str(v))

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            req_kwargs: dict[str, Any] = {'headers': headers}
            if method in ('POST', 'PUT', 'PATCH') and body_str:
                try:
                    req_kwargs['json'] = json.loads(body_str)
                except Exception:
                    req_kwargs['content'] = body_str.encode()
            r = await client.request(method, url, **req_kwargs)
            try:
                resp_body = r.json()
            except Exception:
                resp_body = r.text
            return {
                'status': 'ok' if r.is_success else 'error',
                'http_status': r.status_code,
                'response': resp_body,
            }
    except Exception as e:
        return {'status': 'error', 'message': str(e)}


async def _run_github_node(
    node: dict[str, Any], context: dict[str, Any],
    db: AsyncSession, organization_id: int,
) -> dict[str, Any]:
    """GitHub adımı: pipeline'dan oluşan PR bilgisini doğrular/raporlar."""
    action = node.get('github_action', 'create_pr')
    task = context.get('task', {})
    repo = node.get('repo', '')
    outputs = context.get('outputs', {})

    for output in outputs.values():
        if isinstance(output, dict) and output.get('pr_url'):
            return {
                'status': 'ok',
                'action': action,
                'repo': repo,
                'pr_url': output.get('pr_url'),
                'message': f'PR is ready: {output.get("pr_url")}',
            }

    raw_task_id = task.get('id')
    try:
        task_id = int(str(raw_task_id))
    except Exception:
        task_id = None

    if task_id is not None:
        row_result = await db.execute(
            select(TaskRecord).where(
                TaskRecord.id == task_id,
                TaskRecord.organization_id == organization_id,
            )
        )
        row = row_result.scalar_one_or_none()
        if row and row.pr_url:
            return {
                'status': 'ok',
                'action': action,
                'repo': repo,
                'pr_url': row.pr_url,
                'branch_name': row.branch_name,
                'message': f'PR already created: {row.pr_url}',
            }

    return {
        'status': 'ok',
        'action': action,
        'warning': True,
        'message': (
            'PR URL not found. Run a developer node with execute_task_pipeline=true '
            'and create_pr=true before this step.'
        ),
    }


async def _resolve_or_create_task_id(
    *,
    task: dict[str, Any],
    context: dict[str, Any],
    db: AsyncSession,
    organization_id: int,
    create_if_missing: bool = True,
) -> int | None:
    """Flow task payload'ını mevcut TaskRecord ile eşleştirir; yoksa yeni kayıt açar."""
    raw_task_id = task.get('id')
    parsed_task_id: int | None = None
    try:
        parsed_task_id = int(str(raw_task_id))
    except Exception:
        parsed_task_id = None

    if parsed_task_id is not None:
        existing_result = await db.execute(
            select(TaskRecord.id).where(
                TaskRecord.id == parsed_task_id,
                TaskRecord.organization_id == organization_id,
            )
        )
        existing_id = existing_result.scalar_one_or_none()
        if existing_id is not None:
            return int(existing_id)

    source = str(task.get('source') or task.get('external_source') or 'internal').strip().lower()
    if source not in {'azure', 'jira', 'internal'}:
        source = 'internal'

    title = str(task.get('title') or '').strip() or f'Flow Task {raw_task_id or ""}'.strip()
    description = str(task.get('description') or '').strip()
    external_id = str(raw_task_id or '').strip() or f'flow-{int(datetime.now(timezone.utc).timestamp())}'
    user_id = int(context.get('user_id') or 0)
    if external_id:
        same_external_result = await db.execute(
            select(TaskRecord).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.source == source,
                TaskRecord.external_id == external_id,
            ).order_by(TaskRecord.id.asc())
        )
        same_external_rows = list(same_external_result.scalars().all())
        if same_external_rows:
            # Keep one canonical task per external source id.
            canonical = same_external_rows[0]
            for dup in same_external_rows[1:]:
                if dup.status in {'queued', 'running'}:
                    dup.status = 'cancelled'
                    dup.failure_reason = f'Merged into canonical task #{canonical.id}'
            if len(same_external_rows) > 1:
                await db.commit()
            return int(canonical.id)

    if not create_if_missing or user_id <= 0:
        return None

    metadata_lines: list[str] = []
    for key, label in (
        ('external_source', 'External Source'),
        ('project', 'Project'),
        ('azure_repo', 'Azure Repo'),
        ('local_repo_mapping', 'Local Repo Mapping'),
        ('local_repo_path', 'Local Repo Path'),
    ):
        value = task.get(key)
        if value:
            metadata_lines.append(f'{label}: {value}')
    if metadata_lines:
        description = (description + '\n\n---\n' + '\n'.join(metadata_lines)).strip()

    created = TaskRecord(
        organization_id=organization_id,
        created_by_user_id=user_id,
        source=source,
        external_id=external_id,
        title=title,
        description=description,
        status='queued',
    )
    db.add(created)
    await db.commit()
    await db.refresh(created)
    return int(created.id)


async def _run_lead_pr_review_node(
    *,
    node: dict[str, Any],
    context: dict[str, Any],
    db: AsyncSession,
    organization_id: int,
) -> dict[str, Any]:
    task = context.get('task', {})
    task_id = await _resolve_or_create_task_id(
        task=task,
        context=context,
        db=db,
        organization_id=organization_id,
        create_if_missing=False,
    )
    if task_id is None:
        return {'status': 'ok', 'warning': True, 'message': 'Task could not be resolved for PR review node; skipped'}

    task_row = await db.get(TaskRecord, task_id)
    if task_row is None or task_row.organization_id != organization_id:
        return {'status': 'error', 'message': f'Task not found for organization: {task_id}'}

    pr_url = ''
    outputs = context.get('outputs', {})
    for output in outputs.values():
        if isinstance(output, dict) and output.get('pr_url'):
            pr_url = str(output.get('pr_url') or '').strip()
            break
    if not pr_url:
        pr_url = str(task_row.pr_url or '').strip()
    if not pr_url:
        return {'status': 'ok', 'warning': True, 'message': 'PR not found yet; review node skipped'}

    is_azure = 'dev.azure.com' in pr_url or '/_apis/git/repositories/' in pr_url
    is_github = 'github.com' in pr_url or 'api.github.com' in pr_url
    if not is_azure and not is_github:
        return {'status': 'ok', 'warning': True, 'pr_url': pr_url, 'message': 'PR provider not recognized for review loop'}

    try:
        if is_azure:
            comments = await AzurePRService(db).list_pr_comments(organization_id, pr_url=pr_url)
        else:
            comments = await GitHubService().list_pr_comments(pr_url=pr_url)
    except Exception as exc:
        return {'status': 'error', 'message': f'PR comments could not be fetched: {exc}'}

    current_desc = str(task_row.description or '')
    handled_ids = _extract_handled_pr_comment_ids(current_desc)
    baseline_id = _extract_pr_comment_baseline(current_desc, pr_url)
    lead_review_marked = _has_lead_review_comment_marker(current_desc, pr_url)

    async def _post_lead_review_summary_once(msg: str) -> str | None:
        nonlocal current_desc, lead_review_marked
        if lead_review_marked:
            return None
        if is_azure:
            ref = await AzurePRService(db).post_pr_comment(
                organization_id,
                pr_url=pr_url,
                comment=msg,
            )
        else:
            ref = await GitHubService().post_pr_comment(
                pr_url=pr_url,
                comment=msg,
            )
        current_desc = _append_lead_review_comment_marker(current_desc, pr_url)
        task_row.description = current_desc
        await db.commit()
        lead_review_marked = True
        return str(ref) if ref is not None else None

    async def _build_ai_lead_review_comment() -> str:
        code_diff = await _load_latest_code_diff(db, task_id=task_id, organization_id=organization_id)
        meta = _parse_task_meta_from_description(str(task_row.description or ''))
        execution_prompt = meta.get('execution prompt', '')
        repo_playbook = meta.get('repo playbook', '')
        tenant_playbook = meta.get('tenant playbook', '')

        system_prompt = (
            'You are a strict Lead Developer reviewing a pull request. '
            'Use task intent, execution prompt, and code diff to produce actionable review notes. '
            'Keep it concise and technical.'
        )
        user_prompt = (
            f"Task title:\n{task_row.title}\n\n"
            f"Task description:\n{(task_row.description or '')[:5000]}\n\n"
            f"Execution prompt:\n{execution_prompt[:2000]}\n\n"
            f"Repo playbook:\n{repo_playbook[:1500]}\n\n"
            f"Tenant playbook:\n{tenant_playbook[:1500]}\n\n"
            f"PR URL:\n{pr_url}\n\n"
            f"Code diff snapshot:\n{code_diff[:12000] if code_diff else '(no code diff log found)'}\n\n"
            'Return markdown with exactly these sections:\n'
            '1) Findings\n2) Risks\n3) Decision (APPROVE or REQUEST_CHANGES)\n4) Next Actions\n'
            'If there is not enough evidence, say so explicitly in Findings.'
        )
        try:
            llm = await _build_lead_llm_for_task(db, organization_id, task_row, node)
            if llm is None:
                raise RuntimeError('LLM config unavailable')
            review, usage, model, _ = await llm.generate(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                complexity_hint='normal',
                max_output_tokens=AGENT_TOKEN_LIMITS['pr_review'],
            )
            if not (review or '').strip():
                raise RuntimeError('Empty review output')
            return (
                '[AGENA PR Review]\n'
                f'_Lead AI model: {model}_\n\n'
                f'{review.strip()}\n\n'
                f'_Usage: total={int(usage.get("total_tokens", 0))} tokens_'
            )
        except Exception as exc:
            return (
                '[AGENA PR Review]\n'
                'Lead review pass completed but AI review details are unavailable.\n'
                f'Reason: {str(exc)[:220]}'
            )

    candidate_comments = [
        c for c in comments
        if c.get('content')
        and '[AGENA PR Review]' not in c.get('content', '')
        and 'agena' not in c.get('author', '').lower()
    ]
    max_seen_id = 0
    for c in candidate_comments:
        try:
            cid_num = int(str(c.get('id') or '0').strip() or '0')
        except Exception:
            cid_num = 0
        if cid_num > max_seen_id:
            max_seen_id = cid_num

    # First pass after PR creation: establish baseline and do not auto-fix.
    if baseline_id <= 0:
        if max_seen_id > 0:
            task_row.description = _upsert_pr_comment_baseline(current_desc, pr_url, max_seen_id)
            await db.commit()
            current_desc = str(task_row.description or '')
        comment_ref = await _post_lead_review_summary_once(await _build_ai_lead_review_comment())
        return {
            'status': 'ok',
            'pr_url': pr_url,
            'message': 'PR review baseline captured; waiting for new reviewer comments',
            'baseline_comment_id': max_seen_id,
            'comment_ref': comment_ref,
        }

    actionable = []
    for c in candidate_comments:
        cid = str(c.get('id') or '').strip()
        if not cid or cid in handled_ids:
            continue
        try:
            cid_num = int(cid)
        except Exception:
            cid_num = 0
        if cid_num <= baseline_id:
            continue
        actionable.append(c)

    if not actionable:
        if max_seen_id > baseline_id:
            task_row.description = _upsert_pr_comment_baseline(current_desc, pr_url, max_seen_id)
            await db.commit()
            current_desc = str(task_row.description or '')
        comment_ref = await _post_lead_review_summary_once(await _build_ai_lead_review_comment())
        return {
            'status': 'ok',
            'pr_url': pr_url,
            'message': 'No new actionable PR review comments found',
            'comment_ref': comment_ref,
        }

    lines = [f"- {c.get('author', 'Reviewer')}: {c.get('content', '').replace(chr(10), ' ').strip()}" for c in actionable[:8]]
    feedback_blob = '\n'.join(lines).strip()
    feedback_hash = hashlib.sha1(feedback_blob.encode('utf-8')).hexdigest()[:12]
    marker = f'Handled PR Feedback Hash: {feedback_hash}'
    handled_comment_ids = [
        str(c.get('id') or '').strip()
        for c in actionable
        if str(c.get('id') or '').strip()
    ]
    ids_marker = (
        f"Handled PR Comment IDs: {','.join(handled_comment_ids)}"
        if handled_comment_ids else
        ''
    )
    if marker in current_desc:
        return {
            'status': 'ok',
            'pr_url': pr_url,
            'feedback_hash': feedback_hash,
            'message': 'PR comments already handled for this feedback set',
        }

    extra_markers = f'\n{marker}'
    if ids_marker:
        extra_markers += f'\n{ids_marker}'

    next_desc = (
        current_desc.strip()
        + '\n\n---\n'
        + 'Execution Prompt: Address the following PR review comments exactly and update code accordingly.\n'
        + feedback_blob
        + extra_markers
    ).strip()
    if max_seen_id > 0:
        next_desc = _upsert_pr_comment_baseline(next_desc, pr_url, max_seen_id)
    task_row.description = next_desc
    await db.commit()

    auto_fix = _bool_val(node.get('auto_fix_from_comments'), True)
    require_explicit_fix_trigger = _bool_val(node.get('require_explicit_fix_trigger'), False)
    fix_requested = any(_is_fix_request_comment(str(c.get('content') or '')) for c in actionable)

    if not auto_fix:
        if is_azure:
            comment_ref = await AzurePRService(db).post_pr_comment(
                organization_id,
                pr_url=pr_url,
                comment='[AGENA PR Review] Review comments captured. Auto-fix is disabled for this node.',
            )
        else:
            comment_ref = await GitHubService().post_pr_comment(
                pr_url=pr_url,
                comment='[AGENA PR Review] Review comments captured. Auto-fix is disabled for this node.',
            )
        return {
            'status': 'ok',
            'pr_url': pr_url,
            'feedback_hash': feedback_hash,
            'comment_ref': comment_ref,
            'message': 'Review comments captured; auto-fix disabled',
        }

    if require_explicit_fix_trigger and not fix_requested:
        if is_azure:
            comment_ref = await AzurePRService(db).post_pr_comment(
                organization_id,
                pr_url=pr_url,
                comment=(
                    '[AGENA PR Review] New comments captured, but no explicit fix trigger found. '
                    "To run auto-fix, add one of: '/fix', '/agena fix', 'request changes', 'please fix'."
                ),
            )
        else:
            comment_ref = await GitHubService().post_pr_comment(
                pr_url=pr_url,
                comment=(
                    '[AGENA PR Review] New comments captured, but no explicit fix trigger found. '
                    "To run auto-fix, add one of: '/fix', '/agena fix', 'request changes', 'please fix'."
                ),
            )
        return {
            'status': 'ok',
            'pr_url': pr_url,
            'feedback_hash': feedback_hash,
            'comment_ref': comment_ref,
            'message': 'Review comments captured; waiting for explicit fix trigger',
        }

    rerun = await OrchestrationService(db).run_task_record(
        organization_id=organization_id,
        task_id=task_id,
        create_pr=True,
    )
    if is_azure:
        comment_ref = await AzurePRService(db).post_pr_comment(
            organization_id,
            pr_url=pr_url,
            comment=(
                '[AGENA PR Review] Reviewer feedback detected. '
                f'Auto-fix run completed. New PR: {rerun.pr_url or "n/a"}'
            ),
        )
    else:
        comment_ref = await GitHubService().post_pr_comment(
            pr_url=pr_url,
            comment=(
                '[AGENA PR Review] Reviewer feedback detected. '
                f'Auto-fix run completed. New PR: {rerun.pr_url or "n/a"}'
            ),
        )
    return {
        'status': 'ok',
        'mode': 'pr_feedback_loop',
        'task_id': task_id,
        'pr_url': pr_url,
        'new_pr_url': rerun.pr_url,
        'feedback_hash': feedback_hash,
        'comment_ref': comment_ref,
        'message': 'PR feedback processed and developer auto-fix run executed',
    }


async def _run_azure_update_node(
    node: dict[str, Any], context: dict[str, Any],
    db: AsyncSession, organization_id: int,
) -> dict[str, Any]:
    """Azure work item state'ini günceller."""
    import base64
    task = context.get('task', {})
    new_state = node.get('new_state', 'In Progress')
    task_id = task.get('id', '')

    service = IntegrationConfigService(db)
    config = await service.get_config(organization_id, 'azure')
    if not config or not config.secret:
        return {'status': 'error', 'message': 'Azure integration not configured'}

    token = base64.b64encode(f':{config.secret}'.encode()).decode()
    headers = {'Authorization': f'Basic {token}', 'Content-Type': 'application/json-patch+json'}
    url = f"{config.base_url.rstrip('/')}/_apis/wit/workitems/{task_id}?api-version=7.1-preview.3"
    patch = [{'op': 'add', 'path': '/fields/System.State', 'value': new_state}]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.patch(url, headers=headers, json=patch)
            return {'status': 'ok' if r.is_success else 'error', 'http_status': r.status_code, 'new_state': new_state}
    except Exception as e:
        return {'status': 'error', 'message': str(e)}


async def _run_notify_node(node: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """Bildirim gönderir (webhook/slack/email)."""
    channel = node.get('channel', 'webhook')
    webhook_url = node.get('webhook_url', '')
    message_template = node.get('message', 'Flow tamamlandı: {{title}}')

    task = context.get('task', {})
    message = message_template
    for k, v in task.items():
        message = message.replace(f'{{{{{k}}}}}', str(v))

    if channel == 'webhook' and webhook_url:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(webhook_url, json={'text': message, 'task': task})
                return {'status': 'ok', 'http_status': r.status_code, 'message': message}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}

    # Slack, email vb. — TODO
    return {'status': 'ok', 'channel': channel, 'message': message, 'note': 'simulated'}


def _run_condition_node(node: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """Basit condition — field == value kontrolü."""
    field = node.get('condition_field', '')
    operator = node.get('condition_op', 'eq')
    value = node.get('condition_value', '')

    task = context.get('task', {})
    actual = str(task.get(field, context.get(field, '')))

    if operator == 'eq':
        result = actual == str(value)
    elif operator == 'contains':
        result = str(value).lower() in actual.lower()
    elif operator == 'neq':
        result = actual != str(value)
    else:
        result = bool(actual)

    return {'status': 'ok', 'result': result, 'branch': 'true' if result else 'false'}


# ── Main runner ───────────────────────────────────────────────────────────────

async def run_flow(
    flow: dict[str, Any],
    task: dict[str, Any],
    user_id: int,
    organization_id: int,
    db: AsyncSession,
) -> FlowRun:
    """Flow'u çalıştırır, DB'ye kaydeder, FlowRun döndürür."""
    now = datetime.now(timezone.utc)

    # FlowRun oluştur
    flow_run = FlowRun(
        flow_id=flow['id'],
        flow_name=flow['name'],
        task_id=str(task.get('id', '')),
        task_title=task.get('title', ''),
        user_id=user_id,
        status='running',
        started_at=now,
    )
    db.add(flow_run)
    await db.flush()  # id al

    nodes: list[dict[str, Any]] = flow.get('nodes', [])
    edges: list[dict[str, Any]] = flow.get('edges', [])

    # Execution order: topological sort (basit — edge sırasına göre)
    ordered = _topo_sort(nodes, edges)

    context: dict[str, Any] = {'task': task, 'outputs': {}, 'user_id': user_id}
    overall_status = 'completed'

    for node in ordered:
        step = FlowRunStep(
            run_id=flow_run.id,
            node_id=node['id'],
            node_type=node.get('type', 'agent'),
            node_label=node.get('label', ''),
            status='running',
            input_json=json.dumps({'node': node, 'context_keys': list(context.keys())}),
            started_at=datetime.now(timezone.utc),
        )
        db.add(step)
        await db.flush()

        try:
            output = await execute_node(node, context, db, organization_id)
            step.status = 'completed' if output.get('status') != 'error' else 'failed'
            step.output_json = json.dumps(output, ensure_ascii=False, default=str)
            context['outputs'][node['id']] = output

            # Condition node → branch context'e ekle
            if node.get('type') == 'condition':
                context['last_condition'] = output.get('result', False)

            if step.status == 'failed':
                overall_status = 'failed'
                # Hata durumunda dur
                step.finished_at = datetime.now(timezone.utc)
                await db.flush()
                break

        except Exception as e:
            step.status = 'failed'
            step.error_msg = str(e)
            overall_status = 'failed'
            logger.exception('Flow step failed: %s', node.get('id'))

        step.finished_at = datetime.now(timezone.utc)
        await db.flush()

    flow_run.status = overall_status
    flow_run.finished_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(flow_run)
    return flow_run


async def run_pr_feedback_autofix(
    *,
    db: AsyncSession,
    organization_id: int,
    task_id: int,
    pr_url: str,
) -> dict[str, Any]:
    """Webhook/automation entrypoint: only run PR review feedback loop for an existing task."""
    task_row = await db.get(TaskRecord, task_id)
    if task_row is None or task_row.organization_id != organization_id:
        return {'status': 'error', 'message': f'Task not found for organization: {task_id}'}

    node = {
        'type': 'agent',
        'role': 'lead_developer',
        'action': 'Review PR and approve or request changes',
        'review_only': True,
        'auto_fix_from_comments': True,
        'require_explicit_fix_trigger': False,
    }
    context = {
        'task': {
            'id': str(task_row.id),
            'title': task_row.title,
            'description': task_row.description or '',
            'source': task_row.source or 'internal',
        },
        'outputs': {'webhook_pr': {'pr_url': pr_url}},
        'user_id': task_row.created_by_user_id,
    }
    return await _run_lead_pr_review_node(
        node=node,
        context=context,
        db=db,
        organization_id=organization_id,
    )


def _topo_sort(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Basit topological sort — Kahn's algorithm."""
    node_map = {n['id']: n for n in nodes}
    in_degree: dict[str, int] = {n['id']: 0 for n in nodes}
    adj: dict[str, list[str]] = {n['id']: [] for n in nodes}

    for e in edges:
        if e['from'] in adj and e['to'] in in_degree:
            adj[e['from']].append(e['to'])
            in_degree[e['to']] += 1

    queue = [nid for nid, deg in in_degree.items() if deg == 0]
    result: list[dict[str, Any]] = []

    while queue:
        nid = queue.pop(0)
        if nid in node_map:
            result.append(node_map[nid])
        for neighbor in adj.get(nid, []):
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    # Bağlantısız node'ları da ekle
    visited = {n['id'] for n in result}
    for n in nodes:
        if n['id'] not in visited:
            result.append(n)

    return result
