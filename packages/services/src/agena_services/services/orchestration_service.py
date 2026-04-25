from __future__ import annotations

import base64
import difflib
import html
import json
import logging
import re
import unicodedata

logger = logging.getLogger(__name__)

# Invalid characters for file paths parsed from LLM output.
_INVALID_PATH_CHARS_RE = re.compile(r'[\[\]*?<>|"#{};\x00]')


def _is_valid_file_path(path: str) -> bool:
    """Reject paths with glob wildcards, shell metacharacters, or illegal chars."""
    return not _INVALID_PATH_CHARS_RE.search(path)


import shutil
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from tenacity import retry, stop_after_attempt, wait_exponential

from agena_agents.agents.orchestrator import AgentOrchestrator
from agena_core.settings import get_settings
from agena_models.models.run_record import RunRecord
from agena_models.models.task_record import TaskRecord
from agena_models.schemas.agent import AgentRunResult, UsageStats
from agena_models.schemas.github import CreatePRRequest, GitHubFileChange
from agena_services.services.azure_pr_service import AzurePRService
from agena_services.services.ai_usage_event_service import AIUsageEventService
from agena_services.services.claude_cli_service import ClaudeCLIService
from agena_services.services.codex_cli_service import CodexCLIService
from agena_services.services.github_service import GitHubService
from agena_services.services.integration_config_service import IntegrationConfigService
from agena_services.services.llm.cost_tracker import CostTracker
from agena_services.services.local_repo_service import LocalRepoService
from agena_services.services.notification_service import NotificationService
from agena_services.services.event_bus import publish_fire_and_forget
from agena_services.services.task_service import TaskService
from agena_services.services.usage_service import UsageService


@dataclass
class TaskRouting:
    effective_source: str
    external_source: str | None
    azure_project: str | None
    azure_repo_url: str | None
    local_repo_mapping: str | None
    local_repo_path: str | None
    repo_playbook: str | None
    preferred_agent: str | None
    preferred_agent_provider: str | None
    preferred_agent_model: str | None
    execution_prompt: str | None
    remote_repo: str | None = None  # "github:owner/repo" or "azure:project/repo"


@dataclass
class LLMRuntimeConfig:
    provider: str
    api_key: str
    base_url: str
    model: str | None = None


