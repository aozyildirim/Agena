"""Flow executor — node tipine göre adımları sırayla çalıştırır."""
from __future__ import annotations

import hashlib
import json
import logging
import re as _re_module
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.agent_log import AgentLog
from agena_models.models.flow_run import FlowRun, FlowRunStep
from agena_models.models.task_record import TaskRecord
from agena_models.schemas.github import GitHubFileChange
from agena_services.services.azure_pr_service import AzurePRService
from agena_services.services.github_service import GitHubService
from agena_services.services.integration_config_service import IntegrationConfigService
from agena_services.services.llm.provider import LLMProvider
from agena_services.services.local_repo_service import LocalRepoService
from agena_agents.agents.crewai_agents import AGENT_TOKEN_LIMITS
from agena_services.services.orchestration_service import OrchestrationService, _is_valid_file_path
from agena_services.services.prompt_service import PromptService

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
    from agena_models.models.user_preference import UserPreference
    result = await db.execute(select(UserPreference).where(UserPreference.user_id == user_id))
    pref = result.scalar_one_or_none()
    if pref and pref.agents_json:
        try:
            agents = json.loads(pref.agents_json)
            role_map = {
                'pm': ['pm', 'product_review', 'product_manager', 'analyzer'],
                'planner': ['planner'],
                'developer': ['developer', 'dev'],
                'lead_developer': ['lead_developer', 'lead'],
                'reviewer': ['reviewer', 'code_reviewer'],
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


# ── Variable substitution helper ─────────────────────────────────────────────


def _substitute_variables(template: str, context: dict[str, Any]) -> str:
    """Replace {{task.FIELD}} and {{outputs.NODE_ID.FIELD}} placeholders in a template string."""
    if not template:
        return template
    result = template
    # Replace {{task.FIELD}} placeholders
    task = context.get('task', {})
    for k, v in task.items():
        result = result.replace(f'{{{{task.{k}}}}}', str(v))
        # Also support bare {{FIELD}} for backward compatibility
        result = result.replace(f'{{{{{k}}}}}', str(v))
    # Replace {{outputs.NODE_ID.FIELD}} placeholders
    for nid, out in context.get('outputs', {}).items():
        if isinstance(out, dict):
            for ok, ov in out.items():
                result = result.replace(f'{{{{outputs.{nid}.{ok}}}}}', str(ov))
    return result


def _extract_generated_code(context: dict[str, Any]) -> str:
    """Search context outputs for generated code from a previous node."""
    # Check direct context key first
    if context.get('generated_code'):
        return str(context['generated_code'])
    # Search through node outputs
    for _nid, out in context.get('outputs', {}).items():
        if not isinstance(out, dict):
            continue
        if out.get('generated_code'):
            return str(out['generated_code'])
        if out.get('output') and '```' in str(out['output']):
            return str(out['output'])
    return ''


def _parse_files_from_generated_code(generated_code: str) -> list[GitHubFileChange]:
    """Parse file blocks from generated code output (same patterns as OrchestrationService)."""
    patterns = [
        # **File: path** + ```code```
        _re_module.compile(r'\*{0,2}File:\s*(.*?)\*{0,2}\s*\r?\n```[^\n]*\r?\n(.*?)```', _re_module.DOTALL),
        # ### File: path + ```code```
        _re_module.compile(r'#+\s*(?:File:?\s*)?`?([^\n`]+)`?\r?\n```[^\n]*\r?\n(.*?)```', _re_module.DOTALL),
        # `path.ext`: + ```code```
        _re_module.compile(r'`([^`\n]+\.[a-zA-Z]{1,10})`\s*:?\r?\n```[^\n]*\r?\n(.*?)```', _re_module.DOTALL),
        # Fallback: file path ending in known extension + next fenced block
        _re_module.compile(
            r'(?:^|\n)\s*\*{0,2}([\w/._-]+\.(?:go|py|ts|tsx|js|jsx|java|rs|rb|cs))\s*\*{0,2}\s*\r?\n```[^\n]*\r?\n(.*?)```',
            _re_module.DOTALL,
        ),
        # File: path + raw block until next File: marker
        _re_module.compile(
            r'(?:^|\n)\s*\*{0,2}File:\s*([^\n*`]+?)\*{0,2}\s*\r?\n(.*?)(?=(?:\n\s*\*{0,2}File:\s*[^\n]+)|\Z)',
            _re_module.DOTALL,
        ),
    ]
    matches: list[tuple[str, str]] = []
    for pat in patterns:
        matches = pat.findall(generated_code)
        if matches:
            break

    files: list[GitHubFileChange] = []
    for path_raw, content in matches:
        clean_path = path_raw.strip().strip('`').strip()
        if not clean_path:
            continue
        normalized = clean_path.replace('\\', '/')
        if normalized.startswith('/'):
            continue
        if _re_module.match(r'^[A-Za-z]:/', normalized):
            continue
        if '/..' in f'/{normalized}' or normalized.startswith('..'):
            continue
        if not _is_valid_file_path(normalized):
            logger.warning('Skipping file with invalid path characters: %r', clean_path)
            continue

        body = content.strip()
        fenced_match = _re_module.match(r'^```[^\n]*\n(.*?)\n```$', body, _re_module.DOTALL)
        if fenced_match:
            body = fenced_match.group(1)
        final_content = body.rstrip() + '\n'
        files.append(GitHubFileChange(path=clean_path, content=final_content))

    return files


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

    elif node_type == 'azure_devops':
        return await _run_azure_devops_node(node, context, db, organization_id)

    elif node_type == 'notify':
        return await _run_notify_node(node, context)

    elif node_type == 'condition':
        return _run_condition_node(node, context)

    elif node_type == 'local_apply':
        return await _run_local_apply_node(node, context, db, organization_id)

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
    raw_provider = (str(node.get('provider') or '') or meta.get('preferred agent provider') or 'openai').strip().lower()
    model = (str(node.get('model') or '') or meta.get('preferred agent model') or '').strip() or None

    # CLI providers can't do direct LLM calls — try available API providers
    provider = raw_provider
    if provider in ('claude_cli', 'codex_cli'):
        provider = 'openai'  # will try openai, then gemini fallback below

    if provider not in {'openai', 'gemini'}:
        provider = 'openai'

    cfg = await IntegrationConfigService(db).get_config(organization_id, provider)
    key = (cfg.secret if cfg else '') or ''
    base_url = (cfg.base_url if cfg else '') or ''

    # Fallback chain: try openai → gemini → any available provider
    if not key or key.startswith('your_'):
        for fallback_provider in ('openai', 'gemini'):
            if fallback_provider == provider:
                continue
            fallback = await IntegrationConfigService(db).get_config(organization_id, fallback_provider)
            if fallback and fallback.secret and not fallback.secret.startswith('your_'):
                key = fallback.secret
                base_url = (fallback.base_url if fallback else '') or ''
                provider = fallback_provider
                break

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

    # Use custom prompt if specified in node, otherwise fall back to system default
    _prompt_slug = (node.get('prompt_slug') or '').strip()
    if _prompt_slug:
        try:
            system_prompt = await PromptService.get(db, _prompt_slug)
        except Exception:
            system_prompt = await PromptService.get(db, 'flow_product_review_system_prompt')
    else:
        system_prompt = await PromptService.get(db, 'flow_product_review_system_prompt')
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
        from agena_services.services.orchestration_service import OrchestrationService
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


async def _run_planner_node(
    node: dict[str, Any],
    context: dict[str, Any],
    db: AsyncSession,
    organization_id: int,
) -> dict[str, Any]:
    """Planner agent: creates implementation plan with file-level changes."""
    task = context.get('task', {})
    user_id = context.get('user_id', 0)
    role = node.get('role', 'planner')

    resolved_model, resolved_provider = await _resolve_agent_model(
        db, user_id, role, node.get('model', ''), default='gpt-4o',
    )
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
        provider=provider, api_key=api_key or None, base_url=base_url or None,
        small_model=resolved_model, large_model=resolved_model,
    )

    # Use node-level prompt_slug or default planner prompt
    prompt_slug = node.get('prompt_slug', '').strip()
    if prompt_slug:
        try:
            system_prompt = await PromptService.get(db, prompt_slug)
        except Exception:
            system_prompt = await PromptService.get(db, 'ai_plan_system_prompt')
    else:
        system_prompt = await PromptService.get(db, 'ai_plan_system_prompt')

    # Build user prompt including analyzer output if available
    user_prompt = (
        f"Task title: {task.get('title', '')}\n"
        f"Task description: {task.get('description', '')}\n"
    )
    if context.get('product_review_output'):
        user_prompt += f"\nAnalyzer output:\n{json.dumps(context['product_review_output'], indent=2)}\n"
    if context.get('product_review_raw'):
        user_prompt += f"\nRaw analysis:\n{context['product_review_raw'][:3000]}\n"

    user_prompt += "\nReturn JSON with: plan (string), files (string[]), changes (object[]).\n"

    max_tokens = int(node.get('max_tokens', 0) or 0) or AGENT_TOKEN_LIMITS['planner']

    try:
        output, usage_meta, used_model, _ = await llm.generate(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            complexity_hint='high',
            max_output_tokens=max_tokens,
        )
        parsed: dict[str, Any] = {}
        try:
            raw = output.strip()
            if raw.startswith('```'):
                raw = raw.split('\n', 1)[1].rsplit('```', 1)[0]
            parsed = json.loads(raw)
        except Exception:
            parsed = {'plan': output, 'files': [], 'changes': []}

        context['plan_output'] = parsed
        return {
            'status': 'ok', 'role': role, 'model': used_model,
            'output': parsed, 'usage': usage_meta,
        }
    except Exception as exc:
        logger.warning('Planner LLM call failed: %s', exc)
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

    # Product Review / Analyzer node → gerçek LLM spec üretimi
    if role_lower in ('product_review', 'pm', 'product_manager', 'analyzer'):
        return await _run_product_review_node(node, context, db, organization_id)

    # Planner node → plan + file list
    if role_lower == 'planner':
        return await _run_planner_node(node, context, db, organization_id)

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

        # Inject previous flow node outputs into task record so the pipeline sees them
        task_row = await db.get(TaskRecord, task_id)
        if task_row is not None:
            # Product Review / Analyzer output → story_context, acceptance_criteria, edge_cases
            review: dict[str, Any] = context.get('product_review_output') or {}
            if review:
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

            # Planner output → append implementation plan to description
            outputs = context.get('outputs', {})
            plan_output = None
            for nid, out in outputs.items():
                if isinstance(out, dict) and out.get('status') == 'ok':
                    # Look for planner node output (has 'plan' or 'result' with file info)
                    result_text = str(out.get('result', ''))
                    if ('file' in result_text.lower() and ('change' in result_text.lower() or 'modif' in result_text.lower())) or 'plan' in result_text.lower():
                        plan_output = result_text
            if plan_output and len(plan_output) > 20:
                desc = task_row.description or ''
                if '=== IMPLEMENTATION PLAN ===' not in desc:
                    task_row.description = desc + f'\n\n=== IMPLEMENTATION PLAN ===\n{plan_output}\n=== END PLAN ==='

            await db.commit()

        service = OrchestrationService(db)
        # Pass agent model/provider from node config or resolved defaults
        _node_provider = node.get('provider', '').strip() or _resolved_provider or None
        _node_model = model or None
        # Determine mode: if provider is a CLI, use mcp_agent mode
        _mode = 'mcp_agent' if _node_provider in ('claude_cli', 'codex_cli') else 'flow'
        result = await service.run_task_record(
            organization_id=organization_id,
            task_id=task_id,
            create_pr=create_pr,
            mode=_mode,
            agent_model=_node_model,
            agent_provider=_node_provider,
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
    # Use node-level prompt_slug if set, otherwise default
    prompt_slug = node.get('prompt_slug', '').strip()
    if prompt_slug:
        try:
            system_prompt = await PromptService.get(db, prompt_slug)
        except Exception:
            system_prompt = (await PromptService.get(db, 'flow_agent_node_system_prompt')).replace('{role}', role)
    else:
        system_prompt = (await PromptService.get(db, 'flow_agent_node_system_prompt')).replace('{role}', role)

    max_tokens = int(node.get('max_tokens', 0) or 0) or AGENT_TOKEN_LIMITS['agent_node']
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
            max_output_tokens=max_tokens,
        )
        return {'status': 'ok', 'output': output, 'role': role, 'model': used_model, 'usage': usage_meta}
    except Exception as exc:
        logger.warning('Agent node LLM call failed role=%s: %s', role, exc)
        return {'status': 'error', 'role': role, 'message': str(exc)}