class OrchestrationService:
    def __init__(self, db_session: AsyncSession) -> None:
        self.settings = get_settings()
        self.db_session = db_session
        self.github_service = GitHubService()
        self.azure_pr_service = AzurePRService(db_session)
        self.codex_cli_service = CodexCLIService()
        self.claude_cli_service = ClaudeCLIService()
        self.local_repo_service = LocalRepoService()
        self.cost_tracker = CostTracker()

    async def run_task_record(self, organization_id: int, task_id: int, create_pr: bool = True, mode: str = 'flow', agent_model: str | None = None, agent_provider: str | None = None, assignment_id: int | None = None) -> AgentRunResult:
        task = await self.db_session.get(TaskRecord, task_id)
        if task is None or task.organization_id != organization_id:
            raise ValueError('Task not found for organization')

        task_service = TaskService(self.db_session)
        notification_service = NotificationService(self.db_session)
        usage_service = UsageService(self.db_session)
        usage_event_service = AIUsageEventService(self.db_session)
        run_started_at = datetime.utcnow()
        run_started_clock = time.perf_counter()

        task.status = 'running'
        await self.db_session.commit()

        publish_fire_and_forget(organization_id, 'task_status', {
            'task_id': task_id, 'status': 'running', 'title': task.title,
        })

        repo_mapping = await self._resolve_repo_mapping(task, assignment_id=assignment_id)
        routing = self._extract_task_routing(task, repo_mapping)

        # Construct azure_repo_url from integration config when repo mapping is Azure
        # but no explicit Azure Repo URL exists in task metadata
        if (routing.effective_source == 'azure'
                and not routing.azure_repo_url
                and repo_mapping
                and repo_mapping.provider == 'azure'):
            try:
                az_cfg = await IntegrationConfigService(self.db_session).get_config(organization_id, 'azure')
                if az_cfg and az_cfg.base_url:
                    routing.azure_repo_url = f'{az_cfg.base_url.rstrip("/")}/{repo_mapping.owner}/_git/{repo_mapping.repo_name}'
                    routing.azure_project = repo_mapping.owner
                    logger.info('Constructed azure_repo_url=%s project=%s', routing.azure_repo_url, routing.azure_project)
                else:
                    logger.warning('Azure config missing base_url for org %s', organization_id)
            except Exception as exc:
                logger.warning('Failed to construct azure_repo_url: %s', exc)

        # Override model/provider if explicitly passed from assignment
        if agent_model:
            routing.preferred_agent_model = agent_model
        if agent_provider:
            routing.preferred_agent_provider = agent_provider

        run_info_parts = [f'Agent pipeline started at {run_started_at.isoformat()}Z']
        if routing.preferred_agent_model:
            run_info_parts.append(f'model={routing.preferred_agent_model}')
        if routing.preferred_agent_provider:
            run_info_parts.append(f'provider={routing.preferred_agent_provider}')
        if routing.local_repo_path:
            run_info_parts.append(f'repo={routing.local_repo_path}')
        run_info_parts.append(f'source={routing.effective_source}')
        run_info_parts.append(f'create_pr={create_pr}')
        await task_service.add_log(
            task.id,
            organization_id,
            'running',
            ' | '.join(run_info_parts),
        )
        await notification_service.notify_event(
            organization_id=organization_id,
            user_id=task.created_by_user_id,
            event_type='task_running',
            title=f'Task #{task.id} started',
            message=task.title,
            severity='info',
            task_id=task.id,
        )
        tenant_playbook = await self._load_tenant_playbook(organization_id)
        if routing.repo_playbook:
            await task_service.add_log(task.id, organization_id, 'playbook', 'Repo playbook applied to prompt context')
        if tenant_playbook:
            await task_service.add_log(task.id, organization_id, 'playbook', 'Tenant playbook applied to prompt context')
        # For Sentry/NewRelic tasks: use targeted prompt with file content (skips full repo scan)
        targeted_prompt = await self._build_targeted_error_prompt(
            task, organization_id, routing.local_repo_path,
        )
        if targeted_prompt:
            await task_service.add_log(task.id, organization_id, 'agent',
                f'Using targeted {task.source} prompt (file content injected, skipping full repo scan)')
            effective_description = targeted_prompt
        else:
            effective_description = self._build_effective_description(
                task.description,
                routing.execution_prompt,
                routing.repo_playbook,
                tenant_playbook,
                await self._build_repo_context(
                    local_repo_path=routing.local_repo_path,
                    organization_id=organization_id,
                    user_id=task.created_by_user_id,
                    task_title=task.title or '',
                    task_description=task.description or '',
                    remote_repo=routing.remote_repo,
                ),
                task.story_context,
                task.acceptance_criteria,
                task.edge_cases,
            )

        # Append attachment metadata + inline text content so every
        # downstream consumer (Claude/Codex CLI, MCP agent, classic
        # LangGraph pipeline, flow nodes) sees what the user uploaded.
        try:
            attachments_section = await self._build_attachments_section(
                task.id, organization_id, description=task.description,
            )
            if attachments_section:
                effective_description = f'{effective_description}\n\n{attachments_section}'
                await task_service.add_log(
                    task.id, organization_id, 'agent',
                    'Attachments injected into prompt (paths + inline text content)'
                )
        except Exception as _att_exc:
            logger.info('Attachment injection skipped for task %s: %s', task.id, _att_exc)
        payload = {
            'id': str(task.id),
            'title': task.title,
            'description': effective_description,
            'source': routing.effective_source,
            'organization_id': organization_id,
            'created_by_user_id': task.created_by_user_id,
            'external_work_item_id': getattr(task, 'external_work_item_id', None),
        }

        # Pull any relevant skills from the team's catalog and prepend them
        # to the effective description. Works for every execution mode
        # (Claude CLI, Codex CLI, MCP Agent, classic LLM pipeline) since
        # they all consume `effective_description`.
        try:
            from agena_services.services.skill_service import SkillService
            _skill_svc = SkillService(self.db_session)
            _skill_hits = await _skill_svc.find_relevant(
                organization_id,
                title=task.title,
                description=(effective_description or '')[:3000],
                touched_files=None,
                limit=3,
            )
            if _skill_hits:
                _skill_block = SkillService.format_for_prompt(_skill_hits, is_turkish=True)
                _skills_summary = ', '.join(f'#{h.id} {h.name[:60]}({h.tier})' for h in _skill_hits)
                await task_service.add_log(task.id, organization_id, 'agent',
                    f'Retrieved {len(_skill_hits)} relevant skill(s) from catalog: {_skills_summary}'
                )
                logger.info(
                    'Retrieved %d relevant skill(s) for task %s: %s',
                    len(_skill_hits), task.id, _skills_summary,
                )
                effective_description = (
                    '--- RELEVANT TEAM SKILLS (from prior completed tasks) ---\n'
                    f'{_skill_block}\n'
                    '--- END SKILLS ---\n\n'
                    f'{effective_description or ""}'
                )
        except Exception as _se:
            logger.info('Skill retrieval skipped for task %s: %s', task.id, _se)

        state: dict[str, Any] = {}
        try:
            if routing.preferred_agent_provider == 'codex_cli' and routing.local_repo_path:
                await task_service.add_log(
                    task.id,
                    organization_id,
                    'agent',
                    f"Codex CLI started (model={routing.preferred_agent_model or 'default'})",
                )
                try:
                    # Codex CLI uses ChatGPT login session (~/.codex/auth.json).
                    # Do NOT pass API key — it breaks the responses WebSocket auth flow.
                    async def _codex_log(msg: str) -> None:
                        await task_service.add_log(task.id, organization_id, 'agent', msg)

                    final_code = await self.codex_cli_service.generate_file_markdown(
                        repo_path=routing.local_repo_path,
                        task_title=task.title,
                        task_description=effective_description,
                        model=routing.preferred_agent_model,
                        api_key=None,
                        api_base_url=None,
                        log_callback=_codex_log,
                        task_id=str(task.id),
                    )
                    parsed_blocks = self._parse_reviewed_output_to_files(final_code, local_repo_path=routing.local_repo_path)
                    if not parsed_blocks:
                        git_changes = await self._collect_git_changes(routing.local_repo_path)
                        if not git_changes:
                            await task_service.add_log(
                                task.id,
                                organization_id,
                                'agent',
                                'Codex CLI output missing file blocks and git diff is empty; retrying with strict format prompt.',
                            )
                            final_code = await self.codex_cli_service.generate_file_markdown(
                                repo_path=routing.local_repo_path,
                                task_title=task.title,
                                task_description=self._with_strict_file_block_format(effective_description),
                                model=routing.preferred_agent_model,
                                api_key=None,
                                api_base_url=None,
                                log_callback=_codex_log,
                                task_id=str(task.id),
                            )
                except Exception as codex_exc:
                    await task_service.add_log(
                        task.id,
                        organization_id,
                        'agent',
                        f'Codex CLI failed before code generation: {str(codex_exc)[:280]}',
                    )
                    raise
                prompt_estimate = self._estimate_tokens(
                    '\n'.join(
                        [
                            f'Task title: {task.title}',
                            f'Task description: {task.description or ""}',
                            f'External Source: {routing.external_source or ""}',
                            f'Local Repo Path: {routing.local_repo_path or ""}',
                        ]
                    )
                )
                completion_estimate = self._estimate_tokens(final_code)
                state = {
                    'spec': {'goal': 'codex_cli execution', 'requirements': [], 'acceptance_criteria': []},
                    'generated_code': final_code,
                    'reviewed_code': final_code,
                    'final_code': final_code,
                    'usage': {
                        'prompt_tokens': prompt_estimate,
                        'completion_tokens': completion_estimate,
                        'total_tokens': prompt_estimate + completion_estimate,
                    },
                    'model_usage': [f"codex-cli:{routing.preferred_agent_model or 'default'}"],
                }
                await task_service.add_log(task.id, organization_id, 'agent', 'Using codex_cli preferred agent')
            elif routing.preferred_agent_provider == 'claude_cli' and routing.local_repo_path:
                await task_service.add_log(task.id, organization_id, 'agent', f"Claude CLI started (model={routing.preferred_agent_model or 'default'}, repo={routing.local_repo_path})")

                async def _cli_log(msg: str) -> None:
                    await task_service.add_log(task.id, organization_id, 'agent', msg)

                try:
                    final_code = await self.claude_cli_service.generate_file_markdown(
                        repo_path=routing.local_repo_path,
                        task_title=task.title,
                        task_description=effective_description,
                        model=routing.preferred_agent_model,
                        log_callback=_cli_log,
                        task_id=str(task.id),
                    )
                    parsed_blocks = self._parse_reviewed_output_to_files(final_code, local_repo_path=routing.local_repo_path)
                    if not parsed_blocks:
                        git_changes = await self._collect_git_changes(routing.local_repo_path)
                        if not git_changes:
                            await task_service.add_log(
                                task.id,
                                organization_id,
                                'agent',
                                'Claude CLI output missing file blocks and git diff is empty; retrying with strict format prompt.',
                            )
                            final_code = await self.claude_cli_service.generate_file_markdown(
                                repo_path=routing.local_repo_path,
                                task_title=task.title,
                                task_description=self._with_strict_file_block_format(effective_description),
                                model=routing.preferred_agent_model,
                                log_callback=_cli_log,
                                task_id=str(task.id),
                            )
                except Exception as claude_exc:
                    await task_service.add_log(
                        task.id,
                        organization_id,
                        'agent',
                        f'Claude CLI failed: {str(claude_exc)[:280]}',
                    )
                    raise
                prompt_estimate = self._estimate_tokens(f'{task.title}\n{task.description or ""}')
                completion_estimate = self._estimate_tokens(final_code)
                state = {
                    'spec': {'goal': 'claude_cli execution'},
                    'generated_code': final_code,
                    'reviewed_code': final_code,
                    'final_code': final_code,
                    'usage': {
                        'prompt_tokens': prompt_estimate,
                        'completion_tokens': completion_estimate,
                        'total_tokens': prompt_estimate + completion_estimate,
                    },
                    'model_usage': [f"claude-cli:{routing.preferred_agent_model or 'default'}"],
                }
                await task_service.add_log(task.id, organization_id, 'agent', 'Using claude_cli preferred agent')
            elif mode == 'mcp_agent':
                _is_local = bool(routing.local_repo_path)
                _is_remote = bool(routing.remote_repo) and not _is_local
                if not _is_local and not _is_remote:
                    raise ValueError('MCP Agent mode requires a repository (local path or remote repo mapping).')

                _repo_label = routing.local_repo_path or routing.remote_repo or 'unknown'
                await task_service.add_log(
                    task.id, organization_id, 'agent',
                    f"MCP Agent started (model={routing.preferred_agent_model or 'default'}, "
                    f"repo={_repo_label}, remote={_is_remote})",
                )
                # Force LLM provider for MCP — codex_cli/claude_cli are not LLM APIs
                _mcp_routing = routing
                if routing.preferred_agent_provider in ('codex_cli', 'claude_cli'):
                    _mcp_routing = TaskRouting(
                        effective_source=routing.effective_source,
                        external_source=routing.external_source,
                        azure_project=routing.azure_project,
                        azure_repo_url=routing.azure_repo_url,
                        local_repo_mapping=routing.local_repo_mapping,
                        local_repo_path=routing.local_repo_path,
                        repo_playbook=routing.repo_playbook,
                        preferred_agent=routing.preferred_agent,
                        preferred_agent_provider='openai',
                        preferred_agent_model=routing.preferred_agent_model,
                        execution_prompt=routing.execution_prompt,
                        remote_repo=routing.remote_repo,
                    )
                llm_runtime = await self._resolve_llm_runtime(organization_id, _mcp_routing)
                from agena_agents.agents.mcp_engine import MCPAgentEngine

                # For MCP agent, skip codex-specific models that don't support tool calling
                _mcp_model = routing.preferred_agent_model or (llm_runtime.model if llm_runtime else None)
                _codex_models = {'gpt-5.1-codex-mini', 'gpt-5.1-mini', 'codex-mini'}
                if _mcp_model and _mcp_model.lower() in _codex_models:
                    _mcp_model = self.settings.llm_large_model or 'gpt-4o'

                engine = MCPAgentEngine(
                    provider=llm_runtime.provider if llm_runtime else 'openai',
                    api_key=llm_runtime.api_key if llm_runtime else (self.settings.openai_api_key or ''),
                    base_url=llm_runtime.base_url if llm_runtime else (self.settings.openai_base_url or ''),
                    model=_mcp_model,
                )

                # Load agents.md for initial orientation
                _mcp_agents_md: str | None = None
                if _is_local:
                    _mcp_repo_root = Path(routing.local_repo_path).expanduser().resolve()
                    _mcp_agents_path = _mcp_repo_root / 'agents.md'
                    if _mcp_agents_path.is_file():
                        try:
                            _mcp_agents_md = _mcp_agents_path.read_text(errors='replace')[:50_000]
                        except Exception:
                            pass
                elif _is_remote:
                    _mcp_agents_md = await self._fetch_remote_agents_md(routing.remote_repo, organization_id)

                # Optional: load custom system prompt from Prompt Studio
                _mcp_custom_prompt: str | None = None
                try:
                    from agena_services.services.prompt_service import PromptService
                    _ps = PromptService(self.db_session)
                    _mcp_custom_prompt = await _ps.get_prompt('mcp_agent_system')
                except Exception:
                    pass

                async def _mcp_tool_log(name: str, args: dict, result: str) -> None:
                    preview = str(result)[:300].replace('\n', ' ')
                    args_preview = json.dumps(args, ensure_ascii=False)[:200]
                    await task_service.add_log(
                        task.id, organization_id, 'mcp_tool',
                        f'{name}({args_preview}) -> {preview}',
                    )

                # Build executor: local filesystem or remote API
                _mcp_executor = None
                if _is_remote:
                    from agena_agents.agents.tools.remote_executor import RemoteToolExecutor
                    _remote_spec = routing.remote_repo  # "github:owner/repo" or "azure:project/repo"

                    async def _remote_read_file(path: str) -> str | None:
                        try:
                            return await self._fetch_remote_file_content(
                                _remote_spec, organization_id, path,
                            )
                        except Exception:
                            return None

                    async def _remote_list_files() -> list[str]:
                        try:
                            return await self._fetch_remote_file_list(
                                _remote_spec, organization_id,
                            )
                        except Exception:
                            return []

                    _file_tree = await self._build_remote_file_tree_only(
                        _remote_spec, organization_id,
                    )
                    _mcp_executor = RemoteToolExecutor(
                        read_file_fn=_remote_read_file,
                        list_files_fn=_remote_list_files,
                        file_tree=_file_tree,
                    )

                mcp_result = await engine.run(
                    task_title=task.title,
                    # Pass the enriched description (playbooks + skills +
                    # attachments) so MCP agent has the same context as
                    # CLIs and the classic pipeline.
                    task_description=effective_description or task.description or '',
                    workspace_path=routing.local_repo_path if _is_local else None,
                    executor=_mcp_executor,
                    system_prompt=_mcp_custom_prompt,
                    repo_context=_mcp_agents_md,
                    playbook=routing.repo_playbook or tenant_playbook,
                    allow_commands=_is_local,
                    on_tool_call=_mcp_tool_log,
                )
                state = mcp_result
                _fc = len(mcp_result.get('file_changes', []))
                _tc = mcp_result.get('tool_calls_count', 0)
                _dur = mcp_result.get('duration_sec', 0)
                _summary = mcp_result.get('completion_summary', '') or ''
                await task_service.add_log(
                    task.id, organization_id, 'agent',
                    f'MCP Agent completed: {_tc} tool calls, {_fc} files changed, {_dur}s\n'
                    f'Summary: {_summary[:500]}',
                )
                # If MCP produced no changes and no tool calls, treat as failure
                if _fc == 0 and _tc == 0:
                    _fail_reason = _summary[:500] if _summary else 'MCP Agent failed to execute — 0 tool calls, 0 file changes. Check provider/model configuration.'
                    await task_service.add_log(task.id, organization_id, 'agent', f'MCP Agent completed analysis but produced no file changes.')
                    raise ValueError(_fail_reason)
            else:
                orchestrator = await self._build_orchestrator(organization_id, routing)
                task_description_for_ai = task.description or ''
                # Build vision inputs (data URLs) for any mode that drives the
                # classic agent pipeline OR flow runner. Pulls images from
                # description URLs (Azure/Jira inline) AND from
                # task_attachments rows on disk so vision-capable LLMs receive
                # the actual bytes rather than just file paths.
                task_image_inputs = await self._build_task_image_inputs(
                    task_description_for_ai, organization_id, task_id=task.id,
                )
                # Build repo context into task description before flow starts
                # Check for remote agents.md first — if it exists, skip expensive
                # full repo context build (saves ~128K chars / ~32K tokens)
                _remote_agents_md: str | None = None
                if not routing.local_repo_path and routing.remote_repo:
                    _remote_agents_md = await self._fetch_remote_agents_md(routing.remote_repo, organization_id)

                if _remote_agents_md:
                    # agents.md found — build lightweight file tree only (no source content)
                    _repo_ctx = await self._build_remote_file_tree_only(routing.remote_repo, organization_id)
                    await task_service.add_log(task.id, organization_id, 'agent',
                        f'Repo context: agents.md ({len(_remote_agents_md)} chars) + file tree ({len(_repo_ctx or "")} chars)\n'
                        f'repo_path: {routing.local_repo_path}\n'
                        f'task_images: {len(task_image_inputs)}'
                    )
                else:
                    _repo_ctx = await self._build_repo_context(
                        local_repo_path=routing.local_repo_path,
                        organization_id=organization_id,
                        user_id=task.created_by_user_id,
                        task_title=task.title or '',
                        task_description=task.description or '',
                        remote_repo=routing.remote_repo,
                    )
                    await task_service.add_log(task.id, organization_id, 'agent',
                        f'Repo context built: {len(_repo_ctx or "")} chars, '
                        f'has_agents_md: {"agents.md" in (_repo_ctx or "").lower()}, '
                        f'repo_path: {routing.local_repo_path}\n'
                        f'task_images: {len(task_image_inputs)}'
                    )
                enriched_desc = self._build_effective_description(
                    task.description,
                    routing.execution_prompt,
                    routing.repo_playbook,
                    None,  # tenant_playbook
                    _repo_ctx,
                )
                # Same attachment injection as the non-flow path so flow
                # nodes also see uploaded files.
                try:
                    _flow_atts = await self._build_attachments_section(
                        task.id, organization_id, description=task.description,
                    )
                    if _flow_atts:
                        enriched_desc = f'{enriched_desc}\n\n{_flow_atts}'
                except Exception:
                    pass
                payload_with_context = dict(payload)
                payload_with_context['description'] = enriched_desc
                # Run flow step-by-step with logging
                flow_state: dict[str, Any] = {
                    'task': payload_with_context,
                    'mode': mode,
                    'usage': {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0},
                    'model_usage': [],
                }
                def _get_usage(fs: dict) -> dict:
                    return dict(fs.get('usage', {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0}))

                def _usage_delta(before: dict, after: dict) -> dict:
                    return {
                        'prompt_tokens': after.get('prompt_tokens', 0) - before.get('prompt_tokens', 0),
                        'completion_tokens': after.get('completion_tokens', 0) - before.get('completion_tokens', 0),
                        'total_tokens': after.get('total_tokens', 0) - before.get('total_tokens', 0),
                    }

                async def _step_event(step_name: str, delta: dict, step_model: str, step_start: datetime, step_dur: float):
                    step_cost = self.cost_tracker.estimate_cost_usd(
                        prompt_tokens=int(delta.get('prompt_tokens', 0)),
                        completion_tokens=int(delta.get('completion_tokens', 0)),
                        model=step_model or routing.preferred_agent_model or 'gpt-4o-mini',
                    )
                    await usage_event_service.create_event(
                        organization_id=organization_id,
                        user_id=task.created_by_user_id,
                        task_id=task.id,
                        operation_type=f'flow_step:{step_name}',
                        provider=routing.preferred_agent_provider or 'openai',
                        model=step_model or routing.preferred_agent_model,
                        status='completed',
                        prompt_tokens=int(delta.get('prompt_tokens', 0)),
                        completion_tokens=int(delta.get('completion_tokens', 0)),
                        total_tokens=int(delta.get('total_tokens', 0)),
                        cost_usd=float(step_cost),
                        started_at=step_start,
                        ended_at=datetime.utcnow(),
                        duration_ms=int(step_dur * 1000),
                        local_repo_path=routing.local_repo_path,
                    )

                # Step 1: Fetch context
                total_steps = 4 if mode == 'flow' else 3
                await task_service.add_log(task.id, organization_id, 'agent', f'Step 1/{total_steps}: Fetching context & memory... (mode={mode})')
                u_before = _get_usage(flow_state)
                s_start = datetime.utcnow()
                s_clock = time.perf_counter()
                if not routing.local_repo_path and routing.remote_repo and _repo_ctx:
                    # Remote mode: skip LLM summarisation — use repo context directly
                    # Still do memory search for similarity hits
                    org_id = int(payload.get('organization_id', 0) or 0) or None
                    memory_context = await orchestrator.memory_store.search_similar(
                        query=f"{task.title}\n{task.description}",
                        limit=3,
                        organization_id=org_id,
                    )
                    flow_state['context_summary'] = ''  # not needed — planner gets _repo_ctx directly
                    flow_state['memory_context'] = memory_context
                    flow_state['memory_status'] = await orchestrator.memory_store.get_status()
                    await task_service.add_log(task.id, organization_id, 'agent',
                        f'Remote mode: skipped LLM context summarisation (repo context: {len(_repo_ctx)} chars)')
                else:
                    flow_state = await orchestrator.fetch_context_node(flow_state)
                u_after = _get_usage(flow_state)
                s_model = (flow_state.get('model_usage') or [''])[-1]
                await _step_event('fetch_context', _usage_delta(u_before, u_after), s_model, s_start, time.perf_counter() - s_clock)
                ctx_len = len(flow_state.get('context_summary', ''))
                mem_hits = len(flow_state.get('memory_context', []))

                # Step 2: PM analyze (only in flow mode)
                spec = {}
                if mode == 'flow':
                    pm_ctx = flow_state.get('context_summary', '')
                    pm_has_source = '=== RELEVANT SOURCE FILES ===' in pm_ctx
                    source_file_names = re.findall(r'--- ([\w/._-]+)', pm_ctx) if pm_has_source else []
                    await task_service.add_log(task.id, organization_id, 'agent',
                        f'Step 2/{total_steps}: PM analyzing task...\n'
                        f'  context_summary: {ctx_len} chars | has_source_files: {pm_has_source} | source_files: {source_file_names[:10]}\n'
                        f'  memory_hits: {mem_hits}\n'
                        f'  system_prompt: PM_SYSTEM_PROMPT (technical review agent)\n'
                        f'  model: {routing.preferred_agent_model or "default"}'
                    )
                    u_before = _get_usage(flow_state)
                    s_start = datetime.utcnow()
                    s_clock = time.perf_counter()
                    flow_state = await orchestrator.analyze_node(flow_state)
                    u_after = _get_usage(flow_state)
                    pm_delta = _usage_delta(u_before, u_after)
                    s_model = (flow_state.get('model_usage') or [''])[-1]
                    await _step_event('pm_analyze', pm_delta, s_model, s_start, time.perf_counter() - s_clock)
                    spec = flow_state.get('spec', {})
                    await task_service.add_log(task.id, organization_id, 'agent',
                        f'PM result:\n'
                        f'  model: {s_model} | tokens: prompt={pm_delta["prompt_tokens"]} completion={pm_delta["completion_tokens"]}\n'
                        f'  status: {spec.get("status","")} | score: {spec.get("score","")} | storyPoint: {spec.get("storyPoint","")}\n'
                        f'  scoreReason: {str(spec.get("scoreReason",""))[:200]}\n'
                        f'  summary: {str(spec.get("summary",""))[:300]}\n'
                        f'  file_changes: {json.dumps(spec.get("file_changes",[]), ensure_ascii=False)[:400]}\n'
                        f'  recommendedNextStep: {str(spec.get("recommendedNextStep",""))[:200]}'
                    )
                else:
                    # === 2-STEP AI MODE ===
                    repo_root = None
                    if routing.local_repo_path:
                        _rp = Path(routing.local_repo_path).expanduser().resolve()
                        repo_root = _rp if _rp.is_dir() else None
                    agents_md_content, agents_md_source, agents_pkg_dir = self._resolve_repo_guide(repo_root)

                    # Remote mode: use pre-fetched agents.md if available
                    if not agents_md_content and _remote_agents_md:
                        agents_md_content = _remote_agents_md
                        agents_md_source = 'remote:agents.md'

                    if not self._repo_guide_is_sufficient(agents_md_content, agents_pkg_dir):
                        if repo_root:
                            agents_md_content = self._build_full_scan_context(
                                repo_root,
                                task.title,
                                task_description_for_ai,
                            )
                            agents_md_source = 'fallback:full_scan'
                    if not agents_md_content:
                        # Use remote repo context for planner — prefer file tree + limited
                        # source over LLM summary to keep tokens low
                        if _repo_ctx:
                            # Send file tree + first ~30K chars of source (enough for planner)
                            tree_end = _repo_ctx.find('=== END FILE TREE ===')
                            if tree_end >= 0:
                                tree_section = _repo_ctx[:tree_end + len('=== END FILE TREE ===')]
                                source_section = _repo_ctx[tree_end + len('=== END FILE TREE ==='):]
                                agents_md_content = tree_section + source_section[:30000]
                            else:
                                agents_md_content = _repo_ctx[:40000]
                            agents_md_source = 'fallback:remote_repo_context(trimmed)'
                        else:
                            agents_md_content = flow_state.get('context_summary', '')
                            agents_md_source = 'fallback:flow_context'

                    # Remote mode: always append file tree so planner uses real paths
                    if not repo_root and _repo_ctx:
                        agents_md_content = agents_md_content + '\n\n' + _repo_ctx
                        agents_md_source = agents_md_source + '+file_tree'

                    # Build planner input: index + relevant package signatures
                    planner_md = agents_md_content
                    loaded_pkgs: list[str] = []
                    if agents_pkg_dir and Path(agents_pkg_dir).is_dir():
                        planner_md = self._build_planner_context(
                            agents_md_content, agents_pkg_dir,
                            task.title, task_description_for_ai,
                            loaded_pkgs,
                        )
                    else:
                        # Legacy: trim inline (agents.md has signatures embedded)
                        planner_md = self._trim_agents_md(agents_md_content, task.title, task_description_for_ai)
                    await task_service.add_log(task.id, organization_id, 'agent',
                        f'Step 2/{total_steps}: AI Planning...\n'
                        f'  agents_md: {len(agents_md_content)} chars → planner: {len(planner_md)} chars (source: {agents_md_source})\n'
                        f'  loaded_packages: {loaded_pkgs or "all (legacy)"}\n'
                        f'  task_images: {len(task_image_inputs)}\n'
                        f'  system_prompt: AI_PLAN_SYSTEM_PROMPT\n'
                        f'  model: {routing.preferred_agent_model or "default"}'
                    )
                    # Skills already baked into effective_description (see
                    # universal retrieval above), so no need to re-inject
                    # here. Classic pipeline agents pick them up through
                    # the task_description_for_ai field.
                    u_before = _get_usage(flow_state)
                    s_start = datetime.utcnow()
                    s_clock = time.perf_counter()
                    plan, plan_usage, plan_model = await orchestrator.agents.run_ai_plan(
                        task_title=task.title,
                        task_description=task_description_for_ai,
                        agents_md=planner_md,
                        task_images=task_image_inputs,
                    )
                    orchestrator._merge_usage(flow_state, plan_usage)
                    flow_state['model_usage'].append(plan_model)
                    plan_delta = _usage_delta(u_before, _get_usage(flow_state))
                    await _step_event('ai_plan', plan_delta, plan_model, s_start, time.perf_counter() - s_clock)

                    plan_files = self._extract_plan_files(plan)
                    plan_changes = plan.get('changes', [])
                    await task_service.add_log(task.id, organization_id, 'agent',
                        f'AI Plan result:\n'
                        f'  model: {plan_model} | tokens: prompt={plan_delta["prompt_tokens"]} completion={plan_delta["completion_tokens"]}\n'
                        f'  plan: {str(plan.get("plan",""))[:300]}\n'
                        f'  files: {plan_files}\n'
                        f'  changes: {json.dumps(plan_changes, ensure_ascii=False)[:400]}'
                    )

                    # Step 2b: Read the actual files from disk (or remote API)
                    if repo_root:
                        file_contents, total_read, found_files, missing_files = self._read_plan_files(
                            repo_root,
                            plan_files,
                            task.title,
                            task_description_for_ai,
                        )
                    elif routing.remote_repo and plan_files:
                        file_contents, total_read, found_files, missing_files = await self._read_plan_files_remote(
                            routing.remote_repo,
                            organization_id,
                            plan_files,
                            task_title=task.title,
                            task_description=task_description_for_ai,
                        )
                    else:
                        file_contents, total_read, found_files, missing_files = '', 0, [], list(plan_files)

                    if plan_files and total_read == 0 and repo_root:
                        fallback_planner_md = self._build_full_scan_context(
                            repo_root,
                            task.title,
                            task_description_for_ai,
                        )
                        if fallback_planner_md and fallback_planner_md != planner_md:
                            await task_service.add_log(task.id, organization_id, 'agent',
                                'Planner selected only unreadable files; retrying with fresh repo scan.\n'
                                f'  initial_files: {plan_files}\n'
                                f'  missing_files: {missing_files}\n'
                                f'  retry_source: fallback:full_scan'
                            )
                            u_before = _get_usage(flow_state)
                            s_start = datetime.utcnow()
                            s_clock = time.perf_counter()
                            plan, plan_usage, plan_model = await orchestrator.agents.run_ai_plan(
                                task_title=task.title,
                                task_description=task_description_for_ai,
                                agents_md=fallback_planner_md,
                                task_images=task_image_inputs,
                            )
                            orchestrator._merge_usage(flow_state, plan_usage)
                            flow_state['model_usage'].append(plan_model)
                            plan_delta = _usage_delta(u_before, _get_usage(flow_state))
                            await _step_event('ai_replan', plan_delta, plan_model, s_start, time.perf_counter() - s_clock)

                            plan_files = self._extract_plan_files(plan)
                            plan_changes = plan.get('changes', [])
                            await task_service.add_log(task.id, organization_id, 'agent',
                                f'AI Replan result:\n'
                                f'  model: {plan_model} | tokens: prompt={plan_delta["prompt_tokens"]} completion={plan_delta["completion_tokens"]}\n'
                                f'  plan: {str(plan.get("plan",""))[:300]}\n'
                                f'  files: {plan_files}\n'
                                f'  changes: {json.dumps(plan_changes, ensure_ascii=False)[:400]}'
                            )
                            file_contents, total_read, found_files, missing_files = self._read_plan_files(
                                repo_root,
                                plan_files,
                                task.title,
                                task_description_for_ai,
                            )

                    if not plan_files and repo_root:
                        raise RuntimeError('AI planner returned no repository files. Aborting before code generation.')
                    if not plan_files and not repo_root:
                        # Remote repo mode: context already provided via flow_state, skip file reading
                        plan_files = []
                    if total_read == 0 and repo_root:
                        raise RuntimeError(
                            'AI planner selected repository files that could not be read from disk. '
                            f'Aborting before code generation. Missing files: {missing_files[:10]}'
                        )
                    if missing_files:
                        await task_service.add_log(task.id, organization_id, 'agent',
                            'Planner returned some missing files; continuing only with files that exist.\n'
                            f'  found_files: {found_files}\n'
                            f'  missing_files: {missing_files}'
                        )
                        plan = self._filter_plan_to_existing_files(plan, found_files)
                        plan_files = list(found_files)

                    flow_state['spec'] = plan

                # Step 3: Developer generate code
                if mode == 'ai':
                    # Split files into batches of ~80K chars to keep context small
                    BATCH_CHAR_LIMIT = 80_000
                    file_batches: list[tuple[str, list[str], dict]] = []  # (contents, files, sub_plan)
                    current_batch_parts: list[str] = []
                    current_batch_files: list[str] = []
                    current_batch_size = 0

                    # Parse individual file sections from file_contents
                    file_sections: dict[str, str] = {}
                    if file_contents:
                        import re as _re
                        for section in _re.split(r'\n--- ', file_contents):
                            if not section.strip():
                                continue
                            header_end = section.find(' ---\n')
                            if header_end < 0:
                                header_end = section.find('---\n')
                            if header_end < 0:
                                continue
                            # Extract path from header like "path/file.go (1234 chars)"
                            header = section[:header_end].strip()
                            path = _re.sub(r'\s*\(.*\)\s*$', '', header).strip()
                            body = section[header_end + 4:]  # skip " ---\n"
                            if path:
                                file_sections[path] = body

                    for fp in plan_files:
                        section = file_sections.get(fp, '')
                        section_text = f'\n--- {fp} ({len(section)} chars) ---\n{section}'
                        if current_batch_size + len(section_text) > BATCH_CHAR_LIMIT and current_batch_parts:
                            sub_plan = self._filter_plan_to_existing_files(plan, current_batch_files)
                            file_batches.append(('\n'.join(current_batch_parts), list(current_batch_files), sub_plan))
                            current_batch_parts = []
                            current_batch_files = []
                            current_batch_size = 0
                        current_batch_parts.append(section_text)
                        current_batch_files.append(fp)
                        current_batch_size += len(section_text)

                    if current_batch_parts:
                        sub_plan = self._filter_plan_to_existing_files(plan, current_batch_files) if len(file_batches) > 0 else plan
                        file_batches.append(('\n'.join(current_batch_parts), list(current_batch_files), sub_plan))

                    # If everything fits in one batch, just use original
                    if len(file_batches) <= 1:
                        file_batches = [(file_contents, plan_files, plan)]

                    all_generated: list[str] = []
                    u_before = _get_usage(flow_state)
                    s_start = datetime.utcnow()
                    s_clock = time.perf_counter()

                    for batch_idx, (batch_contents, batch_files, batch_plan) in enumerate(file_batches):
                        batch_label = f'Step 3/{total_steps}: Developer coding'
                        if len(file_batches) > 1:
                            batch_label += f' (batch {batch_idx + 1}/{len(file_batches)})'
                        await task_service.add_log(task.id, organization_id, 'agent',
                            f'{batch_label}...\n'
                            f'  plan_files: {batch_files}\n'
                            f'  file_contents: {len(batch_contents)} chars ({len(batch_files)} files)\n'
                            f'  task_images: {len(task_image_inputs)}\n'
                            f'  system_prompt: AI_CODE_SYSTEM_PROMPT\n'
                            f'  model: {routing.preferred_agent_model or "default"} | max_output_tokens: 128000'
                        )
                        batch_generated, code_usage, code_model = await orchestrator.agents.run_ai_code(
                            task_title=task.title,
                            task_description=task_description_for_ai,
                            plan=batch_plan,
                            file_contents=batch_contents,
                            task_images=task_image_inputs if batch_idx == 0 else None,
                        )
                        # Retry once on refusal
                        if batch_generated.strip().lower().startswith("i'm sorry") or len(batch_generated.strip()) < 100:
                            await task_service.add_log(task.id, organization_id, 'agent',
                                f'Developer refused or empty output ({len(batch_generated)} chars), retrying...')
                            batch_generated, code_usage2, code_model = await orchestrator.agents.run_ai_code(
                                task_title=task.title,
                                task_description=task_description_for_ai,
                                plan=batch_plan,
                                file_contents=batch_contents,
                                task_images=task_image_inputs if batch_idx == 0 else None,
                            )
                            orchestrator._merge_usage(flow_state, code_usage2)
                            flow_state['model_usage'].append(code_model)
                        orchestrator._merge_usage(flow_state, code_usage)
                        flow_state['model_usage'].append(code_model)
                        if batch_generated.strip() and not batch_generated.strip().lower().startswith("i'm sorry"):
                            all_generated.append(batch_generated)

                    generated = '\n\n'.join(all_generated)
                    flow_state['generated_code'] = generated
                    dev_delta = _usage_delta(u_before, _get_usage(flow_state))
                    gen_len = len(generated)
                    await _step_event('developer_generate', dev_delta, code_model, s_start, time.perf_counter() - s_clock)
                else:
                    # Flow mode step 3: use orchestrator node
                    spec = flow_state.get('spec', {})
                    dev_ctx = flow_state.get('context_summary', '')
                    await task_service.add_log(task.id, organization_id, 'agent',
                        f'Step 3/{total_steps}: Developer generating code...\n'
                        f'  spec_goal: {str(spec.get("goal",spec.get("summary","")))[:150]}\n'
                        f'  target_files_context: {len(dev_ctx)} chars\n'
                        f'  system_prompt: DEV_SYSTEM (flow mode)\n'
                        f'  model: {routing.preferred_agent_model or "default"} | max_output_tokens: 128000'
                    )
                    u_before = _get_usage(flow_state)
                    s_start = datetime.utcnow()
                    s_clock = time.perf_counter()
                    flow_state = await orchestrator.generate_code_node(flow_state)
                    dev_delta = _usage_delta(u_before, _get_usage(flow_state))
                    s_model = (flow_state.get('model_usage') or [''])[-1]
                    gen_len = len(flow_state.get('generated_code', ''))
                    await _step_event('developer_generate', dev_delta, s_model, s_start, time.perf_counter() - s_clock)
                    generated = flow_state.get('generated_code', '')
                dev_model = code_model if mode == 'ai' else (flow_state.get('model_usage') or [''])[-1]
                await task_service.add_log(task.id, organization_id, 'agent',
                    f'Developer result:\n'
                    f'  model: {dev_model} | tokens: prompt={dev_delta["prompt_tokens"]} completion={dev_delta["completion_tokens"]}\n'
                    f'  output_length: {gen_len} chars\n'
                    f'  output_preview:\n{generated[:800]}'
                )

                # Skip reviewer — use developer output directly
                flow_state['final_code'] = generated
                final_len = gen_len

                await task_service.add_log(task.id, organization_id, 'agent', f'Flow complete: final_code={final_len} chars, tokens={flow_state.get("usage",{}).get("total_tokens",0)}')
                state = flow_state
            await task_service.add_log(
                task.id,
                organization_id,
                'memory_impact',
                self._build_memory_impact_message(state),
            )
            if self._is_mock_run(state):
                raise RuntimeError(
                    'AI pipeline is running in mock mode (OPENAI_API_KEY is missing/placeholder). '
                    'Real code generation is disabled until a valid API key is configured.'
                )
            usage = state.get('usage', {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0})
            model_for_cost = (state.get('model_usage') or ['gpt-4o-mini'])[-1]
            estimated_cost = self.cost_tracker.estimate_cost_usd(
                prompt_tokens=int(usage.get('prompt_tokens', 0)),
                completion_tokens=int(usage.get('completion_tokens', 0)),
                model=model_for_cost,
            )
            guardrail_error = self._validate_cost_guardrails(
                max_tokens=task.max_tokens,
                max_cost_usd=task.max_cost_usd,
                total_tokens=int(usage.get('total_tokens', 0)),
                estimated_cost_usd=estimated_cost,
            )
            if guardrail_error:
                await task_service.add_log(task.id, organization_id, 'guardrail', guardrail_error)
                raise RuntimeError(guardrail_error)

            final_code = (
                (state.get('final_code') or '').strip()
                or (state.get('reviewed_code') or '').strip()
                or (state.get('generated_code') or '').strip()
            )
            pr_url = None
            branch_name = None

            # MCP agent mode: build PR payload directly from file_changes
            # instead of parsing final_code string (which may not have **File:** blocks)
            # Skip MCP file_changes path when CLI provider was used — CLI produces
            # markdown file blocks in final_code, not structured file_changes.
            _used_cli_provider = routing.preferred_agent_provider in ('claude_cli', 'codex_cli')
            mcp_file_changes = state.get('file_changes') if mode == 'mcp_agent' and not _used_cli_provider else None
            if mode == 'mcp_agent' and not mcp_file_changes and not _used_cli_provider and not final_code:
                # MCP agent ran but produced no file changes — log and continue
                await task_service.add_log(task.id, organization_id, 'agent',
                    'MCP Agent completed analysis but produced no file changes.')
                pr_payload = CreatePRRequest(
                    title=f"[AGENA #{task.id}] {task.title}"[:120],
                    body=state.get('completion_summary', '') or 'No changes produced',
                    branch_name=f"agena/task-{task.id}",
                    base_branch='main',
                    commit_message=f"[AGENA #{task.id}] {task.title}"[:120],
                    files=[],
                )
            elif mcp_file_changes:
                _branch = f"agena/task-{task.id}"
                _title = f"[AGENA #{task.id}] {task.title}"[:120]
                _body = state.get('completion_summary', '') or task.title
                # Extract base branch from remote_repo spec if available
                _base = 'main'
                _rr = routing.remote_repo or ''
                if '@' in _rr:
                    _base = _rr.rsplit('@', 1)[1]
                pr_payload = CreatePRRequest(
                    title=_title,
                    body=_body,
                    branch_name=_branch,
                    base_branch=_base,
                    commit_message=_title,
                    files=[
                        GitHubFileChange(path=fc['path'], content=fc['content'])
                        for fc in mcp_file_changes
                    ],
                )
            else:
                pr_payload = await self._build_pr_payload(task=payload, reviewed_code=final_code, local_repo_path=routing.local_repo_path)
            try:
                await task_service.add_log(
                    task.id,
                    organization_id,
                    'code_ready',
                    f'Code pipeline finished, {len(pr_payload.files)} file candidate(s) prepared',
                )
                await task_service.add_log(
                    task.id,
                    organization_id,
                    'code_preview',
                    self._build_code_preview_message(pr_payload.files),
                )
                if routing.local_repo_path:
                    await task_service.add_log(
                        task.id,
                        organization_id,
                        'code_diff',
                        self._build_code_diff_message(routing.local_repo_path, pr_payload.files),
                    )
                elif final_code:
                    await task_service.add_log(
                        task.id,
                        organization_id,
                        'code_diff',
                        f'Code Diff ({len(pr_payload.files)} files):\n\n{final_code}',
                    )
            except Exception as log_exc:
                logger.error('Code preview/diff logging failed: %s', log_exc)

            logger.info('PR routing: create_pr=%s, files=%d, local=%s, remote=%s, source=%s',
                create_pr, len(pr_payload.files), routing.local_repo_path,
                routing.remote_repo, routing.effective_source)

            if routing.local_repo_path:
                azure_remote_pat: str | None = None
                if routing.effective_source == 'azure' and routing.azure_repo_url:
                    azure_cfg = await IntegrationConfigService(self.db_session).get_config(organization_id, 'azure')
                    azure_remote_pat = azure_cfg.secret if azure_cfg and azure_cfg.secret else None

                await task_service.add_log(
                    task.id,
                    organization_id,
                    'local_exec',
                    f'Applying changes in mapped local repo: {routing.local_repo_mapping or routing.local_repo_path}',
                )
                has_changes, branch_name = await self.local_repo_service.apply_changes_and_push(
                    repo_path=routing.local_repo_path,
                    branch_name=pr_payload.branch_name,
                    base_branch=pr_payload.base_branch,
                    commit_message=pr_payload.commit_message,
                    files=pr_payload.files,
                    remote_url=(routing.azure_repo_url if routing.effective_source == 'azure' else None) if create_pr else None,
                    remote_pat=azure_remote_pat if create_pr else None,
                )
                if not has_changes:
                    await task_service.add_log(task.id, organization_id, 'local_exec', 'No file changes detected, skipping PR')

                if create_pr and has_changes:
                    if routing.effective_source == 'azure' and routing.azure_project and routing.azure_repo_url:
                        try:
                            pr_url = await self.azure_pr_service.create_pr(
                                organization_id,
                                project=routing.azure_project,
                                repo_url=routing.azure_repo_url,
                                source_branch=branch_name,
                                target_branch=pr_payload.base_branch,
                                title=pr_payload.title,
                                description=pr_payload.body,
                                work_item_id=getattr(task, 'external_work_item_id', None),
                            )
                        except Exception as pr_exc:
                            await notification_service.notify_event(
                                organization_id=organization_id,
                                user_id=task.created_by_user_id,
                                event_type='pr_failed',
                                title=f'PR failed for task #{task.id}',
                                message=str(pr_exc)[:240],
                                severity='error',
                                task_id=task.id,
                            )
                            raise
                        await task_service.add_log(task.id, organization_id, 'pr', f'Azure PR created: {pr_url}')
                        await notification_service.notify_event(
                            organization_id=organization_id,
                            user_id=task.created_by_user_id,
                            event_type='pr_created',
                            title=f'PR created for task #{task.id}',
                            message=pr_url or 'Azure PR created',
                            severity='success',
                            task_id=task.id,
                            payload={'pr_url': pr_url},
                        )
                    else:
                        await task_service.add_log(
                            task.id,
                            organization_id,
                            'pr',
                            'Local push completed but PR target was not resolved from task mapping',
                        )
            elif create_pr and routing.remote_repo and routing.remote_repo.startswith('azure:'):
                # Remote mode: push files via Azure API and create PR
                try:
                    spec = routing.remote_repo[len('azure:'):]
                    remote_branch = 'main'
                    if '@' in spec:
                        spec, remote_branch = spec.rsplit('@', 1)
                    remote_project, remote_repo_name = spec.split('/', 1)
                    await task_service.add_log(task.id, organization_id, 'pr',
                        f'Pushing {len(pr_payload.files)} file(s) to Azure via API: {remote_project}/{remote_repo_name}')
                    pr_url = await self.azure_pr_service.push_files_and_create_pr(
                        organization_id,
                        project=remote_project,
                        repo_name=remote_repo_name,
                        branch_name=pr_payload.branch_name,
                        target_branch=remote_branch,
                        title=pr_payload.title,
                        description=pr_payload.body,
                        files=[{'path': f.path, 'content': f.content} for f in pr_payload.files],
                        commit_message=pr_payload.commit_message,
                        work_item_id=getattr(task, 'external_work_item_id', None),
                    )
                    branch_name = pr_payload.branch_name
                    await task_service.add_log(task.id, organization_id, 'pr', f'Azure PR created: {pr_url}')
                    await notification_service.notify_event(
                        organization_id=organization_id,
                        user_id=task.created_by_user_id,
                        event_type='pr_created',
                        title=f'PR created for task #{task.id}',
                        message=pr_url or 'Azure PR created',
                        severity='success',
                        task_id=task.id,
                        payload={'pr_url': pr_url},
                    )
                except Exception as pr_exc:
                    await task_service.add_log(task.id, organization_id, 'pr',
                        f'Azure remote PR failed: {str(pr_exc)[:300]}')
                    await notification_service.notify_event(
                        organization_id=organization_id,
                        user_id=task.created_by_user_id,
                        event_type='pr_failed',
                        title=f'PR failed for task #{task.id}',
                        message=str(pr_exc)[:240],
                        severity='error',
                        task_id=task.id,
                    )
            elif create_pr and routing.remote_repo and routing.remote_repo.startswith('github:'):
                # Remote mode: push files via GitHub API and create PR
                try:
                    spec = routing.remote_repo[len('github:'):]
                    remote_branch = 'main'
                    if '@' in spec:
                        spec, remote_branch = spec.rsplit('@', 1)
                    gh_owner, gh_repo = spec.split('/', 1)
                    await task_service.add_log(task.id, organization_id, 'pr',
                        f'Pushing {len(pr_payload.files)} file(s) to GitHub via API: {gh_owner}/{gh_repo}')
                    pr_url = await self.github_service.push_files_and_create_pr(
                        owner=gh_owner,
                        repo=gh_repo,
                        branch_name=pr_payload.branch_name,
                        target_branch=remote_branch,
                        title=pr_payload.title,
                        body=pr_payload.body,
                        files=[{'path': f.path, 'content': f.content} for f in pr_payload.files],
                        commit_message=pr_payload.commit_message,
                        organization_id=organization_id,
                    )
                    branch_name = pr_payload.branch_name
                    await task_service.add_log(task.id, organization_id, 'pr', f'GitHub PR created: {pr_url}')
                    await notification_service.notify_event(
                        organization_id=organization_id,
                        user_id=task.created_by_user_id,
                        event_type='pr_created',
                        title=f'PR created for task #{task.id}',
                        message=pr_url or 'GitHub PR created',
                        severity='success',
                        task_id=task.id,
                        payload={'pr_url': pr_url},
                    )
                except Exception as pr_exc:
                    await task_service.add_log(task.id, organization_id, 'pr',
                        f'GitHub remote PR failed: {str(pr_exc)[:300]}')
                    await notification_service.notify_event(
                        organization_id=organization_id,
                        user_id=task.created_by_user_id,
                        event_type='pr_failed',
                        title=f'PR failed for task #{task.id}',
                        message=str(pr_exc)[:240],
                        severity='error',
                        task_id=task.id,
                    )
            elif create_pr and routing.effective_source == 'azure':
                await task_service.add_log(
                    task.id,
                    organization_id,
                    'pr',
                    'Azure source detected but Azure PR target is missing (project/repo/mapping). GitHub fallback skipped.',
                )
                await notification_service.notify_event(
                    organization_id=organization_id,
                    user_id=task.created_by_user_id,
                    event_type='pr_failed',
                    title=f'PR skipped for task #{task.id}',
                    message='Azure task requires Azure project/repo mapping before PR creation.',
                    severity='warning',
                    task_id=task.id,
                )
            elif create_pr and self._can_create_github_pr():
                branch_name = pr_payload.branch_name
                try:
                    pr_url = await self.github_service.create_pr(pr_payload)
                except Exception as pr_exc:
                    await notification_service.notify_event(
                        organization_id=organization_id,
                        user_id=task.created_by_user_id,
                        event_type='pr_failed',
                        title=f'PR failed for task #{task.id}',
                        message=str(pr_exc)[:240],
                        severity='error',
                        task_id=task.id,
                    )
                    raise
                await task_service.add_log(task.id, organization_id, 'pr', f'GitHub PR created: {pr_url}')
                await notification_service.notify_event(
                    organization_id=organization_id,
                    user_id=task.created_by_user_id,
                    event_type='pr_created',
                    title=f'PR created for task #{task.id}',
                    message=pr_url or 'GitHub PR created',
                    severity='success',
                    task_id=task.id,
                    payload={'pr_url': pr_url},
                )
            elif create_pr:
                await task_service.add_log(task.id, organization_id, 'pr', 'PR skipped because provider configuration is missing')
                await notification_service.notify_event(
                    organization_id=organization_id,
                    user_id=task.created_by_user_id,
                    event_type='pr_failed',
                    title=f'PR skipped for task #{task.id}',
                    message='Provider configuration is missing.',
                    severity='warning',
                    task_id=task.id,
                )

            run = RunRecord(
                task_id=task.id,
                organization_id=organization_id,
                source=payload['source'],
                spec=state.get('spec', {}),
                generated_code=state.get('generated_code', ''),
                reviewed_code=final_code,
                usage_prompt_tokens=usage.get('prompt_tokens', 0),
                usage_completion_tokens=usage.get('completion_tokens', 0),
                usage_total_tokens=usage.get('total_tokens', 0),
                estimated_cost_usd=estimated_cost,
                pr_url=pr_url,
            )
            self.db_session.add(run)

            task.status = 'completed'
            task.pr_url = pr_url
            task.branch_name = branch_name
            await self.db_session.commit()

            # Auto-unblock: queue dependent tasks whose dependencies are now all completed
            await self._auto_queue_dependents(organization_id, task.id, task_service, create_pr, mode)

            try:
                await orchestrator.memory_store.upsert_memory(
                    key=str(task.id),
                    input_text=f"{task.title}\n{task.description or ''}",
                    output_text=final_code,
                    organization_id=organization_id,
                )
            except NameError:
                pass  # orchestrator not created in mcp_agent/codex_cli/claude_cli modes

            # Fire-and-forget: try to distil this completed task into a
            # reusable Skill for future grounding. Wrapped in a background
            # task so any LLM hiccup here doesn't affect the task's
            # completion status or PR handoff.
            try:
                import asyncio as _asyncio
                from agena_services.services.skill_extractor import (
                    SkillExtractor,
                    run_skill_extraction_job,
                )
                _ = SkillExtractor  # import guard
                _asyncio.create_task(run_skill_extraction_job(
                    organization_id=organization_id,
                    task_id=int(task.id),
                ))
            except Exception as exc:
                logger.info('Skill extraction dispatch skipped for task %s: %s', task.id, exc)

            publish_fire_and_forget(organization_id, 'task_status', {
                'task_id': task.id, 'status': 'completed', 'title': task.title,
            })

            # Post comment on Sentry issue when PR is created
            if task.source == 'sentry' and task.external_id and pr_url:
                try:
                    from agena_services.integrations.sentry_client import SentryClient
                    sentry_config = await IntegrationConfigService(self.db_session).get_config(organization_id, 'sentry')
                    if sentry_config and sentry_config.secret:
                        extra = sentry_config.extra_config or {}
                        org_slug = str(extra.get('organization_slug') or '').strip()
                        if org_slug:
                            parts = task.external_id.split(':', 1)
                            issue_id = parts[1] if len(parts) > 1 else parts[0]
                            sentry_cfg = {'api_token': sentry_config.secret, 'base_url': sentry_config.base_url or 'https://sentry.io/api/0'}
                            comment = f'🤖 **Agena** created a PR to fix this issue:\n\n**[PR #{task.id}: {task.title}]({pr_url})**\n\nBranch: `{branch_name}`'
                            await SentryClient().add_issue_comment(sentry_cfg, organization_slug=org_slug, issue_id=issue_id, text=comment)
                            logger.info('Posted Sentry comment on issue %s for task #%s', issue_id, task.id)
                except Exception as exc:
                    logger.warning('Failed to post Sentry comment for task #%s: %s', task.id, exc)

            # Apply configurable AI tag/label on source work item (Azure) or issue (Jira)
            if task.source in ('azure', 'jira') and task.external_id:
                try:
                    provider = 'azure' if task.source == 'azure' else 'jira'
                    source_config = await IntegrationConfigService(self.db_session).get_config(organization_id, provider)
                    if source_config:
                        extra = source_config.extra_config or {}
                        if bool(extra.get('ai_tag_enabled')):
                            tag_name = str(extra.get('ai_tag_name') or 'ai-agena').strip()
                            if tag_name:
                                if task.source == 'azure':
                                    from agena_services.integrations.azure_client import AzureDevOpsClient
                                    az_cfg = {'org_url': source_config.base_url or '', 'pat': source_config.secret or ''}
                                    await AzureDevOpsClient().add_tag_to_work_item(
                                        cfg=az_cfg, work_item_id=task.external_id, tag=tag_name,
                                    )
                                else:
                                    from agena_services.integrations.jira_client import JiraClient
                                    jr_cfg = {
                                        'base_url': source_config.base_url or '',
                                        'email': source_config.username or '',
                                        'api_token': source_config.secret or '',
                                    }
                                    await JiraClient().add_label_to_issue(
                                        cfg=jr_cfg, issue_key=task.external_id, label=tag_name,
                                    )
                                logger.info('Applied AI tag "%s" on %s %s for task #%s',
                                            tag_name, task.source, task.external_id, task.id)
                except Exception as exc:
                    logger.warning('Failed to apply AI tag for task #%s: %s', task.id, exc)

            await usage_service.increment_tokens(organization_id, int(usage.get('total_tokens', 0)))
            run_finished_at = datetime.utcnow()
            duration_sec = round(time.perf_counter() - run_started_clock, 2)
            provider_name, model_name = self._extract_provider_model(state)
            await usage_event_service.create_event(
                organization_id=organization_id,
                user_id=task.created_by_user_id,
                task_id=task.id,
                operation_type='task_orchestration_run',
                provider=provider_name,
                model=model_name,
                status='completed',
                prompt_tokens=int(usage.get('prompt_tokens', 0)),
                completion_tokens=int(usage.get('completion_tokens', 0)),
                total_tokens=int(usage.get('total_tokens', 0)),
                cost_usd=float(estimated_cost),
                started_at=run_started_at,
                ended_at=run_finished_at,
                duration_ms=int(duration_sec * 1000),
                local_repo_path=routing.local_repo_path,
                details_json={
                    'source': routing.effective_source,
                    'external_source': routing.external_source,
                    'create_pr': create_pr,
                    'pr_url': pr_url,
                    'branch_name': branch_name,
                    'model_usage': state.get('model_usage', []),
                    'spec_goal': str(state.get('spec', {}).get('goal', ''))[:200],
                    'generated_code_len': len(state.get('generated_code', '')),
                    'final_code_len': len(state.get('final_code', '')),
                    'files_count': len(self._parse_reviewed_output_to_files(state.get('final_code', ''))),
                },
            )
            await task_service.add_log(
                task.id,
                organization_id,
                'run_metrics',
                self._build_run_metrics_message(
                    started_at=run_started_at,
                    finished_at=run_finished_at,
                    duration_sec=duration_sec,
                    usage=usage,
                ),
            )
            await task_service.add_log(task.id, organization_id, 'completed', 'Task completed successfully')

            # Cleanup worktree if Claude CLI created one
            if hasattr(self, 'claude_cli_service') and routing.local_repo_path:
                self.claude_cli_service.cleanup_worktree(routing.local_repo_path)

            notified = await notification_service.notify_task_result(
                organization_id=organization_id,
                user_id=task.created_by_user_id,
                task_id=task.id,
                task_title=task.title,
                status='completed',
                pr_url=pr_url,
            )
            if notified:
                await task_service.add_log(task.id, organization_id, 'notify', 'Completion email sent')

            return AgentRunResult(
                task_id=str(task.id),
                spec=state.get('spec', {}),
                generated_code=state.get('generated_code', ''),
                reviewed_code=final_code,
                usage=UsageStats(**usage),
                pr_url=pr_url,
            )
        except Exception as exc:
            task.status = 'failed'
            task.failure_reason = str(exc)
            await self.db_session.commit()

            publish_fire_and_forget(organization_id, 'task_status', {
                'task_id': task.id, 'status': 'failed', 'title': task.title,
            })

            usage = state.get('usage', {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0})
            run_finished_at = datetime.utcnow()
            duration_sec = round(time.perf_counter() - run_started_clock, 2)
            provider_name, model_name = self._extract_provider_model(state)
            estimated_cost = self.cost_tracker.estimate_cost_usd(
                prompt_tokens=int(usage.get('prompt_tokens', 0)),
                completion_tokens=int(usage.get('completion_tokens', 0)),
                model=model_name or provider_name or 'gpt-4o-mini',
            )
            await usage_event_service.create_event(
                organization_id=organization_id,
                user_id=task.created_by_user_id,
                task_id=task.id,
                operation_type='task_orchestration_run',
                provider=provider_name,
                model=model_name,
                status='failed',
                prompt_tokens=int(usage.get('prompt_tokens', 0)),
                completion_tokens=int(usage.get('completion_tokens', 0)),
                total_tokens=int(usage.get('total_tokens', 0)),
                cost_usd=float(estimated_cost),
                started_at=run_started_at,
                ended_at=run_finished_at,
                duration_ms=int(duration_sec * 1000),
                local_repo_path=routing.local_repo_path,
                error_message=str(exc)[:800],
                details_json={
                    'source': routing.effective_source,
                    'external_source': routing.external_source,
                    'create_pr': create_pr,
                },
            )
            await task_service.add_log(
                task.id,
                organization_id,
                'run_metrics',
                self._build_run_metrics_message(
                    started_at=run_started_at,
                    finished_at=run_finished_at,
                    duration_sec=duration_sec,
                    usage=usage,
                ),
            )
            await task_service.add_log(task.id, organization_id, 'failed', str(exc))
            notified = await notification_service.notify_task_result(
                organization_id=organization_id,
                user_id=task.created_by_user_id,
                task_id=task.id,
                task_title=task.title,
                status='failed',
                pr_url=task.pr_url,
                failure_reason=str(exc),
            )
            if notified:
                await task_service.add_log(task.id, organization_id, 'notify', 'Failure email sent')
            raise

    async def _build_pr_payload(self, task: dict[str, Any], reviewed_code: str, local_repo_path: str | None = None) -> CreatePRRequest:
        # Build branch name from pattern (user configurable via profile settings)
        title = str(task.get('title', '') or '')
        desc = str(task.get('description', '') or '')

        # Prefer explicitly-linked Azure work item ID (mirror created on import)
        linked_wi = str(task.get('external_work_item_id') or '').strip()
        if linked_wi:
            ext_id = linked_wi
        else:
            # Extract external ID number only (e.g. "Azure #61717" → "61717")
            ext_match = re.search(r'(?:Azure|Jira|GitHub)\s*#(\d+)', f'{title} {desc}')
            ext_id = ext_match.group(1) if ext_match else str(task.get('id', 'task'))

        # Create slug from title (remove [Azure #xxx] prefix, slugify)
        clean_title = re.sub(r'\[.*?#\d+\]\s*', '', title).strip()
        title_slug = re.sub(r'[^a-zA-Z0-9]+', '-', clean_title).strip('-').lower()[:50]

        timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
        task_id = str(task.get('id', 'task'))

        # Read branch pattern from user profile settings
        branch_pattern = 'feature/{ext_id}-{title_slug}'  # default
        try:
            user_id = task.get('created_by_user_id')
            if user_id and self.db_session:
                from agena_models.models.user_preference import UserPreference
                pref_result = await self.db_session.execute(
                    select(UserPreference).where(UserPreference.user_id == user_id)
                )
                pref = pref_result.scalar_one_or_none()
                if pref and pref.profile_settings_json:
                    ps = json.loads(pref.profile_settings_json)
                    custom_pattern = str(ps.get('branch_prefix', '') or '').strip()
                    if custom_pattern:
                        branch_pattern = custom_pattern
        except Exception:
            pass

        # Replace placeholders
        branch_name = branch_pattern.replace('{ext_id}', ext_id).replace('{title_slug}', title_slug).replace('{id}', task_id).replace('{timestamp}', timestamp)
        # Sanitize branch name. Azure git refs reject '#' (used in their
        # refs URL format) and a few other characters Git itself forbids
        # (~^:?*[\\). Keep only alnum + /_.- and squash everything else
        # down to a single '-'. Then strip leading/trailing dashes and
        # collapse runs of dashes so we don't end up with "feature/--foo".
        branch_name = re.sub(r'[^a-zA-Z0-9/_.-]+', '-', branch_name)
        branch_name = re.sub(r'-+', '-', branch_name).strip('-')

        auth_error = self._extract_cli_auth_error(reviewed_code)
        if auth_error:
            raise RuntimeError(
                f'{auth_error}. Reconnect CLI authentication from Integrations > CLI Agents and retry.'
            )

        parsed_files = self._parse_reviewed_output_to_files(reviewed_code, local_repo_path=local_repo_path)
        if not parsed_files and local_repo_path:
            # CLI agents (Claude/Codex) may edit files directly and return a summary
            # instead of structured file blocks — fall back to git diff
            # Use worktree path if available (Claude CLI creates worktrees per task)
            _wt_path = getattr(self.claude_cli_service, 'last_effective_path', None) if hasattr(self, 'claude_cli_service') else None
            _diff_path = _wt_path or local_repo_path
            logger.info(f'No file blocks parsed from output, falling back to git diff at {_diff_path}')
            parsed_files = await self._collect_git_changes(_diff_path)
        if not parsed_files:
            logger.error(f'No file blocks parsed. Output length: {len(reviewed_code)} chars. First 2000 chars:\n{reviewed_code[:2000]}')
            raise RuntimeError(
                'Model output did not contain structured file blocks (**File: path** + fenced code). '
                'Task cannot be applied safely to repository files.'
            )

        return CreatePRRequest(
            branch_name=branch_name,
            title=f"[AI] {task.get('title', 'Generated Task')}",
            body=(
                'Automated PR generated by AI orchestration pipeline.\n\n'
                f"Source: {task.get('source', 'unknown')}\n"
                f"Task ID: {task.get('id', '')}"
            ),
            base_branch=self.settings.github_default_base_branch,
            commit_message=f"feat(ai): implement task {task.get('id', '')}",
            files=parsed_files,
        )

    def _extract_cli_auth_error(self, text: str) -> str | None:
        low = (text or '').lower()
        if not low:
            return None
        if 'invalid authentication credentials' in low or 'authentication_error' in low:
            return 'CLI authentication failed: invalid authentication credentials'
        if 'failed to authenticate' in low:
            return 'CLI authentication failed'
        if 'api key invalid' in low or 'unauthorized' in low:
            return 'CLI authentication failed: unauthorized'
        return None

    def _with_strict_file_block_format(self, description: str) -> str:
        return (
            f"{description.rstrip()}\n\n"
            "OUTPUT FORMAT (STRICT, REQUIRED):\n"
            "Return ONLY file blocks, no extra commentary.\n"
            "Each change MUST use exactly this structure:\n"
            "**File: relative/path.ext**\n"
            "```language\n"
            "<full final file content>\n"
            "```\n"
        )

    async def _collect_git_changes(self, local_repo_path: str) -> list[GitHubFileChange]:
        """Collect modified/added files from git working tree (unstaged changes)."""
        import subprocess
        repo = Path(local_repo_path).expanduser().resolve()
        if not repo.is_dir():
            return []
        try:
            # Set safe.directory to avoid "dubious ownership" errors in Docker
            git_env = {**__import__('os').environ, 'GIT_CONFIG_COUNT': '1', 'GIT_CONFIG_KEY_0': 'safe.directory', 'GIT_CONFIG_VALUE_0': str(repo)}
            # Get list of changed and untracked files.
            # Large repos (e.g. FLO webservice) can take >15s on cold cache; 120s is safe.
            diff_result = subprocess.run(
                ['git', 'diff', '--name-only'],
                cwd=str(repo), capture_output=True, text=True, timeout=120, env=git_env,
            )
            untracked_result = subprocess.run(
                ['git', 'ls-files', '--others', '--exclude-standard'],
                cwd=str(repo), capture_output=True, text=True, timeout=120, env=git_env,
            )
            changed = set(diff_result.stdout.strip().splitlines()) if diff_result.stdout.strip() else set()
            untracked = set(untracked_result.stdout.strip().splitlines()) if untracked_result.stdout.strip() else set()
            all_files = changed | untracked
            # Extra safety net: if diff returned empty (e.g. still timing out on cold repo),
            # fall back to `git status --porcelain` which is cheaper and also picks up modified files.
            if not all_files:
                status_result = subprocess.run(
                    ['git', 'status', '--porcelain'],
                    cwd=str(repo), capture_output=True, text=True, timeout=60, env=git_env,
                )
                for line in status_result.stdout.splitlines():
                    # porcelain format: "XY path" where X/Y are single status chars
                    path = line[3:].strip() if len(line) > 3 else ''
                    if path:
                        all_files.add(path)
        except Exception as exc:
            logger.warning(f'git diff failed at {repo}: {exc}')
            return []

        files: list[GitHubFileChange] = []
        for rel in sorted(all_files):
            rel = rel.strip()
            if not rel or rel.startswith('.') or '/..' in f'/{rel}':
                continue
            full = repo / rel
            if not full.is_file():
                continue
            try:
                content = full.read_text(errors='replace')
            except Exception:
                continue
            files.append(GitHubFileChange(path=rel, content=content.rstrip() + '\n'))
        logger.info(f'Collected {len(files)} file(s) from git working tree: {[f.path for f in files]}')
        return files

    def _parse_reviewed_output_to_files(self, reviewed_code: str, local_repo_path: str | None = None) -> list[GitHubFileChange]:
        # Try multiple patterns — with and without fenced code blocks
        patterns = [
            # **File: path** + ```code```
            re.compile(r'\*{0,2}File:\s*(.*?)\*{0,2}\s*\r?\n```[^\n]*\r?\n(.*?)```', re.DOTALL),
            # **`path`** + ```code``` (Claude CLI summary style)
            re.compile(r'\*{0,2}`([^`\n]+\.[a-zA-Z]{1,10})`\*{0,2}\s*\r?\n```[^\n]*\r?\n(.*?)```', re.DOTALL),
            # File: path + @@...*** End Patch (no fenced code blocks)
            re.compile(r'\*{0,2}File:\s*([^\n*]+?)\*{0,2}\s*\r?\n\s*(@@.*?(?:\*\*\* End Patch|\Z))', re.DOTALL),
            # ### File: path + ```code```
            re.compile(r'#+\s*(?:File:?\s*)?`?([^\n`]+)`?\r?\n```[^\n]*\r?\n(.*?)```', re.DOTALL),
            # `path.ext`: + ```code```
            re.compile(r'`([^`\n]+\.[a-zA-Z]{1,10})`\s*:?\r?\n```[^\n]*\r?\n(.*?)```', re.DOTALL),
            # Fallback: any line with a file path ending in known extension + next fenced block
            re.compile(r'(?:^|\n)\s*\*{0,2}([\w/._-]+\.(?:go|py|ts|tsx|js|jsx|java|rs|rb|cs))\s*\*{0,2}\s*\r?\n```[^\n]*\r?\n(.*?)```', re.DOTALL),
            # File: path + raw block (no fenced code), until next File: marker
            re.compile(r'(?:^|\n)\s*\*{0,2}File:\s*([^\n*`]+?)\*{0,2}\s*\r?\n(.*?)(?=(?:\n\s*\*{0,2}File:\s*[^\n]+)|\Z)', re.DOTALL),
        ]
        matches: list[tuple[str, str]] = []
        for pat in patterns:
            matches = pat.findall(reviewed_code)
            if matches:
                break
        logger.info(f'Parsed {len(matches)} file block(s): {[m[0].strip() for m in matches]}')
        files: list[GitHubFileChange] = []
        for path_raw, content in matches:
            clean_path = path_raw.strip().strip('`').strip()
            if not clean_path:
                continue
            normalized = clean_path.replace('\\', '/')
            if normalized.startswith('/'):
                continue
            if re.match(r'^[A-Za-z]:/', normalized):
                continue
            if '/..' in f'/{normalized}' or normalized.startswith('..'):
                continue
            if not _is_valid_file_path(normalized):
                logger.warning('Skipping file with invalid path characters: %r', clean_path)
                continue

            body = content.strip()
            fenced_match = re.match(r'^```[^\n]*\n(.*?)\n```$', body, re.DOTALL)
            if fenced_match:
                body = fenced_match.group(1)
            final_content = body.rstrip() + '\n'

            # Detect patch format (@@ sections with +/- lines and *** End Patch)
            is_patch = bool(re.search(r'^@@(?:\s|$)', final_content, re.MULTILINE)) and (
                bool(re.search(r'^\+', final_content, re.MULTILINE)) or
                bool(re.search(r'^-', final_content, re.MULTILINE))
            )
            if is_patch and local_repo_path:
                applied = self._apply_patch(local_repo_path, clean_path, final_content)
                if applied:
                    final_content = applied
                else:
                    # Patch apply failed — skip this file but log it
                    logger.warning(f'Patch apply failed for {clean_path}, skipping')
                    continue

            # Detect partial output (contains "unchanged" markers)
            elif not is_patch:
                is_partial = bool(re.search(r'//\s*\.{2,}\s*\(?unchanged', final_content, re.IGNORECASE))
                if is_partial and local_repo_path:
                    merged = self._merge_partial_output(local_repo_path, clean_path, final_content)
                    if merged:
                        final_content = merged

            # Safety: refuse to overwrite an existing file with a suspiciously tiny body.
            # Codex/CLI sometimes returns just a single method or snippet inside a file
            # block, which would otherwise blow away the entire file content.
            if local_repo_path and not is_patch:
                try:
                    from pathlib import Path as _P
                    full = (_P(local_repo_path) / clean_path).expanduser().resolve()
                    root = _P(local_repo_path).expanduser().resolve()
                    if full.exists() and full.is_file() and str(full).startswith(str(root)):
                        existing = full.read_text(encoding='utf-8', errors='ignore')
                        ex_lines = existing.count('\n') + 1
                        new_lines = final_content.count('\n') + 1
                        # Threshold: existing is substantial and new is <40% of it
                        if ex_lines >= 30 and new_lines < max(10, ex_lines * 0.4):
                            logger.warning(
                                'Refusing to apply tiny replacement for %s: existing=%d lines, new=%d lines — likely a partial fragment',
                                clean_path, ex_lines, new_lines,
                            )
                            continue
                except Exception:
                    pass

            files.append(GitHubFileChange(path=clean_path, content=final_content))
        return files

    def _merge_partial_output(self, local_repo_path: str, rel_path: str, partial: str) -> str | None:
        """Merge partial AI output with existing file by replacing changed functions."""
        try:
            original_path = Path(local_repo_path).expanduser().resolve() / rel_path
            if not original_path.is_file():
                return None
            original = original_path.read_text(errors='replace')

            # Extract function/method signatures from partial output
            # Find blocks between "unchanged" markers — these are the actual changes
            lines = partial.splitlines()
            change_blocks: list[str] = []
            current_block: list[str] = []
            in_unchanged = False

            for line in lines:
                if re.search(r'//\s*\.{2,}\s*\(?unchanged', line, re.IGNORECASE):
                    if current_block:
                        block_text = '\n'.join(current_block).strip()
                        if block_text:
                            change_blocks.append(block_text)
                        current_block = []
                    in_unchanged = True
                    continue
                in_unchanged = False
                current_block.append(line)

            if current_block:
                block_text = '\n'.join(current_block).strip()
                if block_text:
                    change_blocks.append(block_text)

            if not change_blocks:
                return None

            # For each change block, try to find the corresponding function in original
            # and replace it
            result = original
            for block in change_blocks:
                # Find function signature in block
                func_match = re.search(r'^func\s+(\([^)]+\)\s+)?(\w+)\s*\(', block, re.MULTILINE)
                if not func_match:
                    # Try struct/type definition
                    type_match = re.search(r'^type\s+(\w+)\s+struct\s*\{', block, re.MULTILINE)
                    if type_match:
                        type_name = type_match.group(1)
                        # Find and replace the type block in original
                        type_pattern = re.compile(
                            rf'^type\s+{re.escape(type_name)}\s+struct\s*\{{.*?^\}}',
                            re.MULTILINE | re.DOTALL,
                        )
                        if type_pattern.search(result):
                            result = type_pattern.sub(block, result, count=1)
                    continue

                func_name = func_match.group(2)
                receiver = func_match.group(1) or ''

                # Build pattern to find the full function in original
                if receiver:
                    recv_type = re.search(r'\*?(\w+)', receiver)
                    recv_name = recv_type.group(1) if recv_type else ''
                    func_pattern = re.compile(
                        rf'^func\s+\([^)]*\*?{re.escape(recv_name)}[^)]*\)\s+{re.escape(func_name)}\s*\(.*?(?=\n^func\s|\n^type\s|\n^var\s|\Z)',
                        re.MULTILINE | re.DOTALL,
                    )
                else:
                    func_pattern = re.compile(
                        rf'^func\s+{re.escape(func_name)}\s*\(.*?(?=\n^func\s|\n^type\s|\n^var\s|\Z)',
                        re.MULTILINE | re.DOTALL,
                    )

                if func_pattern.search(result):
                    result = func_pattern.sub(block, result, count=1)

            return result if result != original else None
        except Exception:
            return None

    def _apply_patch(self, local_repo_path: str, rel_path: str, patch_content: str) -> str | None:
        """Apply a patch-style output (@@ context +additions -deletions) to the original file.

        Strategy: Extract ALL context lines from each hunk and find the UNIQUE
        position in the file where they all match consecutively. This prevents
        matching the wrong location when the same line appears in multiple functions.
        Only additions (+) are inserted; deletions (-) are applied; context ( ) is kept.
        """
        try:
            original_path = Path(local_repo_path).expanduser().resolve() / rel_path
            if not original_path.is_file():
                return None
            original = original_path.read_text(errors='replace')
            original_lines = original.splitlines()

            # Parse patch into hunks
            hunks: list[list[str]] = []
            current_hunk: list[str] = []
            for line in patch_content.splitlines():
                stripped = line.strip()
                if stripped.startswith('@@'):
                    if current_hunk:
                        hunks.append(current_hunk)
                    current_hunk = []
                    continue
                if stripped == '*** End Patch':
                    if current_hunk:
                        hunks.append(current_hunk)
                    current_hunk = []
                    continue
                current_hunk.append(line)
            if current_hunk:
                hunks.append(current_hunk)

            if not hunks:
                return None

            result_lines = list(original_lines)
            # Apply hunks in reverse order so line numbers stay correct
            applied_hunks: list[tuple[int, int, list[str]]] = []

            for hunk in hunks:
                # Separate context+deletion lines (what's in the original) from additions
                # Context lines start with ' ', deletions with '-', additions with '+'
                orig_sequence: list[str] = []  # lines that should exist in original (context + deletions)
                for hl in hunk:
                    if hl.startswith(' '):
                        orig_sequence.append(hl[1:])
                    elif hl.startswith('-'):
                        orig_sequence.append(hl[1:])
                    # '+' lines are NOT in original

                if not orig_sequence:
                    continue

                # Find the unique position where orig_sequence lines match consecutively.
                # First try exact match, then fall back to fuzzy (allow up to 20% mismatched lines).
                def _find_match(lines: list[str], seq: list[str], max_mismatch: int = 0) -> tuple[int, int]:
                    best_start = -1
                    count = 0
                    for i in range(len(lines) - len(seq) + 1):
                        mismatches = 0
                        for j, expected in enumerate(seq):
                            orig_norm = lines[i + j].rstrip()
                            exp_norm = expected.rstrip()
                            if orig_norm != exp_norm and orig_norm.strip() != exp_norm.strip():
                                mismatches += 1
                                if mismatches > max_mismatch:
                                    break
                        else:
                            best_start = i
                            count += 1
                            if count > 1:
                                break
                    return best_start, count

                match_start, candidates = _find_match(result_lines, orig_sequence, 0)
                if match_start == -1:
                    # Fuzzy: allow up to 20% of lines to mismatch
                    allowed = max(1, len(orig_sequence) // 5)
                    match_start, candidates = _find_match(result_lines, orig_sequence, allowed)
                    if match_start != -1:
                        logger.info(f'Patch: fuzzy match for hunk in {rel_path} (allowed {allowed} mismatches)')

                if match_start == -1:
                    logger.warning(f'Patch: no context match for hunk in {rel_path}, skipping hunk')
                    continue

                if candidates > 1:
                    logger.warning(f'Patch: {candidates} matches for hunk in {rel_path}, using first')

                # Build replacement: walk hunk lines, keep context, add additions, skip deletions
                new_section: list[str] = []
                for hl in hunk:
                    if hl.startswith('+'):
                        new_section.append(hl[1:])  # add new line
                    elif hl.startswith('-'):
                        pass  # skip deleted line (it's in orig_sequence, will be replaced)
                    elif hl.startswith(' '):
                        new_section.append(hl[1:])  # keep context line as-is
                    # ignore lines without prefix (shouldn't happen)

                applied_hunks.append((match_start, match_start + len(orig_sequence), new_section))

            # Apply hunks from bottom to top so earlier positions aren't shifted
            applied_hunks.sort(key=lambda x: x[0], reverse=True)
            for start, end, replacement in applied_hunks:
                result_lines[start:end] = replacement

            result = '\n'.join(result_lines)
            if not result.endswith('\n'):
                result += '\n'
            return result if result != original else None
        except Exception:
            logger.exception(f'Failed to apply patch to {rel_path}')
            return None

    def _build_planner_context(
        self, index_md: str, pkg_dir: str, title: str, description: str,
        loaded_pkgs: list[str],
    ) -> str:
        """Build planner context: index with compact signatures.

        The index now contains compact signatures (struct/func names per file,
        no field bodies) which is enough for the planner to pick the right files.
        """
        loaded_pkgs.append('(compact index)')
        return index_md

    def _trim_agents_md(self, agents_md: str, title: str, description: str) -> str:
        """Trim agents.md to reduce token usage by keeping only relevant Code Signatures.

        Keeps: Overview, Dependencies, File Tree, Source Files (small sections).
        Trims: Code Signatures — only keeps sections whose file path matches keywords
        extracted from the task title and description.
        """
        if len(agents_md) < 80_000:  # small enough, don't bother trimming
            return agents_md

        # Extract keywords from title + description (3+ char words, lowercased)
        text = f'{title} {description}'.lower()
        keywords = set(w for w in re.findall(r'[a-z_]{3,}', text) if w not in {
            'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'not',
            'but', 'have', 'has', 'been', 'will', 'should', 'would', 'could', 'can',
            'bir', 'ile', 'olan', 'icin', 'gibi', 'daha', 'var', 'yok', 'hem',
            'task', 'azure', 'jira', 'local', 'repo', 'path', 'status',
        })

        lines = agents_md.splitlines()
        result: list[str] = []
        in_signatures = False
        current_section: list[str] = []
        current_file = ''
        kept_sections = 0
        skipped_sections = 0

        for line in lines:
            if line.startswith('## Code Signatures'):
                in_signatures = True
                result.append(line)
                continue

            if not in_signatures:
                result.append(line)
                continue

            # New file section within Code Signatures
            if line.startswith('### `'):
                # Flush previous section
                if current_section:
                    file_lower = current_file.lower()
                    if any(kw in file_lower for kw in keywords):
                        result.extend(current_section)
                        kept_sections += 1
                    else:
                        skipped_sections += 1
                current_section = [line]
                current_file = line.strip('# `').strip()
                continue

            # New top-level section (end of Code Signatures)
            if line.startswith('## ') and in_signatures:
                # Flush last section
                if current_section:
                    file_lower = current_file.lower()
                    if any(kw in file_lower for kw in keywords):
                        result.extend(current_section)
                        kept_sections += 1
                    else:
                        skipped_sections += 1
                in_signatures = False
                result.append(f'\n> ({skipped_sections} file sections omitted — not matching task keywords)')
                result.append('')
                result.append(line)
                continue

            current_section.append(line)

        # Flush remaining
        if current_section and in_signatures:
            file_lower = current_file.lower()
            if any(kw in file_lower for kw in keywords):
                result.extend(current_section)
                kept_sections += 1
            else:
                skipped_sections += 1
            if skipped_sections:
                result.append(f'\n> ({skipped_sections} file sections omitted — not matching task keywords)')

        logger.info(f'Trimmed agents.md: kept {kept_sections} / {kept_sections + skipped_sections} signature sections, keywords={keywords}')
        return '\n'.join(result)

    async def _resolve_repo_mapping(self, task: TaskRecord, *, assignment_id: int | None = None) -> 'RepoMapping | None':
        """Load the RepoMapping linked to this task or assignment."""
        from agena_models.models.repo_mapping import RepoMapping

        # Multi-repo: resolve from assignment
        if assignment_id:
            from agena_models.models.task_repo_assignment import TaskRepoAssignment
            assignment = await self.db_session.get(TaskRepoAssignment, assignment_id)
            if assignment and assignment.repo_mapping_id:
                mapping = await self.db_session.get(RepoMapping, assignment.repo_mapping_id)
                if mapping and mapping.organization_id == task.organization_id and mapping.is_active:
                    return mapping

        # Single-repo: resolve from task
        mapping_id = getattr(task, 'repo_mapping_id', None)
        if not mapping_id:
            return None
        mapping = await self.db_session.get(RepoMapping, mapping_id)
        if mapping and mapping.organization_id == task.organization_id and mapping.is_active:
            return mapping
        return None

    def _extract_task_routing(self, task: TaskRecord, repo_mapping: 'RepoMapping | None' = None) -> TaskRouting:
        meta: dict[str, str] = {}
        for raw in (task.description or '').splitlines():
            if ':' not in raw:
                continue
            key, value = raw.split(':', 1)
            meta[key.strip().lower()] = value.strip()

        external_source = meta.get('external source')
        effective_source = task.source
        if external_source and external_source.lower().startswith('azure'):
            effective_source = 'azure'
        elif external_source and external_source.lower().startswith('jira'):
            effective_source = 'jira'
        # If Azure repository metadata exists, route PR flow to Azure even for Jira-imported tasks.
        if meta.get('azure repo'):
            effective_source = 'azure'

        # Extract project from Azure Repo URL if available (more reliable than sprint project)
        azure_repo_url = meta.get('azure repo') or None
        azure_project = meta.get('project') or None
        if azure_repo_url and '/_git/' in azure_repo_url:
            # URL like: https://...dev.azure.com/Org/Project/_git/repo
            try:
                from urllib.parse import urlparse
                path = urlparse(azure_repo_url).path.strip('/')
                # path = "Org/Project/_git/repo" or "Project/_git/repo"
                git_idx = path.index('/_git/')
                before_git = path[:git_idx]
                azure_project = before_git.split('/')[-1]
            except Exception:
                pass

        remote_repo = meta.get('remote repo') or None
        # Fallback: detect bare "azure:project/repo" or "github:owner/repo" lines
        if not remote_repo:
            for raw_line in (task.description or '').splitlines():
                stripped = raw_line.strip()
                if stripped.startswith('azure:') and '/' in stripped and not stripped.startswith('azure: '):
                    remote_repo = stripped
                    break
                if stripped.startswith('github:') and '/' in stripped and not stripped.startswith('github: '):
                    remote_repo = stripped
                    break
        # If remote repo is set, ignore local repo path (remote takes priority)
        local_repo_path = meta.get('local repo path') or None
        if remote_repo:
            local_repo_path = None

        # Override routing from RepoMapping if linked
        repo_playbook = meta.get('repo playbook') or None
        if repo_mapping:
            if repo_mapping.provider == 'github':
                remote_repo = f"github:{repo_mapping.owner}/{repo_mapping.repo_name}"
                effective_source = 'github'
            elif repo_mapping.provider == 'azure':
                effective_source = 'azure'
                azure_project = repo_mapping.owner
            if repo_mapping.local_repo_path:
                local_repo_path = repo_mapping.local_repo_path
                remote_repo = None
            if repo_mapping.playbook:
                repo_playbook = repo_mapping.playbook

        return TaskRouting(
            effective_source=effective_source,
            external_source=external_source,
            azure_project=azure_project,
            azure_repo_url=azure_repo_url,
            local_repo_mapping=meta.get('local repo mapping') or None,
            local_repo_path=local_repo_path,
            repo_playbook=repo_playbook,
            preferred_agent=meta.get('preferred agent') or None,
            preferred_agent_provider=meta.get('preferred agent provider') or None,
            preferred_agent_model=meta.get('preferred agent model') or None,
            execution_prompt=meta.get('execution prompt') or None,
            remote_repo=remote_repo,
        )

    async def _auto_queue_dependents(
        self,
        organization_id: int,
        completed_task_id: int,
        task_service: 'TaskService',
        create_pr: bool,
        mode: str,
    ) -> None:
        """When a task completes, auto-queue any dependent tasks whose blockers are now all done."""
        try:
            dependents = await task_service.get_dependents(organization_id, completed_task_id)
            if not dependents:
                return

            from agena_services.services.queue_service import QueueService
            queue = QueueService()

            for dep_task_id in dependents:
                dep_task = await task_service.get_task(organization_id, dep_task_id)
                if not dep_task or dep_task.status not in ('new', 'queued', 'failed'):
                    continue

                blockers = await task_service.get_dependency_blockers(organization_id, dep_task_id)
                if blockers:
                    continue  # still has unfinished dependencies

                # All dependencies completed — auto-queue this task
                dep_task.status = 'queued'
                dep_task.failure_reason = None
                await self.db_session.commit()

                await queue.enqueue({
                    'organization_id': organization_id,
                    'task_id': dep_task_id,
                    'create_pr': create_pr,
                    'mode': mode,
                })

                await task_service.add_log(
                    dep_task_id,
                    organization_id,
                    'queued',
                    f'Auto-queued: dependency #{completed_task_id} completed',
                )

                publish_fire_and_forget(organization_id, 'task_status', {
                    'task_id': dep_task_id, 'status': 'queued', 'title': dep_task.title,
                })

                logger.info('Auto-queued dependent task #%s (dependency #%s completed)', dep_task_id, completed_task_id)
        except Exception:
            logger.exception('Failed to auto-queue dependents for task #%s', completed_task_id)

    def _can_create_github_pr(self) -> bool:
        token = (self.settings.github_token or '').strip()
        owner = (self.settings.github_owner or '').strip()
        repo = (self.settings.github_repo or '').strip()
        if not token or not owner or not repo:
            return False
        if token.startswith('your_') or owner.startswith('your_') or repo.startswith('your_'):
            return False
        return True

    def _build_run_metrics_message(
        self,
        *,
        started_at: datetime,
        finished_at: datetime,
        duration_sec: float,
        usage: dict[str, int],
    ) -> str:
        return (
            f"StartedAt: {started_at.isoformat()}Z | "
            f"FinishedAt: {finished_at.isoformat()}Z | "
            f"DurationSec: {duration_sec:.2f} | "
            f"PromptTokens: {int(usage.get('prompt_tokens', 0))} | "
            f"CompletionTokens: {int(usage.get('completion_tokens', 0))} | "
            f"TotalTokens: {int(usage.get('total_tokens', 0))}"
        )

    def _build_code_preview_message(self, files: list[GitHubFileChange]) -> str:
        if not files:
            return 'No generated files to preview.'

        lines: list[str] = [f'Generated files ({len(files)}):']
        for file in files:
            snippet = file.content[:500].rstrip()
            lines.append(f'\nFile: {file.path}')
            lines.append('```')
            lines.append(snippet if snippet else '(empty)')
            lines.append('```')

        return '\n'.join(lines)

    def _build_code_diff_message(self, repo_path: str, files: list[GitHubFileChange]) -> str:
        if not files:
            return 'No generated files to diff.'

        root = Path(repo_path).expanduser().resolve()
        lines: list[str] = [f'Diff files ({len(files)}):']

        for file in files:
            rel = file.path.strip().replace('\\', '/')
            before = ''
            target = (root / rel).resolve()
            if str(target).startswith(str(root)) and target.exists():
                try:
                    before = target.read_text(encoding='utf-8')
                except Exception:
                    before = ''
            after = file.content or ''
            diff = list(
                difflib.unified_diff(
                    before.splitlines(),
                    after.splitlines(),
                    fromfile=f'a/{rel}',
                    tofile=f'b/{rel}',
                    lineterm='',
                    n=2,
                )
            )
            lines.append(f'\nFile: {rel}')
            lines.append('```diff')
            if diff:
                lines.extend(diff[:220])
            else:
                lines.append('(no visible diff)')
            lines.append('```')
        return '\n'.join(lines)

    def _build_memory_impact_message(self, state: dict[str, Any]) -> str:
        memory_context = state.get('memory_context') or []
        memory_status = state.get('memory_status') or {}
        mode = str(memory_status.get('embedding_mode') or 'unknown')
        hits = int(len(memory_context))
        scores: list[float] = []
        samples: list[dict[str, Any]] = []
        for row in memory_context[:5]:
            if not isinstance(row, dict):
                continue
            score_raw = row.get('_score')
            score_val: float | None = None
            if score_raw is not None:
                try:
                    score_val = float(score_raw)
                    scores.append(score_val)
                except Exception:
                    score_val = None
            input_preview = str(row.get('input') or '').strip()
            first_line = input_preview.splitlines()[0][:90] if input_preview else ''
            samples.append(
                {
                    'key': str(row.get('key') or ''),
                    'score': score_val,
                    'preview': first_line,
                }
            )

        best = max(scores) if scores else None
        avg = (sum(scores) / len(scores)) if scores else None
        payload = {
            'mode': mode,
            'hits': hits,
            'best_score': round(best, 6) if best is not None else None,
            'avg_score': round(avg, 6) if avg is not None else None,
            'top_matches': samples,
        }
        return f'MemoryImpactJSON: {json.dumps(payload, ensure_ascii=False)}'

    def _is_mock_run(self, state: dict[str, Any]) -> bool:
        model_usage = state.get('model_usage') or []
        return any(str(model).startswith('mock-local') for model in model_usage)

    def _extract_provider_model(self, state: dict[str, Any]) -> tuple[str, str | None]:
        model_usage = state.get('model_usage') or []
        last = str(model_usage[-1]) if model_usage else ''
        if ':' in last:
            provider, model = last.split(':', 1)
            return provider.strip() or 'unknown', model.strip() or None
        if last:
            return 'openai', last
        return 'unknown', None

    def _estimate_tokens(self, text: str) -> int:
        content = (text or '').strip()
        if not content:
            return 0
        # Rough approximation for display/usage in codex_cli mode where provider usage is unavailable.
        return max(1, (len(content) + 3) // 4)

    async def _load_tenant_playbook(self, organization_id: int) -> str | None:
        config = await IntegrationConfigService(self.db_session).get_config(organization_id, 'playbook')
        if config is None:
            return None
        content = (config.secret or '').strip()
        return content or None

    async def _build_orchestrator(self, organization_id: int, routing: TaskRouting) -> AgentOrchestrator:
        llm_runtime = await self._resolve_llm_runtime(organization_id, routing)
        memory_provider = None
        memory_api_key = None
        memory_base_url = None
        memory_model = None
        if llm_runtime is not None:
            memory_provider = llm_runtime.provider
            memory_api_key = llm_runtime.api_key
            memory_base_url = llm_runtime.base_url
            memory_model = llm_runtime.model

        if not (memory_api_key or '').strip():
            openai_key = (self.settings.openai_api_key or '').strip()
            if openai_key and not openai_key.startswith('your_'):
                memory_provider = 'openai'
                memory_api_key = openai_key
                memory_base_url = (self.settings.openai_base_url or '').strip()

        if llm_runtime is None:
            return AgentOrchestrator(
                db=self.db_session,
                memory_provider=memory_provider,
                memory_api_key=memory_api_key,
                memory_base_url=memory_base_url,
                memory_model=memory_model,
            )
        from agena_services.services.llm.provider import LLMProvider
        llm = LLMProvider(
            provider=llm_runtime.provider,
            api_key=llm_runtime.api_key,
            base_url=llm_runtime.base_url,
            small_model=llm_runtime.model,
            large_model=llm_runtime.model,
        )
        return AgentOrchestrator(
            llm_provider=llm,
            db=self.db_session,
            memory_provider=memory_provider,
            memory_api_key=memory_api_key,
            memory_base_url=memory_base_url,
            memory_model=memory_model,
        )

    async def _resolve_llm_runtime(self, organization_id: int, routing: TaskRouting) -> LLMRuntimeConfig | None:
        provider = (routing.preferred_agent_provider or '').strip().lower()
        preferred_model = (routing.preferred_agent_model or '').strip() or None
        # Normalize provider aliases
        if provider == 'google':
            provider = 'gemini'
        if provider not in {'openai', 'gemini', 'anthropic'}:
            provider = 'openai'

        cfg_service = IntegrationConfigService(self.db_session)
        # For anthropic, check anthropic integration first, then fall back to env
        cfg_provider = provider
        selected_cfg = await cfg_service.get_config(organization_id, cfg_provider)
        selected_key = ((selected_cfg.secret if selected_cfg else '') or '').strip()
        selected_base = ((selected_cfg.base_url if selected_cfg else '') or '').strip()

        # If preferred provider has no usable key, fallback to OpenAI integration/env.
        if not selected_key or selected_key.startswith('your_'):
            if provider != 'openai':
                openai_cfg = await cfg_service.get_config(organization_id, 'openai')
                openai_key = ((openai_cfg.secret if openai_cfg else '') or '').strip() or (self.settings.openai_api_key or '').strip()
                openai_base = ((openai_cfg.base_url if openai_cfg else '') or '').strip() or (self.settings.openai_base_url or '').strip()
                if openai_key and not openai_key.startswith('your_'):
                    return LLMRuntimeConfig(provider='openai', api_key=openai_key, base_url=openai_base, model=preferred_model)
            return None

        if provider == 'gemini':
            return LLMRuntimeConfig(
                provider='gemini',
                api_key=selected_key,
                base_url=selected_base or 'https://generativelanguage.googleapis.com',
                model=preferred_model,
            )
        if provider == 'anthropic':
            return LLMRuntimeConfig(
                provider='anthropic',
                api_key=selected_key,
                base_url=selected_base or 'https://api.anthropic.com',
                model=preferred_model,
            )
        return LLMRuntimeConfig(
            provider='openai',
            api_key=selected_key,
            base_url=selected_base or (self.settings.openai_base_url or 'https://api.openai.com/v1'),
            model=preferred_model,
        )

    async def _build_targeted_error_prompt(
        self,
        task,
        organization_id: int,
        local_repo_path: str | None,
    ) -> str | None:
        """For Sentry/NewRelic tasks, build a targeted prompt with the actual file content.

        Returns the filled prompt or None if not applicable.
        """
        if task.source not in ('sentry', 'newrelic'):
            return None
        if not local_repo_path:
            return None

        import re
        description = task.description or ''

        # Parse file path and line number from description
        file_path = None
        line_number = None

        # Sentry: "File: app/Controller/Api/V1/Customer.php" or metadata
        for pattern in [
            r'File:\s*(.+?\.\w+)',
            r'Function:\s*\S+\s+in\s+(.+?\.\w+)',
            r'Culprit:\s*(.+?\.\w+)',
            r'([\w/]+\.\w{2,5}):(\d+)',
        ]:
            m = re.search(pattern, description)
            if m:
                file_path = m.group(1).strip()
                if m.lastindex and m.lastindex >= 2:
                    line_number = m.group(2)
                break

        if not file_path:
            return None

        # Read file content from local repo
        from pathlib import Path
        full_path = Path(local_repo_path).expanduser().resolve() / file_path
        if not full_path.exists() or not full_path.is_file():
            logger.info('Targeted prompt: file not found %s', full_path)
            return None

        try:
            file_content = full_path.read_text(encoding='utf-8', errors='ignore')
            # Limit to ~500 lines around the error line for very large files
            if line_number:
                lines = file_content.splitlines()
                ln = int(line_number)
                start = max(0, ln - 250)
                end = min(len(lines), ln + 250)
                file_content = '\n'.join(lines[start:end])
        except Exception:
            return None

        # Load prompt template from Prompt Studio
        prompt_slug = 'SENTRY_FIX_PROMPT' if task.source == 'sentry' else 'NEWRELIC_FIX_PROMPT'
        try:
            from agena_services.services.prompt_service import PromptService
            template = await PromptService.get(self.db_session, prompt_slug)
        except ValueError:
            logger.info('Targeted prompt slug %s not found, falling back to default', prompt_slug)
            return None

        # Extract variables from description
        def _extract(key: str) -> str:
            m = re.search(rf'{key}:\s*(.+)', description)
            return m.group(1).strip() if m else ''

        # Fill template
        filled = template
        replacements = {
            '{{error_message}}': task.title or '',
            '{{file_path}}': file_path,
            '{{line_number}}': line_number or '',
            '{{file_content}}': file_content,
            '{{stack_trace}}': '',
            '{{level}}': _extract('Level'),
            '{{culprit}}': _extract('Culprit'),
            '{{event_count}}': _extract('Events'),
            '{{user_count}}': _extract('Affected Users'),
            '{{first_seen}}': _extract('First Seen'),
            '{{error_class}}': _extract('Exception'),
            '{{transaction}}': _extract('Transaction'),
            '{{entity_name}}': _extract('Entity'),
        }

        # Extract stack trace section
        st_match = re.search(r'Stack Trace.*?:\n((?:\s+- .+\n?)+)', description)
        if st_match:
            replacements['{{stack_trace}}'] = st_match.group(1).strip()

        for key, val in replacements.items():
            filled = filled.replace(key, val)

        logger.info('Built targeted %s prompt for %s:%s (%d chars file content)',
                     task.source, file_path, line_number or '?', len(file_content))
        return filled

    async def _prefetch_inline_images_to_disk(
        self,
        description: str | None,
        organization_id: int,
        task_id: int,
    ) -> list[dict]:
        """Download images embedded in the task description (Azure DevOps
        attachments, Jira inline `<img>`, plain markdown image links, etc.)
        and stash them under the same uploads tree as user attachments so
        local CLIs (Claude/Codex) can read them with the standard Read tool.

        Returns a list of dicts: {filename, path, content_type, size_bytes,
        source_url}. Uses a content-hash filename so re-runs reuse the
        same file instead of re-fetching.
        """
        urls = self._extract_task_image_urls(description)
        if not urls:
            return []
        import hashlib
        target_root = Path('/app/data/uploads/tasks') / str(organization_id) / str(task_id) / 'inline'
        target_root.mkdir(parents=True, exist_ok=True)
        azure_auth_header: str | None = None
        azure_auth_loaded = False
        saved: list[dict] = []
        for url in urls:
            normalized = (url or '').strip()
            if not normalized or normalized.startswith('data:'):
                continue
            try:
                headers: dict[str, str] = {}
                is_azure_attachment = (
                    'dev.azure.com/' in normalized or '/_apis/wit/attachments/' in normalized
                )
                if is_azure_attachment:
                    if not azure_auth_loaded:
                        azure_auth_loaded = True
                        azure_cfg = await IntegrationConfigService(self.db_session).get_config(organization_id, 'azure')
                        pat = (azure_cfg.secret or '').strip() if azure_cfg and azure_cfg.secret else ''
                        if pat:
                            token = base64.b64encode(f':{pat}'.encode()).decode()
                            azure_auth_header = f'Basic {token}'
                    if azure_auth_header:
                        headers['Authorization'] = azure_auth_header

                async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                    response = await client.get(normalized, headers=headers)
                    response.raise_for_status()
                content_type = str(response.headers.get('content-type', '')).split(';', 1)[0].strip().lower()
                if not content_type.startswith('image/'):
                    continue
                if len(response.content) > 5 * 1024 * 1024:
                    continue
                ext_map = {
                    'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
                    'image/webp': '.webp', 'image/svg+xml': '.svg',
                }
                ext = ext_map.get(content_type, '.bin')
                digest = hashlib.sha1(normalized.encode()).hexdigest()[:16]
                disk_path = target_root / f'{digest}{ext}'
                if not disk_path.is_file():
                    disk_path.write_bytes(response.content)
                # Build a friendly filename so prompts have context about origin.
                friendly = 'inline-image' + ext
                if 'fileName=' in normalized:
                    try:
                        from urllib.parse import urlparse, parse_qs
                        q = parse_qs(urlparse(normalized).query)
                        if q.get('fileName'):
                            friendly = q['fileName'][0]
                    except Exception:
                        pass
                saved.append({
                    'filename': friendly,
                    'path': str(disk_path),
                    'content_type': content_type,
                    'size_bytes': len(response.content),
                    'source_url': normalized,
                })
            except Exception as exc:
                logger.info('Inline image prefetch skipped (%s): %s', normalized[:120], exc)
        return saved

    async def _build_attachments_section(
        self,
        task_id: int,
        organization_id: int,
        description: str | None = None,
    ) -> str:
        """Render every TaskAttachment plus any description-embedded images
        we managed to prefetch as a prompt fragment so agents, local CLIs,
        and flow nodes all see the same thing.

        - Images and other binaries: list filename + content_type + size +
          host-resolved file path. Vision-capable LLMs and the local CLI
          can read the file off disk; non-vision agents at least learn
          the file exists.
        - Text-like blobs (text/*, JSON, XML, YAML, MD): inline the
          contents up to a per-file cap so the prompt is self-contained.
        Returns '' when the task has no attachments and no inline images.
        """
        rows = []
        if self.db_session is not None:
            try:
                from agena_models.models.task_attachment import TaskAttachment
                rows = (await self.db_session.execute(
                    select(TaskAttachment)
                    .where(
                        TaskAttachment.task_id == task_id,
                        TaskAttachment.organization_id == organization_id,
                    )
                    .order_by(TaskAttachment.id)
                )).scalars().all()
            except Exception as exc:
                logger.warning('Could not load attachments for task %s: %s', task_id, exc)

        # Pull description-embedded image URLs onto disk so CLIs can Read them.
        inline_items: list[dict] = []
        if description:
            try:
                inline_items = await self._prefetch_inline_images_to_disk(
                    description, organization_id, task_id,
                )
            except Exception as exc:
                logger.info('Inline image prefetch failed for task %s: %s', task_id, exc)

        if not rows and not inline_items:
            return ''

        host_root = (get_settings().attachment_host_root or '').rstrip('/')
        max_inline = 8 * 1024  # per-file inline budget for text content

        def _resolve_host_path(container_path: str) -> str:
            # Container paths look like /app/data/uploads/tasks/<org>/<task>/<file>.
            # Translate to the host-side path the local CLI / bridge can open.
            if host_root and container_path.startswith('/app/data/'):
                return host_root + container_path[len('/app/data'):]
            return container_path

        def _is_textual(ct: str) -> bool:
            ct = (ct or '').lower()
            if ct.startswith('text/'):
                return True
            return ct in {
                'application/json', 'application/xml', 'application/yaml',
                'application/x-yaml', 'application/javascript',
            }

        lines: list[str] = ['ATTACHMENTS:']
        for att in rows:
            host_path = _resolve_host_path(att.storage_path or '')
            size_kb = (att.size_bytes or 0) / 1024
            header = f'- {att.filename} ({att.content_type}, {size_kb:.1f} KB) — file: {host_path}'
            if _is_textual(att.content_type) and att.size_bytes and att.size_bytes <= max_inline * 4:
                try:
                    raw = Path(att.storage_path).read_text(errors='replace')
                except Exception:
                    raw = ''
                if raw:
                    truncated = raw[:max_inline]
                    suffix = '' if len(raw) <= max_inline else f'\n... (truncated, {len(raw) - max_inline} chars omitted)'
                    lines.append(header)
                    lines.append('  ```')
                    for ln in (truncated + suffix).splitlines():
                        lines.append(f'  {ln}')
                    lines.append('  ```')
                    continue
            if (att.content_type or '').lower().startswith('image/'):
                lines.append(header + '  [image — vision-capable models can open the file path above]')
            else:
                lines.append(header)

        # Description-embedded images that we prefetched to disk. Local CLIs
        # can open these directly with the Read tool; the original URL is
        # kept for traceability when the caller needs to reference it.
        for item in inline_items:
            host_path = _resolve_host_path(item['path'])
            size_kb = (item['size_bytes'] or 0) / 1024
            lines.append(
                f"- {item['filename']} ({item['content_type']}, {size_kb:.1f} KB) — file: {host_path}"
                f"  [inline image from task description; source: {item['source_url']}]"
            )

        return '\n'.join(lines)

    def _build_effective_description(
        self,
        base_description: str | None,
        execution_prompt: str | None,
        repo_playbook: str | None = None,
        tenant_playbook: str | None = None,
        repo_context: str | None = None,
        story_context: str | None = None,
        acceptance_criteria: str | None = None,
        edge_cases: str | None = None,
    ) -> str:
        desc = (base_description or '').strip()
        prompt = (execution_prompt or '').strip()
        repo_rules = (repo_playbook or '').strip()
        playbook = (tenant_playbook or '').strip()
        repo_ctx = (repo_context or '').strip()
        story = (story_context or '').strip()
        criteria = (acceptance_criteria or '').strip()
        edges = (edge_cases or '').strip()
        chunks: list[str] = []
        if desc:
            chunks.append(desc)
        if repo_ctx:
            chunks.append(f'Repo Context:\n{repo_ctx}')
        if story:
            chunks.append(f'Business Context:\n{story}')
        if criteria:
            chunks.append(f'Acceptance Criteria:\n{criteria}')
        if edges:
            chunks.append(f'Edge Cases:\n{edges}')
        if prompt:
            chunks.append(f'Execution Prompt:\n{prompt}')
        if repo_rules:
            chunks.append(f'Repo Playbook:\n{repo_rules}')
        if playbook:
            chunks.append(f'Tenant Playbook:\n{playbook}')
        return '\n\n'.join(chunks)

    def _get_git_info(self, root: Path) -> str:
        """Get current branch name and recent commit log from the local repo."""
        import subprocess
        parts: list[str] = []
        try:
            branch = subprocess.run(
                ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
                cwd=str(root), capture_output=True, text=True, timeout=5,
            )
            if branch.returncode == 0 and branch.stdout.strip():
                parts.append(f'Current Branch: {branch.stdout.strip()}')
        except Exception:
            pass
        try:
            log = subprocess.run(
                ['git', 'log', '--oneline', '-10'],
                cwd=str(root), capture_output=True, text=True, timeout=5,
            )
            if log.returncode == 0 and log.stdout.strip():
                parts.append(f'Recent Commits:\n{log.stdout.strip()}')
        except Exception:
            pass
        return '\n'.join(parts)

    def _resolve_repo_guide(self, root: Path | None) -> tuple[str, str, str]:
        if root is None or not root.is_dir():
            return '', '', ''

        for name in ['agents.md', 'AGENTS.md']:
            guide = root / name
            if not guide.is_file():
                continue
            try:
                return guide.read_text(errors='replace'), f'repo:{name}', ''
            except Exception as exc:
                logger.warning('Failed to read repo guide %s: %s', guide, exc)

        agena_dir = root / '.agena' / 'agents'
        if agena_dir.is_dir():
            md_files = sorted(
                (f for f in agena_dir.rglob('*.md') if f.is_file()),
                key=lambda f: f.stat().st_mtime,
                reverse=True,
            )
            for md_file in md_files:
                try:
                    pkg_dir = md_file.parent / 'packages'
                    return (
                        md_file.read_text(errors='replace'),
                        f'.agena:{md_file.relative_to(root)}',
                        str(pkg_dir) if pkg_dir.is_dir() else '',
                    )
                except Exception as exc:
                    logger.warning('Failed to read .agena repo guide %s: %s', md_file, exc)

        return '', '', ''

    def _repo_guide_is_sufficient(self, guide_content: str, pkg_dir: str = '') -> bool:
        text = (guide_content or '').strip()
        if not text:
            return False
        if pkg_dir and Path(pkg_dir).is_dir():
            return True
        file_ref_pattern = re.compile(
            r'(?im)^[\s>*-]*[`"]?[\w./-]+\.(?:go|py|php|ts|tsx|js|jsx|java|rb|cs|rs|vue|sql|graphql|yaml|yml|json|kt|swift|scala|c|cc|cpp|h|hpp|m|mm|sh)\b',
        )
        file_refs = file_ref_pattern.findall(text)
        if len(file_refs) >= 2:
            return True
        return len(text) <= 500 and bool(file_refs)

    def _build_full_scan_context(
        self,
        root: Path | None,
        task_title: str,
        task_description: str,
    ) -> str:
        if root is None or not root.is_dir():
            return ''

        lines = [f'Repo Root: {root}']
        git_info = self._get_git_info(root)
        if git_info:
            lines.append(git_info)

        relevant_files = self._find_relevant_source_files(root, task_title, task_description)
        if relevant_files:
            lines.append('')
            lines.append('=== RELEVANT SOURCE FILES ===')
            total_chars = 0
            for rel_path, content in relevant_files:
                if total_chars + len(content) > 2000000:
                    continue
                lines.append(f'\n--- {rel_path} ---')
                lines.append(content)
                total_chars += len(content)
            lines.append('=== END SOURCE FILES ===')

        lines.append('')
        lines.append('No repository guide is available. Plan only against the real files listed above.')
        lines.append('Return **File: path** blocks with code. Do NOT create .md or .txt files.')
        return '\n'.join(lines)

    def _normalize_context_text(self, text: str) -> str:
        value = html.unescape(text or '')
        value = value.translate(str.maketrans({
            'ı': 'i', 'İ': 'I',
            'ş': 's', 'Ş': 'S',
            'ğ': 'g', 'Ğ': 'G',
            'ü': 'u', 'Ü': 'U',
            'ö': 'o', 'Ö': 'O',
            'ç': 'c', 'Ç': 'C',
        }))
        value = unicodedata.normalize('NFKD', value)
        value = ''.join(ch for ch in value if not unicodedata.combining(ch))
        value = re.sub(r'https?://\S+', ' ', value)
        value = re.sub(r'<img\b[^>]*>', ' ', value, flags=re.IGNORECASE)
        value = re.sub(r'<[^>]+>', ' ', value)
        value = re.sub(r'!\[[^\]]*\]\(([^)]+)\)', ' ', value)
        value = re.sub(r'([a-z])([A-Z])', r'\1 \2', value)
        return value.lower()

    def _extract_context_keywords(self, *texts: str, limit: int = 24) -> list[str]:
        stop_words = {
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
            'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'and',
            'but', 'or', 'not', 'no', 'so', 'if', 'then', 'than', 'that', 'this',
            'it', 'its', 'all', 'each', 'any', 'both', 'few', 'more', 'most',
            'other', 'some', 'such', 'only', 'same', 'also', 'just', 'about',
            've', 'bir', 'ile', 'icin', 'gore', 'gibi', 'olan', 'olmasi', 'olmali',
            'sekilde', 'seklinde', 'duzenlemesi', 'duzenlenmelidir', 'tum', 'gelen',
            'gelecek', 'donen', 'donulen', 'iceren', 'olacak', 'gelsin', 'gelmeli',
            'local', 'repo', 'path', 'file', 'code', 'task', 'new', 'add', 'fix',
            'img', 'src', 'alt', 'width', 'height', 'style', 'class', 'png', 'jpg',
            'jpeg', 'gif', 'image', 'images', 'prompt', 'instruction', 'instructions',
            'preferred', 'agent', 'model', 'provider', 'context', 'description',
            'azure', 'read', 'visual', 'board', 'workitems', 'edit', 'localhost',
        }

        keywords: list[str] = []
        seen: set[str] = set()
        for text in texts:
            normalized = self._normalize_context_text(text)
            for word in re.findall(r'[a-z_][a-z0-9_]*', normalized):
                if len(word) <= 2 or word in stop_words or word in seen:
                    continue
                seen.add(word)
                keywords.append(word)
                if len(keywords) >= limit:
                    return keywords
        return keywords

    def _build_context_excerpt(
        self,
        rel_path: str,
        content: str,
        task_title: str,
        task_description: str,
        *,
        max_chars: int,
    ) -> str:
        if len(content) <= max_chars:
            return content

        focus_terms = self._extract_context_keywords(task_title, task_description, rel_path, limit=28)
        rel_lower = rel_path.lower()
        if 'product' in rel_lower:
            focus_terms.extend([
                'product', 'products', 'discount', 'discountrate', 'discount_rate',
                'discountinfo', 'discountlabel', 'discount_percent', 'firstrate',
                'oldprice', 'price',
            ])
        if 'global' in rel_lower or 'lang' in rel_lower:
            focus_terms.extend(['discountlabel', 'global', 'globals', 'translation', 'locale', 'lang'])
        if 'route' in rel_lower or 'routing' in rel_lower:
            focus_terms.extend(['product', 'products', 'v1/products', 'api::v1::products', 'discount'])

        lower = content.lower()
        windows: list[tuple[int, int]] = [(0, min(len(content), 700))]
        seen_terms: set[str] = set()

        for term in focus_terms:
            token = str(term or '').strip().lower()
            if len(token) <= 2 or token in seen_terms:
                continue
            seen_terms.add(token)
            start_at = 0
            hits = 0
            while hits < 2:
                pos = lower.find(token, start_at)
                if pos == -1:
                    break
                start = max(0, content.rfind('\n', 0, max(0, pos - 500)) + 1)
                end_marker = content.find('\n', min(len(content) - 1, pos + len(token) + 900))
                end = len(content) if end_marker == -1 else end_marker
                windows.append((start, end))
                start_at = pos + len(token)
                hits += 1
                if len(windows) >= 8:
                    break
            if len(windows) >= 8:
                break

        merged: list[tuple[int, int]] = []
        for start, end in sorted(windows):
            if not merged or start > merged[-1][1] + 120:
                merged.append((start, end))
            else:
                merged[-1] = (merged[-1][0], max(merged[-1][1], end))

        pieces: list[str] = []
        current_len = 0
        prefix = f'[Excerpt from {rel_path}; original size {len(content)} chars]\n'
        budget = max(200, max_chars - len(prefix))
        for idx, (start, end) in enumerate(merged):
            chunk = content[start:end].strip()
            if not chunk:
                continue
            separator = '\n...\n' if idx > 0 else ''
            needed = len(separator) + len(chunk)
            if current_len + needed > budget and pieces:
                break
            if current_len + needed > budget:
                chunk = chunk[: max(0, budget - current_len - len(separator))]
            pieces.append(separator + chunk)
            current_len += len(separator) + len(chunk)
            if current_len >= budget:
                break

        if not pieces:
            pieces.append(content[:budget])

        return prefix + ''.join(pieces)

    def _extract_task_image_urls(self, description: str | None) -> list[str]:
        text = description or ''
        if not text:
            return []

        urls: list[str] = []
        seen: set[str] = set()
        patterns = [
            re.compile(r'<img\b[^>]*\bsrc=["\']([^"\']+)["\']', re.IGNORECASE),
            re.compile(r'!\[[^\]]*\]\(([^)]+)\)'),
        ]
        for pattern in patterns:
            for match in pattern.finditer(text):
                url = str(match.group(1) or '').strip().replace('&amp;', '&')
                if not url or url in seen:
                    continue
                seen.add(url)
                urls.append(url)
                if len(urls) >= 4:
                    return urls
        return urls

    async def _download_image_as_data_url(self, url: str, auth_header: str | None = None) -> str | None:
        headers: dict[str, str] = {}
        if auth_header:
            headers['Authorization'] = auth_header
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()

        content_type = str(response.headers.get('content-type', 'image/png')).split(';', 1)[0].strip().lower()
        if not content_type.startswith('image/'):
            return None
        if len(response.content) > 5 * 1024 * 1024:
            return None
        encoded = base64.b64encode(response.content).decode('ascii')
        return f'data:{content_type};base64,{encoded}'

    async def _build_task_image_inputs(self, description: str | None, organization_id: int, task_id: int | None = None) -> list[str]:
        image_urls = self._extract_task_image_urls(description)

        results: list[str] = []
        azure_auth_header: str | None = None
        azure_auth_loaded = False

        for url in image_urls:
            normalized = url.strip()
            if not normalized:
                continue
            if normalized.startswith('data:image/'):
                results.append(normalized)
                continue

            try:
                is_azure_attachment = 'dev.azure.com/' in normalized or '/_apis/wit/attachments/' in normalized
                if is_azure_attachment:
                    if not azure_auth_loaded:
                        azure_auth_loaded = True
                        azure_cfg = await IntegrationConfigService(self.db_session).get_config(organization_id, 'azure')
                        pat = (azure_cfg.secret or '').strip() if azure_cfg and azure_cfg.secret else ''
                        if pat:
                            token = base64.b64encode(f':{pat}'.encode()).decode()
                            azure_auth_header = f'Basic {token}'
                    if azure_auth_header:
                        data_url = await self._download_image_as_data_url(normalized, azure_auth_header)
                        if data_url:
                            results.append(data_url)
                            continue
                results.append(normalized)
            except Exception as exc:
                logger.warning('Failed to prepare task image input %s: %s', normalized, exc)
                results.append(normalized)

        # Pull image-type TaskAttachment rows off disk and base64-encode them
        # so vision-capable LLMs (gpt-4o, claude sonnet, gemini) receive the
        # bytes directly as `image_url` parts, not just a path string.
        if task_id is not None and self.db_session is not None and len(results) < 4:
            try:
                from agena_models.models.task_attachment import TaskAttachment
                rows = (await self.db_session.execute(
                    select(TaskAttachment)
                    .where(
                        TaskAttachment.task_id == task_id,
                        TaskAttachment.organization_id == organization_id,
                    )
                    .order_by(TaskAttachment.id)
                )).scalars().all()
                for att in rows:
                    if len(results) >= 4:
                        break
                    ct = (att.content_type or '').lower()
                    if not ct.startswith('image/'):
                        continue
                    if (att.size_bytes or 0) > 5 * 1024 * 1024:
                        continue  # skip oversize blobs — same cap as URL downloader
                    try:
                        raw = Path(att.storage_path).read_bytes()
                    except Exception:
                        continue
                    encoded = base64.b64encode(raw).decode('ascii')
                    results.append(f'data:{ct};base64,{encoded}')
            except Exception as exc:
                logger.warning('Failed to load attachment images for task %s: %s', task_id, exc)

        return results[:4]

    def _extract_plan_files(self, plan: dict[str, Any]) -> list[str]:
        candidates = list(plan.get('files', []) or []) + list(plan.get('changes', []) or [])
        files: list[str] = []
        seen: set[str] = set()
        for item in candidates:
            if isinstance(item, dict):
                raw_path = item.get('file', item.get('path', ''))
            else:
                raw_path = str(item)
            normalized = str(raw_path or '').strip().strip('`').replace('\\', '/').lstrip('./')
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            files.append(normalized)
        return files

    def _filter_plan_to_existing_files(self, plan: dict[str, Any], existing_files: list[str]) -> dict[str, Any]:
        allowed = {
            str(path or '').strip().replace('\\', '/').lstrip('./')
            for path in existing_files
            if str(path or '').strip()
        }
        filtered = dict(plan or {})
        filtered['files'] = [path for path in self._extract_plan_files({'files': list(plan.get('files', []) or [])}) if path in allowed]
        filtered_changes: list[Any] = []
        for item in list(plan.get('changes', []) or []):
            if isinstance(item, dict):
                raw_path = item.get('file', item.get('path', ''))
                normalized = str(raw_path or '').strip().replace('\\', '/').lstrip('./')
                if normalized in allowed:
                    filtered_changes.append(item)
            else:
                normalized = str(item or '').strip().replace('\\', '/').lstrip('./')
                if normalized in allowed:
                    filtered_changes.append(item)
        filtered['changes'] = filtered_changes
        return filtered

    def _read_plan_files(
        self,
        repo_root: Path | None,
        plan_files: list[str],
        task_title: str = '',
        task_description: str = '',
    ) -> tuple[str, int, list[str], list[str]]:
        if repo_root is None or not repo_root.is_dir():
            return '', 0, [], list(plan_files)

        file_contents_parts: list[str] = []
        total_read = 0
        found_files: list[str] = []
        missing_files: list[str] = []
        max_total = max(2500, self.settings.max_code_context_chars - 2500)
        normalized_entries: list[tuple[str, Path]] = []
        file_cache: dict[str, str] = {}
        full_read_budget = 0

        for fp in plan_files:
            normalized = str(fp or '').strip().replace('\\', '/').lstrip('./')
            if not normalized:
                continue
            try:
                full = (repo_root / normalized).resolve()
                full.relative_to(repo_root)
            except Exception:
                missing_files.append(normalized)
                file_contents_parts.append(f'\n--- {normalized} (invalid path) ---\n')
                continue

            if not full.is_file():
                missing_files.append(normalized)
                file_contents_parts.append(f'\n--- {normalized} (not found) ---\n')
                continue

            try:
                content = full.read_text(errors='replace')
            except Exception:
                missing_files.append(normalized)
                file_contents_parts.append(f'\n--- {normalized} (read error) ---\n')
                continue

            normalized_entries.append((normalized, full))
            file_cache[normalized] = content
            full_read_budget += len(content)

        if normalized_entries and full_read_budget <= max_total:
            for normalized, _full in normalized_entries:
                content = file_cache[normalized]
                file_contents_parts.append(f'\n--- {normalized} ({len(content)} chars) ---\n{content}')
                total_read += len(content)
                found_files.append(normalized)
            return '\n'.join(file_contents_parts), total_read, found_files, missing_files

        per_file_budget = max(2400, min(16000, max_total // max(1, min(len(normalized_entries) or 1, 6))))

        for normalized, _full in normalized_entries:
            content = file_cache[normalized]
            excerpt = self._build_context_excerpt(
                normalized,
                content,
                task_title,
                task_description,
                max_chars=per_file_budget,
            )
            if total_read + len(excerpt) > max_total:
                remaining = max_total - total_read
                if remaining <= 400:
                    break
                excerpt = self._build_context_excerpt(
                    normalized,
                    content,
                    task_title,
                    task_description,
                    max_chars=remaining,
                )
            file_contents_parts.append(
                f'\n--- {normalized} ({len(content)} chars; context {len(excerpt)} chars) ---\n{excerpt}'
            )
            total_read += len(excerpt)
            found_files.append(normalized)

        return '\n'.join(file_contents_parts), total_read, found_files, missing_files

    async def _read_plan_files_remote(
        self,
        remote_repo: str,
        organization_id: int,
        plan_files: list[str],
        task_title: str = '',
        task_description: str = '',
    ) -> tuple[str, int, list[str], list[str]]:
        """Read planner-selected files from remote repo via API."""
        from agena_services.services.remote_repo_service import RemoteRepoService
        from agena_services.services.integration_config_service import IntegrationConfigService

        svc = RemoteRepoService()
        parts: list[str] = []
        total_read = 0
        found: list[str] = []
        missing: list[str] = []
        max_total = max(2500, self.settings.max_code_context_chars - 2500)

        try:
            if remote_repo.startswith('github:'):
                spec = remote_repo[len('github:'):]
                branch = 'main'
                if '@' in spec:
                    spec, branch = spec.rsplit('@', 1)
                owner, repo = spec.split('/', 1)
                token = self.settings.github_token or ''
                if not token:
                    cfg_svc = IntegrationConfigService(self.db_session)
                    gh_cfg = await cfg_svc.get_config(organization_id, 'github')
                    if gh_cfg and gh_cfg.secret:
                        token = gh_cfg.secret
                if not token:
                    return '', 0, [], list(plan_files)
                for fp in plan_files:
                    normalized = str(fp or '').strip().replace('\\', '/').lstrip('./')
                    if not normalized:
                        continue
                    content = await svc.github_file_content(owner, repo, token, normalized, branch)
                    if content is None:
                        missing.append(normalized)
                        parts.append(f'\n--- {normalized} (not found in remote) ---\n')
                        continue
                    if total_read + len(content) > max_total:
                        content = content[:max(400, max_total - total_read)]
                    parts.append(f'\n--- {normalized} ({len(content)} chars) ---\n{content}')
                    total_read += len(content)
                    found.append(normalized)

            elif remote_repo.startswith('azure:'):
                spec = remote_repo[len('azure:'):]
                branch = 'main'
                if '@' in spec:
                    spec, branch = spec.rsplit('@', 1)
                project, repo = spec.split('/', 1)
                cfg_svc = IntegrationConfigService(self.db_session)
                az_cfg = await cfg_svc.get_config(organization_id, 'azure')
                if not az_cfg or not az_cfg.secret or not az_cfg.base_url:
                    return '', 0, [], list(plan_files)
                for fp in plan_files:
                    normalized = str(fp or '').strip().replace('\\', '/').lstrip('./')
                    if not normalized:
                        continue
                    content = await svc.azure_file_content(az_cfg.base_url, project, repo, az_cfg.secret, normalized, branch)
                    if content is None:
                        missing.append(normalized)
                        parts.append(f'\n--- {normalized} (not found in remote) ---\n')
                        continue
                    if total_read + len(content) > max_total:
                        content = content[:max(400, max_total - total_read)]
                    parts.append(f'\n--- {normalized} ({len(content)} chars) ---\n{content}')
                    total_read += len(content)
                    found.append(normalized)
            else:
                return '', 0, [], list(plan_files)
        except Exception as exc:
            logger.error('_read_plan_files_remote failed for %s: %s', remote_repo, exc)
            return '', 0, [], list(plan_files)

        return '\n'.join(parts), total_read, found, missing

    async def _build_repo_context(
        self,
        local_repo_path: str | None,
        organization_id: int,
        user_id: int | None,
        task_title: str = '',
        task_description: str = '',
        remote_repo: str | None = None,
    ) -> str | None:
        repo_path = (local_repo_path or '').strip()

        # If no local path, try remote repo via API
        if not repo_path and remote_repo:
            return await self._build_remote_repo_context(
                remote_repo, organization_id, task_title, task_description,
            )

        if not repo_path:
            return None
        try:
            root = Path(repo_path).expanduser().resolve()
            if not root.exists() or not root.is_dir():
                return f'Local repo path is configured but not reachable: {repo_path}'

            git_info = self._get_git_info(root)
            agents_content, agents_source, agents_pkg_dir = self._resolve_repo_guide(root)
            if self._repo_guide_is_sufficient(agents_content, agents_pkg_dir):
                lines = [f'Repo Root: {root}']
                if git_info:
                    lines.append(git_info)
                lines += [
                    '',
                    f'=== AGENTS.MD (Repository Guide; source={agents_source}) ===',
                    agents_content,
                    '=== END AGENTS.MD ===',
                    '',
                    '=== RELEVANT SOURCE FILES ===',
                ]
                relevant_files = self._find_relevant_source_files(root, task_title, task_description)
                total_chars = len(agents_content)
                for rel_path, content in relevant_files:
                    if total_chars + len(content) > 2000000:
                        continue
                    lines.append(f'\n--- {rel_path} ---')
                    lines.append(content)
                    total_chars += len(content)
                lines.append('=== END SOURCE FILES ===')
                lines.append('')
                lines.append('You have agents.md AND the full source files. Use agents.md to understand the architecture, then modify source files.')
                lines.append('Return **File: path** blocks with code.')
                return '\n'.join(lines)

            return self._build_full_scan_context(root, task_title, task_description)
        except Exception as exc:
            return f'Repo context unavailable for {repo_path}: {str(exc)[:180]}'

    async def _build_remote_file_tree_only(self, remote_repo: str, organization_id: int) -> str | None:
        """Build a lightweight file tree (paths only, no content) from remote repo."""
        from agena_services.services.remote_repo_service import RemoteRepoService
        from agena_services.services.integration_config_service import IntegrationConfigService
        svc = RemoteRepoService()
        try:
            if remote_repo.startswith('github:'):
                spec = remote_repo[len('github:'):]
                branch = 'main'
                if '@' in spec:
                    spec, branch = spec.rsplit('@', 1)
                owner, repo = spec.split('/', 1)
                token = self.settings.github_token or ''
                if not token:
                    cfg_svc = IntegrationConfigService(self.db_session)
                    gh_cfg = await cfg_svc.get_config(organization_id, 'github')
                    if gh_cfg and gh_cfg.secret:
                        token = gh_cfg.secret
                if not token:
                    return None
                tree = await svc.github_tree(owner, repo, token, branch)
            elif remote_repo.startswith('azure:'):
                spec = remote_repo[len('azure:'):]
                branch = 'main'
                if '@' in spec:
                    spec, branch = spec.rsplit('@', 1)
                project, repo = spec.split('/', 1)
                cfg_svc = IntegrationConfigService(self.db_session)
                az_cfg = await cfg_svc.get_config(organization_id, 'azure')
                if not az_cfg or not az_cfg.secret or not az_cfg.base_url:
                    return None
                tree = await svc.azure_tree(az_cfg.base_url, project, repo, az_cfg.secret, branch)
            else:
                return None

            filtered = svc._filter_tree(tree)
            lines = ['=== FILE TREE ===']
            for item in filtered[:300]:
                lines.append(f'  {item["path"]}')
            if len(filtered) > 300:
                lines.append(f'  ... and {len(filtered) - 300} more files')
            lines.append('=== END FILE TREE ===')
            return '\n'.join(lines)
        except Exception as exc:
            logger.warning('Failed to build remote file tree for %s: %s', remote_repo, exc)
            return None

    async def _fetch_remote_agents_md(self, remote_repo: str, organization_id: int) -> str | None:
        """Try to fetch agents.md from remote repo root."""
        from agena_services.services.remote_repo_service import RemoteRepoService
        from agena_services.services.integration_config_service import IntegrationConfigService
        svc = RemoteRepoService()
        try:
            if remote_repo.startswith('github:'):
                spec = remote_repo[len('github:'):]
                branch = 'main'
                if '@' in spec:
                    spec, branch = spec.rsplit('@', 1)
                owner, repo = spec.split('/', 1)
                token = self.settings.github_token or ''
                if not token:
                    cfg_svc = IntegrationConfigService(self.db_session)
                    gh_cfg = await cfg_svc.get_config(organization_id, 'github')
                    if gh_cfg and gh_cfg.secret:
                        token = gh_cfg.secret
                if not token:
                    return None
                for name in ['agents.md', 'AGENTS.md']:
                    content = await svc.github_file_content(owner, repo, token, name, branch)
                    if content:
                        return content

            elif remote_repo.startswith('azure:'):
                spec = remote_repo[len('azure:'):]
                branch = 'main'
                if '@' in spec:
                    spec, branch = spec.rsplit('@', 1)
                project, repo = spec.split('/', 1)
                cfg_svc = IntegrationConfigService(self.db_session)
                az_cfg = await cfg_svc.get_config(organization_id, 'azure')
                if not az_cfg or not az_cfg.secret or not az_cfg.base_url:
                    return None
                for name in ['agents.md', 'AGENTS.md']:
                    content = await svc.azure_file_content(az_cfg.base_url, project, repo, az_cfg.secret, name, branch)
                    if content:
                        return content
        except Exception as exc:
            logger.warning('Failed to fetch remote agents.md for %s: %s', remote_repo, exc)
        return None

    async def _fetch_remote_file_content(
        self, remote_repo: str, organization_id: int, path: str,
    ) -> str | None:
        """Read a single file from a remote repo. Used by MCP RemoteToolExecutor."""
        from agena_services.services.remote_repo_service import RemoteRepoService
        from agena_services.services.integration_config_service import IntegrationConfigService
        svc = RemoteRepoService()
        normalized = str(path or '').strip().replace('\\', '/').lstrip('./')
        if not normalized:
            return None
        try:
            if remote_repo.startswith('github:'):
                spec = remote_repo[len('github:'):]
                branch = 'main'
                if '@' in spec:
                    spec, branch = spec.rsplit('@', 1)
                owner, repo = spec.split('/', 1)
                token = self.settings.github_token or ''
                if not token:
                    cfg_svc = IntegrationConfigService(self.db_session)
                    gh_cfg = await cfg_svc.get_config(organization_id, 'github')
                    if gh_cfg and gh_cfg.secret:
                        token = gh_cfg.secret
                if not token:
                    return None
                return await svc.github_file_content(owner, repo, token, normalized, branch)
            elif remote_repo.startswith('azure:'):
                spec = remote_repo[len('azure:'):]
                branch = 'main'
                if '@' in spec:
                    spec, branch = spec.rsplit('@', 1)
                project, repo = spec.split('/', 1)
                cfg_svc = IntegrationConfigService(self.db_session)
                az_cfg = await cfg_svc.get_config(organization_id, 'azure')
                if not az_cfg or not az_cfg.secret or not az_cfg.base_url:
                    return None
                return await svc.azure_file_content(az_cfg.base_url, project, repo, az_cfg.secret, normalized, branch)
        except Exception as exc:
            logger.warning('_fetch_remote_file_content(%s, %s) failed: %s', remote_repo, path, exc)
        return None

    async def _fetch_remote_file_list(
        self, remote_repo: str, organization_id: int,
    ) -> list[str]:
        """Return list of all file paths in a remote repo. Used by MCP RemoteToolExecutor."""
        from agena_services.services.remote_repo_service import RemoteRepoService
        from agena_services.services.integration_config_service import IntegrationConfigService
        svc = RemoteRepoService()
        try:
            if remote_repo.startswith('github:'):
                spec = remote_repo[len('github:'):]
                branch = 'main'
                if '@' in spec:
                    spec, branch = spec.rsplit('@', 1)
                owner, repo = spec.split('/', 1)
                token = self.settings.github_token or ''
                if not token:
                    cfg_svc = IntegrationConfigService(self.db_session)
                    gh_cfg = await cfg_svc.get_config(organization_id, 'github')
                    if gh_cfg and gh_cfg.secret:
                        token = gh_cfg.secret
                if not token:
                    return []
                tree = await svc.github_tree(owner, repo, token, branch)
                filtered = svc._filter_tree(tree)
                return [item['path'] for item in filtered]
            elif remote_repo.startswith('azure:'):
                spec = remote_repo[len('azure:'):]
                branch = 'main'
                if '@' in spec:
                    spec, branch = spec.rsplit('@', 1)
                project, repo = spec.split('/', 1)
                cfg_svc = IntegrationConfigService(self.db_session)
                az_cfg = await cfg_svc.get_config(organization_id, 'azure')
                if not az_cfg or not az_cfg.secret or not az_cfg.base_url:
                    return []
                tree = await svc.azure_tree(az_cfg.base_url, project, repo, az_cfg.secret, branch)
                filtered = svc._filter_tree(tree)
                return [item['path'] for item in filtered]
        except Exception as exc:
            logger.warning('_fetch_remote_file_list(%s) failed: %s', remote_repo, exc)
        return []

    async def _build_remote_repo_context(
        self,
        remote_repo: str,
        organization_id: int,
        task_title: str,
        task_description: str,
    ) -> str | None:
        """Build repo context by reading files via GitHub/Azure API."""
        from agena_services.services.remote_repo_service import RemoteRepoService
        from agena_services.services.integration_config_service import IntegrationConfigService
        svc = RemoteRepoService()
        try:
            if remote_repo.startswith('github:'):
                # Format: github:owner/repo or github:owner/repo@branch
                spec = remote_repo[len('github:'):]
                branch = 'main'
                if '@' in spec:
                    spec, branch = spec.rsplit('@', 1)
                owner, repo = spec.split('/', 1)
                # Get GitHub token from settings or integration
                token = self.settings.github_token or ''
                if not token:
                    cfg_svc = IntegrationConfigService(self.db_session)
                    gh_cfg = await cfg_svc.get_config(organization_id, 'github')
                    if gh_cfg and gh_cfg.secret:
                        token = gh_cfg.secret
                if not token:
                    return 'Remote repo configured but no GitHub token available'
                return await svc.github_repo_context(owner, repo, token, branch, task_title, task_description)

            elif remote_repo.startswith('azure:'):
                # Format: azure:project/repo or azure:project/repo@branch
                spec = remote_repo[len('azure:'):]
                branch = 'main'
                if '@' in spec:
                    spec, branch = spec.rsplit('@', 1)
                project, repo = spec.split('/', 1)
                cfg_svc = IntegrationConfigService(self.db_session)
                az_cfg = await cfg_svc.get_config(organization_id, 'azure')
                if not az_cfg or not az_cfg.secret or not az_cfg.base_url:
                    return 'Remote repo configured but no Azure DevOps credentials available'
                return await svc.azure_repo_context(az_cfg.base_url, project, repo, az_cfg.secret, branch, task_title, task_description)

            else:
                return f'Unknown remote repo format: {remote_repo}'
        except Exception as exc:
            logger.error('Remote repo context failed for %s: %s', remote_repo, exc)
            return f'Remote repo context unavailable: {str(exc)[:200]}'

    def _find_relevant_source_files(
        self,
        root: Path,
        task_title: str,
        task_description: str,
    ) -> list[tuple[str, str]]:
        """Collect source files from the repository, prioritised by relevance to the task."""
        source_exts = {
            '.go', '.py', '.ts', '.tsx', '.js', '.jsx', '.java', '.rs', '.rb', '.cs',
            '.php', '.swift', '.kt', '.scala', '.c', '.cpp', '.h', '.hpp', '.vue',
            '.svelte', '.dart', '.ex', '.exs', '.lua', '.sql', '.graphql', '.proto',
        }
        ignore_dirs = {
            'vendor', 'node_modules', '.git', 'dist', 'build', '__pycache__', '.next',
            '.idea', '.vscode', 'target', 'bin', 'obj', '.gradle', 'Pods', 'coverage',
        }
        ignore_files = {'go.sum', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'}

        def _normalize_task_text(text: str) -> str:
            return self._normalize_context_text(text)

        def _extract_keywords(text: str, *, limit: int) -> list[str]:
            words = re.findall(r'[a-z_][a-z0-9_]*', text)
            ranked: list[str] = []
            seen: set[str] = set()
            for word in words:
                if len(word) <= 2 or word in stop_words or word in seen:
                    continue
                seen.add(word)
                ranked.append(word)
                if len(ranked) >= limit:
                    break
            return ranked

        stop_words = {
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
            'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'and',
            'but', 'or', 'not', 'no', 'so', 'if', 'then', 'than', 'that', 'this',
            'it', 'its', 'all', 'each', 'any', 'both', 'few', 'more', 'most',
            'other', 'some', 'such', 'only', 'same', 'also', 'just', 'about',
            've', 'bir', 'ile', 'icin', 'gore', 'gibi', 'olan', 'olmasi', 'olmali',
            'sekilde', 'seklinde', 'duzenlemesi', 'duzenlenmelidir', 'tum', 'gelen',
            'gelecek', 'donen', 'donulen', 'iceren', 'olacak', 'gelsin', 'gelmeli',
            'local', 'repo', 'path', 'file', 'code', 'task', 'new', 'add', 'fix',
            'img', 'src', 'alt', 'width', 'height', 'style', 'class', 'png', 'jpg',
            'jpeg', 'gif', 'image', 'images', 'prompt', 'instruction', 'instructions',
            'preferred', 'agent', 'model', 'provider', 'context', 'description',
            'azure', 'read', 'visual', 'board', 'workitems', 'edit', 'localhost',
        }
        title_text = _normalize_task_text(task_title)
        desc_text = _normalize_task_text(task_description)
        title_keywords = _extract_keywords(title_text, limit=12)
        desc_keywords = _extract_keywords(desc_text, limit=18)
        keywords = title_keywords + [kw for kw in desc_keywords if kw not in title_keywords]
        if not keywords:
            keywords = ['product', 'discount']

        keyword_aliases: set[str] = set(keywords)
        for kw in list(keyword_aliases):
            if len(kw) <= 2:
                continue
            if kw.endswith('s') and len(kw) > 4:
                keyword_aliases.add(kw[:-1])
            else:
                keyword_aliases.add(f'{kw}s')

        def _matches_keyword_stem(*stems: str) -> bool:
            for kw in keyword_aliases:
                for stem in stems:
                    if kw == stem or kw.startswith(stem) or stem in kw:
                        return True
            return False

        mentions_product = _matches_keyword_stem('product', 'urun')
        mentions_discount = _matches_keyword_stem('discount', 'indirim', 'rate', 'oran')
        mentions_globals = _matches_keyword_stem('global', 'globals', 'label', 'locale', 'lang', 'translation')
        mentions_services = _matches_keyword_stem('service', 'servis', 'endpoint', 'route', 'api', 'data')

        backend_bias_tokens = {
            'product', 'discount', 'rate', 'price', 'datas', 'data', 'label',
            'translation', 'locale', 'global', 'percent', 'servis', 'api', 'route',
        }
        backend_dir_tokens = (
            'app/controller', 'app/model', 'app/service', 'app/services',
            'resources/lang', 'resources/routing', 'routes', 'test/', 'tests/',
        )
        frontend_penalty_tokens = (
            'app/themes/', 'public/assets/', 'public/pub/', 'frontend/', 'javascript/',
        )
        config_penalty_tokens = (
            'app/config/settings/',
        )

        all_files: list[tuple[Path, int]] = []
        try:
            for f in sorted(root.rglob('*')):
                if not f.is_file():
                    continue
                if f.suffix not in source_exts:
                    continue
                if f.name in ignore_files:
                    continue
                rel_parts = f.relative_to(root).parts
                if any(part in ignore_dirs for part in rel_parts):
                    continue
                try:
                    size = f.stat().st_size
                    if size > 300000 or size == 0:
                        continue
                    all_files.append((f, size))
                except Exception:
                    continue
        except Exception:
            return []

        scored: list[tuple[Path, str, float, str]] = []
        scored_by_rel: dict[str, tuple[float, str]] = {}
        for f, size in all_files:
            rel_path = str(f.relative_to(root))
            rel_path_lower = rel_path.lower()
            basename_lower = f.stem.lower()
            score = 0.0
            try:
                content = f.read_text(errors='replace')
            except Exception:
                continue

            content_lower = content.lower()
            path_parts = [part for part in re.split(r'[^a-z0-9]+', rel_path_lower) if part]

            for idx, kw in enumerate(keywords):
                path_hits = rel_path_lower.count(kw)
                body_hits = content_lower.count(kw)
                weight = 8.0 if idx < len(title_keywords) else 4.0
                score += min(path_hits, 3) * weight
                score += min(body_hits, 5) * (weight / 2)

            for kw in keyword_aliases:
                if basename_lower == kw:
                    score += 18.0
                elif basename_lower.startswith(kw) or kw.startswith(basename_lower):
                    score += 10.0
                if kw in path_parts:
                    score += 5.0

            if any(token in rel_path_lower for token in backend_dir_tokens):
                score += 6.0
            if rel_path_lower.endswith('.php'):
                score += 3.0
            if '/test' in rel_path_lower or rel_path_lower.startswith('test/'):
                score += 2.5
            if any(token in rel_path_lower for token in frontend_penalty_tokens):
                score -= 6.0
            if any(token in rel_path_lower for token in config_penalty_tokens):
                score -= 10.0
            if rel_path_lower.endswith(('.js', '.jsx', '.ts', '.tsx')) and not any(
                token in rel_path_lower for token in ('api', 'controller', 'service', 'model', 'route')
            ):
                score -= 2.0
            if any(token in keywords for token in backend_bias_tokens) and any(
                token in rel_path_lower for token in backend_dir_tokens
            ):
                score += 4.0
            if 'product' in rel_path_lower and any(token in content_lower for token in ('discount', 'discountrate', 'discount_rate')):
                score += 8.0
            if any(token in rel_path_lower for token in ('routing', 'routes', 'controller')) and 'product' in content_lower:
                score += 5.0
            if mentions_product and any(token in rel_path_lower for token in (
                'app/controller/api/v1/products.php',
                'app/controller/v1/product.php',
                'app/model/v1/product.php',
                'app/model/product.php',
            )):
                score += 30.0
            if mentions_product and '/product' in rel_path_lower and any(
                token in rel_path_lower for token in ('/controller/', '/model/', '/library/')
            ):
                score += 16.0
            if mentions_services and rel_path_lower.endswith('app/config/routes.php'):
                score += 24.0
            if mentions_globals and rel_path_lower.endswith('resources/lang/globals.php'):
                score += 28.0
            if mentions_discount and any(
                token in content_lower for token in (
                    'discountlabel', 'discount_rate', 'discountrate',
                    'discount_percent', 'discountinfo',
                )
            ):
                score += 20.0
            if mentions_discount and any(
                token in content_lower for token in ("'-%'", '"-%"', "'-'", '"-"')
            ):
                score += 12.0

            scored.append((f, rel_path, score, content))
            scored_by_rel[rel_path] = (score, content)

        priority_candidates: list[tuple[int, str]] = []
        seen_priorities: set[str] = set()

        def _add_priority(path: Path, priority: int) -> None:
            try:
                rel = str(path.relative_to(root))
            except Exception:
                return
            if rel in seen_priorities or rel not in scored_by_rel:
                return
            seen_priorities.add(rel)
            priority_candidates.append((priority, rel))

        if mentions_globals or mentions_discount:
            _add_priority(root / 'resources/lang/globals.php', 120)
            for path in sorted((root / 'resources/routing/languages').glob('*.php'))[:4]:
                _add_priority(path, 80)
        if mentions_services or mentions_product:
            _add_priority(root / 'app/Config/routes.php', 110)
        if mentions_product:
            for priority, candidate in (
                (115, root / 'app/Controller/Api/V1/Products.php'),
                (112, root / 'app/Controller/V1/Product.php'),
                (114, root / 'app/Model/V1/Product.php'),
                (111, root / 'app/Model/Product.php'),
            ):
                _add_priority(candidate, priority)
            for pattern, priority in (
                ('app/Model/Product*.php', 105),
                ('app/Model/V1/Product*.php', 104),
                ('app/Controller/**/*Product*.php', 100),
                ('app/Library/**/*Product*.php', 92),
            ):
                for path in sorted(root.glob(pattern))[:10]:
                    _add_priority(path, priority)

        priority_candidates.sort(key=lambda item: (-item[0], item[1]))

        # Sort by relevance score descending, then prefer smaller critical files.
        scored.sort(key=lambda x: (-x[2], len(x[3]), x[1]))

        # Read files in relevance order, highest-scoring first within budget
        result: list[tuple[str, str]] = []
        selected_paths: set[str] = set()
        total_chars = 0
        max_total = max(2500, self.settings.max_context_chars - 1500)
        per_file_budget = max(1000, min(2600, max_total // 4))
        backend_results = 0

        def _append_result(rel_path: str, content: str) -> bool:
            nonlocal total_chars, backend_results
            if rel_path in selected_paths:
                return False
            prepared = content
            if len(content) > per_file_budget:
                prepared = self._build_context_excerpt(
                    rel_path,
                    content,
                    task_title,
                    task_description,
                    max_chars=per_file_budget,
                )
            if total_chars + len(prepared) > max_total:
                return False
            result.append((rel_path, prepared))
            selected_paths.add(rel_path)
            total_chars += len(prepared)
            if any(token in rel_path.lower() for token in backend_dir_tokens):
                backend_results += 1
            return True

        for _priority, rel_path in priority_candidates:
            score_content = scored_by_rel.get(rel_path)
            if not score_content:
                continue
            _score, content = score_content
            _append_result(rel_path, content)

        for _f, rel_path, score, content in scored:
            if score < 1 and backend_results >= 8:
                continue
            if rel_path in selected_paths:
                continue
            if not _append_result(rel_path, content):
                continue
            if len(result) >= 24:
                break

        if not result:
            for _f, rel_path, _score, content in scored:
                if not any(token in rel_path.lower() for token in backend_dir_tokens):
                    continue
                if rel_path in selected_paths:
                    continue
                if not _append_result(rel_path, content):
                    continue
                if len(result) >= 12:
                    break

        return result

    def _validate_cost_guardrails(
        self,
        *,
        max_tokens: int | None,
        max_cost_usd: float | None,
        total_tokens: int,
        estimated_cost_usd: float,
    ) -> str | None:
        if max_tokens is not None and total_tokens > max_tokens:
            return f'Cost guardrail triggered: total tokens {total_tokens} exceeded max_tokens {max_tokens}'
        if max_cost_usd is not None and estimated_cost_usd > max_cost_usd:
            return (
                'Cost guardrail triggered: estimated cost '
                f'${estimated_cost_usd:.4f} exceeded max_cost_usd ${max_cost_usd:.4f}'
            )
        return None