async def _run_http_node(node: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """HTTP request with auth, timeout, and response variable support."""
    url: str = node.get('url', '')
    method: str = node.get('method', 'GET').upper()
    headers: dict[str, str] = dict(node.get('headers', {}))
    body_template: str = node.get('body', '')
    timeout_sec: int = int(node.get('timeout', 30) or 30)
    auth_type: str = node.get('auth_type', 'none')
    response_var: str = node.get('response_var', '')

    if not url:
        return {'status': 'error', 'message': 'URL not specified'}

    # Apply auth headers
    if auth_type == 'bearer':
        token = node.get('auth_token', '')
        if token:
            headers['Authorization'] = f'Bearer {token}'
    elif auth_type == 'api_key':
        key_name = node.get('auth_key_name', 'X-API-Key')
        key_value = node.get('auth_key_value', '')
        if key_name and key_value:
            headers[key_name] = key_value
    elif auth_type == 'basic':
        import base64
        username = node.get('auth_username', '')
        password = node.get('auth_password', '')
        if username:
            cred = base64.b64encode(f'{username}:{password}'.encode()).decode()
            headers['Authorization'] = f'Basic {cred}'

    # Inject context variables into url and body
    task = context.get('task', {})
    for k, v in task.items():
        url = url.replace(f'{{{{{k}}}}}', str(v))
        body_template = body_template.replace(f'{{{{{k}}}}}', str(v))
    # Also inject outputs
    for nid, out in context.get('outputs', {}).items():
        if isinstance(out, dict):
            for ok, ov in out.items():
                placeholder = f'{{{{outputs.{nid}.{ok}}}}}'
                url = url.replace(placeholder, str(ov))
                body_template = body_template.replace(placeholder, str(ov))

    try:
        async with httpx.AsyncClient(timeout=timeout_sec) as client:
            req_kwargs: dict[str, Any] = {'headers': headers}
            if method in ('POST', 'PUT', 'PATCH') and body_template:
                try:
                    req_kwargs['json'] = json.loads(body_template)
                except Exception:
                    req_kwargs['content'] = body_template.encode()
            r = await client.request(method, url, **req_kwargs)
            try:
                resp_body = r.json()
            except Exception:
                resp_body = r.text

            result = {
                'status': 'ok' if r.is_success else 'error',
                'http_status': r.status_code,
                'response': resp_body,
            }
            # Store response in named variable for downstream nodes
            if response_var:
                result['result'] = resp_body
            return result
    except Exception as e:
        return {'status': 'error', 'message': str(e)}


async def _run_local_apply_node(
    node: dict[str, Any],
    context: dict[str, Any],
    db: AsyncSession,
    organization_id: int,
) -> dict[str, Any]:
    """Apply generated code to a local repository and optionally push."""
    task = context.get('task', {})

    # 1. Extract generated code from previous node outputs
    generated_code = _extract_generated_code(context)
    if not generated_code:
        return {'status': 'error', 'message': 'No generated_code found in previous node outputs'}

    # 2. Resolve repo_path from node config or task description
    repo_path: str = node.get('repo_path', '')
    if not repo_path:
        # Parse "Local Repo Path: /some/path" from task description
        desc = str(task.get('description', ''))
        match = _re_module.search(r'Local Repo Path:\s*(.+)', desc)
        if match:
            repo_path = match.group(1).strip()
    if not repo_path:
        return {'status': 'error', 'message': 'repo_path not specified in node config or task description'}

    # 3. Parse file blocks from generated code
    files = _parse_files_from_generated_code(generated_code)
    if not files:
        return {
            'status': 'ok',
            'files_changed': 0,
            'branch_name': '',
            'has_changes': False,
            'message': 'No file blocks could be parsed from generated code',
        }

    # 4. Apply changes using LocalRepoService
    branch_name = node.get('branch', '') or f'ai/flow-task-{task.get("id", "unknown")}'
    base_branch = node.get('base_branch', 'main')
    commit_message = node.get('commit_message', f'feat: AI-generated changes for task {task.get("title", "")}')
    remote_url = node.get('remote_url', '') or None
    remote_pat = node.get('remote_pat', '') or None

    try:
        local_svc = LocalRepoService()
        has_changes, result_branch = await local_svc.apply_changes_and_push(
            repo_path=repo_path,
            branch_name=branch_name,
            base_branch=base_branch,
            commit_message=commit_message,
            files=files,
            remote_url=remote_url,
            remote_pat=remote_pat,
        )
        logger.info('local_apply node: %d files written to %s (branch=%s, has_changes=%s)',
                     len(files), repo_path, result_branch, has_changes)
        return {
            'status': 'ok',
            'files_changed': len(files),
            'branch_name': result_branch,
            'has_changes': has_changes,
            'repo_path': repo_path,
            'message': f'{len(files)} file(s) applied to {repo_path}',
        }
    except Exception as exc:
        logger.warning('local_apply node failed: %s', exc)
        return {'status': 'error', 'message': str(exc)}


async def _run_github_node(
    node: dict[str, Any], context: dict[str, Any],
    db: AsyncSession, organization_id: int,
) -> dict[str, Any]:
    """GitHub operations: create_branch, create_pr, merge_pr."""
    action = node.get('github_action', 'create_pr')
    task = context.get('task', {})
    outputs = context.get('outputs', {})
    repo_full = node.get('repo', '')  # format: 'owner/repo'

    # ── create_pr ────────────────────────────────────────────────────────────
    if action == 'create_pr':
        # If a previous node already created a PR, pass it through
        for output in outputs.values():
            if isinstance(output, dict) and output.get('pr_url'):
                return {
                    'status': 'ok',
                    'action': action,
                    'repo': repo_full,
                    'pr_url': output.get('pr_url'),
                    'message': f'PR is ready: {output.get("pr_url")}',
                }

        # Check TaskRecord for existing PR
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
                    'repo': repo_full,
                    'pr_url': row.pr_url,
                    'branch_name': row.branch_name,
                    'message': f'PR already created: {row.pr_url}',
                }

        # Try to create a real PR using generated code from previous nodes
        generated_code = _extract_generated_code(context)
        if not generated_code:
            return {
                'status': 'ok',
                'action': action,
                'warning': True,
                'message': (
                    'PR URL not found and no generated_code available. '
                    'Run a developer node with execute_task_pipeline=true '
                    'and create_pr=true before this step, or ensure a code-generating node runs first.'
                ),
            }

        # Parse owner/repo
        if '/' not in repo_full:
            return {'status': 'error', 'message': f'Invalid repo format (expected owner/repo): {repo_full}'}
        owner, repo_name = repo_full.split('/', 1)

        branch_name = node.get('branch', '') or f'ai/task-{task.get("id", "unknown")}'
        target_branch = node.get('target_branch', 'main')
        pr_title = _substitute_variables(
            node.get('pr_title', '') or f'AI: {task.get("title", "")}', context,
        )
        pr_description = _substitute_variables(
            node.get('pr_description', '') or f'Auto-generated PR for task: {task.get("title", "")}', context,
        )
        commit_message = node.get('commit_message', f'feat: AI-generated changes for {task.get("title", "")}')

        files = _parse_files_from_generated_code(generated_code)
        if not files:
            return {
                'status': 'ok',
                'action': action,
                'warning': True,
                'message': 'Generated code found but no file blocks could be parsed.',
            }

        try:
            gh_svc = GitHubService()
            pr_url = await gh_svc.push_files_and_create_pr(
                owner=owner,
                repo=repo_name,
                branch_name=branch_name,
                target_branch=target_branch,
                title=pr_title,
                body=pr_description,
                files=[{'path': f.path, 'content': f.content} for f in files],
                commit_message=commit_message,
                organization_id=organization_id,
            )
            logger.info('GitHub create_pr: %s (files=%d)', pr_url, len(files))
            return {
                'status': 'ok',
                'action': action,
                'repo': repo_full,
                'pr_url': pr_url,
                'branch_name': branch_name,
                'files_count': len(files),
                'message': f'PR created: {pr_url}',
            }
        except Exception as exc:
            logger.warning('GitHub create_pr failed: %s', exc)
            return {'status': 'error', 'action': action, 'message': str(exc)}

    # ── merge_pr ─────────────────────────────────────────────────────────────
    elif action == 'merge_pr':
        # Find pr_url or pr_number from previous outputs or node config
        pr_url = node.get('pr_url', '')
        pr_number: int | None = None
        if not pr_url:
            for out in outputs.values():
                if isinstance(out, dict):
                    if out.get('pr_url'):
                        pr_url = str(out['pr_url'])
                        break
        # Also check TaskRecord
        if not pr_url:
            raw_task_id = task.get('id')
            try:
                tid = int(str(raw_task_id))
            except Exception:
                tid = None
            if tid is not None:
                row_result = await db.execute(
                    select(TaskRecord).where(
                        TaskRecord.id == tid,
                        TaskRecord.organization_id == organization_id,
                    )
                )
                row = row_result.scalar_one_or_none()
                if row and row.pr_url:
                    pr_url = row.pr_url

        if not pr_url:
            return {'status': 'error', 'action': 'merge_pr', 'message': 'No PR URL found to merge'}

        gh_svc = GitHubService()
        ref = gh_svc.parse_pr_ref(pr_url)
        if ref is None:
            return {'status': 'error', 'action': 'merge_pr', 'message': f'Could not parse PR URL: {pr_url}'}
        owner, repo_name, pr_number = ref

        try:
            from agena_core.settings import get_settings
            settings = get_settings()
            token = (settings.github_token or '').strip()
            if not token:
                cfg = await IntegrationConfigService(db).get_config(organization_id, 'github')
                if cfg and cfg.secret:
                    token = cfg.secret
            if not token:
                return {'status': 'error', 'action': 'merge_pr', 'message': 'No GitHub token available'}

            merge_method = node.get('merge_method', 'squash')  # merge, squash, rebase
            headers = {'Authorization': f'token {token}', 'Accept': 'application/vnd.github.v3+json'}
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.put(
                    f'https://api.github.com/repos/{owner}/{repo_name}/pulls/{pr_number}/merge',
                    headers=headers,
                    json={'merge_method': merge_method},
                )
                if r.is_success:
                    logger.info('GitHub merge_pr: %s (#%d)', pr_url, pr_number)
                    return {
                        'status': 'ok',
                        'action': 'merge_pr',
                        'pr_url': pr_url,
                        'pr_number': pr_number,
                        'message': f'PR #{pr_number} merged successfully',
                    }
                else:
                    return {
                        'status': 'error',
                        'action': 'merge_pr',
                        'pr_url': pr_url,
                        'http_status': r.status_code,
                        'message': f'Merge failed: {r.text}',
                    }
        except Exception as exc:
            logger.warning('GitHub merge_pr failed: %s', exc)
            return {'status': 'error', 'action': 'merge_pr', 'message': str(exc)}

    # ── create_branch ────────────────────────────────────────────────────────
    elif action == 'create_branch':
        if '/' not in repo_full:
            return {'status': 'error', 'message': f'Invalid repo format (expected owner/repo): {repo_full}'}
        owner, repo_name = repo_full.split('/', 1)
        branch_name = node.get('branch', '') or f'ai/task-{task.get("id", "unknown")}'
        source_branch = node.get('source_branch', 'main')

        try:
            from agena_core.settings import get_settings
            settings = get_settings()
            token = (settings.github_token or '').strip()
            if not token:
                cfg = await IntegrationConfigService(db).get_config(organization_id, 'github')
                if cfg and cfg.secret:
                    token = cfg.secret
            if not token:
                return {'status': 'error', 'action': 'create_branch', 'message': 'No GitHub token available'}

            base_url = f'https://api.github.com/repos/{owner}/{repo_name}'
            headers = {'Authorization': f'token {token}', 'Accept': 'application/vnd.github.v3+json'}
            async with httpx.AsyncClient(timeout=30) as client:
                # Get source branch SHA
                r = await client.get(f'{base_url}/git/ref/heads/{source_branch}', headers=headers)
                r.raise_for_status()
                base_sha = r.json()['object']['sha']

                # Create branch
                r = await client.post(f'{base_url}/git/refs', headers=headers,
                    json={'ref': f'refs/heads/{branch_name}', 'sha': base_sha})
                if r.status_code == 422:
                    # Branch already exists
                    logger.info('GitHub create_branch: branch %s already exists', branch_name)
                    return {
                        'status': 'ok',
                        'action': 'create_branch',
                        'repo': repo_full,
                        'branch_name': branch_name,
                        'message': f'Branch {branch_name} already exists',
                    }
                r.raise_for_status()
                logger.info('GitHub create_branch: %s on %s', branch_name, repo_full)
                return {
                    'status': 'ok',
                    'action': 'create_branch',
                    'repo': repo_full,
                    'branch_name': branch_name,
                    'sha': base_sha,
                    'message': f'Branch {branch_name} created from {source_branch}',
                }
        except Exception as exc:
            logger.warning('GitHub create_branch failed: %s', exc)
            return {'status': 'error', 'action': 'create_branch', 'message': str(exc)}

    # ── Unknown action fallback ──────────────────────────────────────────────
    else:
        return {'status': 'error', 'message': f'Unknown github_action: {action}'}


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

        system_prompt = await PromptService.get(db, 'flow_pr_review_system_prompt')

        # Language override from node config
        review_lang = (node.get('review_language') or '').strip()
        _LANG_LABELS = {'tr': 'Türkçe', 'en': 'English', 'de': 'Deutsch', 'es': 'Español', 'zh': '中文', 'ja': '日本語', 'it': 'Italiano'}
        _LANG_SECTIONS = {
            'tr': '1) Bulgular\n2) Riskler\n3) Karar (ONAYLA veya DEĞİŞİKLİK İSTE)\n4) Sonraki Adımlar',
            'en': '1) Findings\n2) Risks\n3) Decision (APPROVE or REQUEST_CHANGES)\n4) Next Actions',
            'de': '1) Befunde\n2) Risiken\n3) Entscheidung (GENEHMIGEN oder ÄNDERUNGEN ANFORDERN)\n4) Nächste Schritte',
            'es': '1) Hallazgos\n2) Riesgos\n3) Decisión (APROBAR o SOLICITAR CAMBIOS)\n4) Próximos pasos',
        }
        lang_label = _LANG_LABELS.get(review_lang, '')
        lang_instruction = f'\n\nIMPORTANT: Write your entire review in {lang_label}.' if lang_label else ''
        sections = _LANG_SECTIONS.get(review_lang, '1) Findings\n2) Risks\n3) Decision (APPROVE or REQUEST_CHANGES)\n4) Next Actions')

        user_prompt = (
            f"Task title:\n{task_row.title}\n\n"
            f"Task description:\n{(task_row.description or '')[:5000]}\n\n"
            f"Execution prompt:\n{execution_prompt[:2000]}\n\n"
            f"Repo playbook:\n{repo_playbook[:1500]}\n\n"
            f"Tenant playbook:\n{tenant_playbook[:1500]}\n\n"
            f"PR URL:\n{pr_url}\n\n"
            f"Code diff snapshot:\n{code_diff[:12000] if code_diff else '(no code diff log found)'}\n\n"
            f'Return markdown with exactly these sections:\n{sections}\n'
            f'If there is not enough evidence, say so explicitly in the first section.{lang_instruction}'
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


async def _run_azure_devops_node(
    node: dict[str, Any], context: dict[str, Any], db: AsyncSession, organization_id: int,
) -> dict[str, Any]:
    """Azure DevOps PR operations: create_branch, create_pr, complete_pr, abandon_pr."""
    action = node.get('azure_action', 'create_pr')
    project = node.get('azure_project', '')
    repo_name = node.get('azure_repo', '')
    branch = node.get('azure_branch', '')
    task = context.get('task', {})

    # Variable substitution
    for k, v in task.items():
        project = project.replace(f'{{{{{k}}}}}', str(v))
        repo_name = repo_name.replace(f'{{{{{k}}}}}', str(v))
        branch = branch.replace(f'{{{{{k}}}}}', str(v))

    if not project or not repo_name:
        return {'status': 'error', 'message': 'Azure project and repo are required'}

    try:
        cfg = await IntegrationConfigService(db).get_config(organization_id, 'azure')
        if not cfg or not cfg.secret:
            return {'status': 'error', 'message': 'Azure DevOps integration not configured'}

        pat = cfg.secret
        org_url = cfg.base_url or ''

        pr_service = AzurePRService(org_url=org_url, pat=pat, project=project)

        if action == 'create_branch':
            result = await pr_service.create_branch(repo_name, branch, source_branch='main')
            return {'status': 'ok', 'action': 'create_branch', 'branch': branch, **result}

        elif action == 'create_pr':
            pr_title = node.get('azure_pr_title', f'AI: {task.get("title", "")}')
            pr_desc = node.get('azure_pr_description', '')
            reviewers_str = node.get('azure_reviewers', '')
            for k, v in task.items():
                pr_title = pr_title.replace(f'{{{{{k}}}}}', str(v))
                pr_desc = pr_desc.replace(f'{{{{{k}}}}}', str(v))
            reviewers = [r.strip() for r in reviewers_str.split(',') if r.strip()] if reviewers_str else []
            result = await pr_service.create_pull_request(
                repo_name=repo_name,
                source_branch=branch or f'ai/task-{task.get("id", "")}',
                target_branch='main',
                title=pr_title,
                description=pr_desc,
                reviewers=reviewers,
            )
            return {'status': 'ok', 'action': 'create_pr', 'pr_id': result.get('pullRequestId'), **result}

        elif action == 'complete_pr':
            pr_id = context.get('outputs', {}).get(node.get('id', ''), {}).get('pr_id', '')
            if not pr_id:
                # Try to find from previous node outputs
                for out in context.get('outputs', {}).values():
                    if isinstance(out, dict) and out.get('pr_id'):
                        pr_id = out['pr_id']
                        break
            if not pr_id:
                return {'status': 'error', 'message': 'No PR ID found to complete'}
            result = await pr_service.complete_pull_request(repo_name=repo_name, pr_id=int(pr_id))
            return {'status': 'ok', 'action': 'complete_pr', **result}

        elif action == 'abandon_pr':
            pr_id = context.get('outputs', {}).get(node.get('id', ''), {}).get('pr_id', '')
            for out in context.get('outputs', {}).values():
                if isinstance(out, dict) and out.get('pr_id'):
                    pr_id = out['pr_id']
                    break
            if not pr_id:
                return {'status': 'error', 'message': 'No PR ID found to abandon'}
            result = await pr_service.abandon_pull_request(repo_name=repo_name, pr_id=int(pr_id))
            return {'status': 'ok', 'action': 'abandon_pr', **result}

        return {'status': 'error', 'message': f'Unknown azure action: {action}'}
    except Exception as e:
        return {'status': 'error', 'message': str(e)}


async def _run_notify_node(node: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """Send notifications via webhook, Slack, Teams, or email."""
    channel = node.get('channel', 'webhook')
    webhook_url = node.get('webhook_url', '')
    message_template = node.get('message', 'Flow completed: {{title}}')
    task = context.get('task', {})

    # Apply full variable substitution (task fields + output variables)
    message = _substitute_variables(message_template, context)

    if channel == 'webhook' and webhook_url:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(webhook_url, json={'text': message, 'task': task})
                return {'status': 'ok', 'channel': 'webhook', 'http_status': r.status_code, 'message': message}
        except Exception as e:
            return {'status': 'error', 'channel': 'webhook', 'message': str(e)}

    elif channel == 'slack' and webhook_url:
        # Slack incoming webhook with Block Kit formatting
        payload = {
            'blocks': [
                {
                    'type': 'section',
                    'text': {
                        'type': 'mrkdwn',
                        'text': message,
                    },
                },
            ],
            'text': message,  # Fallback for notifications
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(webhook_url, json=payload)
                return {'status': 'ok', 'channel': 'slack', 'http_status': r.status_code, 'message': message}
        except Exception as e:
            return {'status': 'error', 'channel': 'slack', 'message': str(e)}

    elif channel == 'teams' and webhook_url:
        # Microsoft Teams incoming webhook (MessageCard format)
        payload = {
            '@type': 'MessageCard',
            '@context': 'http://schema.org/extensions',
            'summary': 'Flow Notification',
            'themeColor': '0076D7',
            'title': f'Flow Notification — {task.get("title", "")}',
            'text': message,
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(webhook_url, json=payload)
                return {'status': 'ok', 'channel': 'teams', 'http_status': r.status_code, 'message': message}
        except Exception as e:
            return {'status': 'error', 'channel': 'teams', 'message': str(e)}

    elif channel == 'email':
        # Email — not yet implemented, return informative stub
        return {
            'status': 'ok',
            'channel': 'email',
            'message': message,
            'note': 'Email channel not yet configured. Use webhook, slack, or teams.',
        }

    return {'status': 'ok', 'channel': channel, 'message': message, 'note': 'Channel not recognized or webhook_url missing'}


def _run_condition_node(node: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """Condition node with branching support and extended operators."""
    field = node.get('condition_field') or node.get('field') or ''
    operator = node.get('condition_op') or node.get('operator') or 'eq'
    value = node.get('condition_value') or node.get('value') or ''

    task = context.get('task', {})
    # Resolve field from task, outputs, or context
    actual_raw = task.get(field, context.get(field, ''))
    # Also check outputs (e.g., "outputs.node_id.result")
    if field.startswith('outputs.'):
        parts = field.split('.', 2)
        if len(parts) >= 3:
            actual_raw = context.get('outputs', {}).get(parts[1], {}).get(parts[2], '')
        elif len(parts) == 2:
            actual_raw = context.get('outputs', {}).get(parts[1], '')
    actual = str(actual_raw)

    if operator == 'eq':
        result = actual == str(value)
    elif operator == 'neq':
        result = actual != str(value)
    elif operator == 'contains':
        result = str(value).lower() in actual.lower()
    elif operator == 'gt':
        try: result = float(actual) > float(value)
        except ValueError: result = actual > str(value)
    elif operator == 'lt':
        try: result = float(actual) < float(value)
        except ValueError: result = actual < str(value)
    elif operator == 'gte':
        try: result = float(actual) >= float(value)
        except ValueError: result = actual >= str(value)
    elif operator == 'lte':
        try: result = float(actual) <= float(value)
        except ValueError: result = actual <= str(value)
    elif operator == 'regex':
        import re as _re
        try: result = bool(_re.search(str(value), actual))
        except _re.error: result = False
    elif operator == 'empty':
        result = not actual.strip()
    elif operator == 'not_empty':
        result = bool(actual.strip())
    else:
        result = bool(actual)

    return {
        'status': 'ok',
        'result': result,
        'branch': 'true' if result else 'false',
        'true_target': node.get('true_target', ''),
        'false_target': node.get('false_target', ''),
    }


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

    skip_nodes: set[str] = set()  # Nodes to skip due to condition branching
    node_map = {n['id']: n for n in ordered}

    # ── Boss Mode integration: set task to running + write agent logs ──
    task_id: int | None = task.get('id')
    task_record: TaskRecord | None = None
    if task_id:
        task_record = await db.get(TaskRecord, task_id)
        if task_record:
            task_record.status = 'running'
            await db.flush()

    # Role → boss-mode log message mapping (triggers correct animations)
    _ROLE_START_MSG: dict[str, str] = {
        'analyzer': 'Step 1: Fetching context & analyzing task requirements',
        'pm': 'PM analyzing task scope and acceptance criteria',
        'product_review': 'PM analyzing task scope and acceptance criteria',
        'planner': 'AI plan: creating implementation plan with file changes',
        'developer': 'Step 3: Developer generating code implementation',
        'lead_developer': 'Step 4: Finalize — reviewing and preparing output',
        'reviewer': 'Code review in progress',
        'qa': 'QA review: checking implementation quality',
    }
    _ROLE_DONE_MSG: dict[str, str] = {
        'analyzer': 'PM result: analysis complete',
        'pm': 'PM result: analysis complete',
        'product_review': 'PM result: analysis complete',
        'planner': 'AI plan result: implementation plan ready',
        'developer': 'Developer result: code generation complete',
        'lead_developer': 'Finalize result: output prepared',
        'reviewer': 'Review result: review complete',
        'qa': 'Review result: QA check complete',
    }

    async def _flow_log(stage: str, message: str) -> None:
        """Write an AgentLog entry so /agents/live picks it up for boss mode."""
        if not task_id:
            return
        db.add(AgentLog(
            task_id=task_id,
            organization_id=organization_id,
            stage=stage,
            message=message,
        ))
        await db.flush()

    await _flow_log('running', f'Flow started: {flow["name"]}')

    for node in ordered:
        node_id = node['id']
        node_type = node.get('type', 'agent')
        node_role = node.get('role', '').strip().lower()

        # Skip nodes excluded by condition branching
        if node_id in skip_nodes:
            step = FlowRunStep(
                run_id=flow_run.id, node_id=node_id,
                node_type=node_type, node_label=node.get('label', ''),
                status='skipped', input_json='{}',
                started_at=datetime.now(timezone.utc), finished_at=datetime.now(timezone.utc),
            )
            db.add(step)
            await db.flush()
            continue

        step = FlowRunStep(
            run_id=flow_run.id,
            node_id=node_id,
            node_type=node_type,
            node_label=node.get('label', ''),
            status='running',
            input_json=json.dumps({'node': node, 'context_keys': list(context.keys())}),
            started_at=datetime.now(timezone.utc),
        )
        db.add(step)
        await db.flush()

        # Boss mode: log step start with role-appropriate message
        if node_type == 'agent':
            start_msg = _ROLE_START_MSG.get(node_role, f'{node.get("label", node_role)} started')
            await _flow_log('agent', start_msg)

        try:
            output = await execute_node(node, context, db, organization_id)
            step.status = 'completed' if output.get('status') != 'error' else 'failed'
            step.output_json = json.dumps(output, ensure_ascii=False, default=str)
            context['outputs'][node_id] = output

            # Boss mode: log step completion with output details
            if node_type == 'agent':
                done_msg = _ROLE_DONE_MSG.get(node_role, f'{node.get("label", node_role)} finished')
                await _flow_log('agent', done_msg)

                # Log meaningful output details per role
                if isinstance(output, dict) and output.get('status') == 'ok':
                    result_text = str(output.get('result', ''))
                    if node_role in ('analyzer', 'pm', 'product_review'):
                        # Log spec summary
                        spec = output.get('spec') or output.get('result')
                        if isinstance(spec, dict):
                            reqs = spec.get('requirements', [])
                            criteria = spec.get('acceptance_criteria', [])
                            if reqs:
                                await _flow_log('agent', f'Analyzer requirements: {", ".join(str(r) for r in reqs[:5])}')
                            if criteria:
                                await _flow_log('agent', f'Acceptance criteria: {", ".join(str(c) for c in criteria[:5])}')
                        elif result_text:
                            await _flow_log('agent', f'Analyzer output: {result_text[:300]}')
                    elif node_role == 'planner':
                        # Log planned files
                        if result_text:
                            import re as _re
                            # Extract file paths from plan
                            file_refs = _re.findall(r'[\w/._-]+\.(?:go|py|ts|tsx|js|jsx|java|rs|rb|cs|html|css|sql)', result_text)
                            unique_files = list(dict.fromkeys(file_refs))[:15]
                            if unique_files:
                                await _flow_log('agent', f'Planned files ({len(unique_files)}): {", ".join(unique_files)}')
                            await _flow_log('agent', f'Plan detail: {result_text[:400]}')
                    elif node_role in ('developer', 'dev'):
                        pr_url = output.get('pr_url', '')
                        if pr_url:
                            await _flow_log('agent', f'PR created: {pr_url}')

            # Condition node → apply branching
            if node_type == 'condition':
                context['last_condition'] = output.get('result', False)
                branch = output.get('branch', 'true')
                true_target = output.get('true_target', '')
                false_target = output.get('false_target', '')
                # Skip the path that wasn't taken
                if branch == 'true' and false_target:
                    skip_nodes.add(false_target)
                elif branch == 'false' and true_target:
                    skip_nodes.add(true_target)

            if step.status == 'failed':
                overall_status = 'failed'
                step.finished_at = datetime.now(timezone.utc)
                await db.flush()
                break

        except Exception as e:
            step.status = 'failed'
            step.error_msg = str(e)
            overall_status = 'failed'
            logger.exception('Flow step failed: %s', node_id)
            await _flow_log('agent', f'{node.get("label", node_role)} failed: {str(e)[:200]}')

        step.finished_at = datetime.now(timezone.utc)
        await db.flush()

    # Boss mode: mark flow complete
    await _flow_log('agent', 'Flow complete')
    if task_record:
        task_record.status = 'completed' if overall_status == 'completed' else 'failed'

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
