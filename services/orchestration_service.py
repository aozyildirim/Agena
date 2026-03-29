from __future__ import annotations

import base64
import difflib
import json
import logging
import re

logger = logging.getLogger(__name__)
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

from agents.orchestrator import AgentOrchestrator
from core.settings import get_settings
from models.run_record import RunRecord
from models.task_record import TaskRecord
from schemas.agent import AgentRunResult, UsageStats
from schemas.github import CreatePRRequest, GitHubFileChange
from services.azure_pr_service import AzurePRService
from services.ai_usage_event_service import AIUsageEventService
from services.claude_cli_service import ClaudeCLIService
from services.codex_cli_service import CodexCLIService
from services.github_service import GitHubService
from services.integration_config_service import IntegrationConfigService
from services.llm.cost_tracker import CostTracker
from services.local_repo_service import LocalRepoService
from services.notification_service import NotificationService
from services.event_bus import publish_fire_and_forget
from services.task_service import TaskService
from services.usage_service import UsageService


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

    async def run_task_record(self, organization_id: int, task_id: int, create_pr: bool = True, mode: str = 'flow', agent_model: str | None = None, agent_provider: str | None = None) -> AgentRunResult:
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

        routing = self._extract_task_routing(task)

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
            ),
            task.story_context,
            task.acceptance_criteria,
            task.edge_cases,
        )
        payload = {
            'id': str(task.id),
            'title': task.title,
            'description': effective_description,
            'source': routing.effective_source,
            'organization_id': organization_id,
        }

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
                    final_code = await self.codex_cli_service.generate_file_markdown(
                        repo_path=routing.local_repo_path,
                        task_title=task.title,
                        task_description=effective_description,
                        model=routing.preferred_agent_model,
                        api_key=None,
                        api_base_url=None,
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
                await task_service.add_log(task.id, organization_id, 'agent', f"Claude CLI started (model={routing.preferred_agent_model or 'default'})")
                final_code = await self.claude_cli_service.generate_file_markdown(
                    repo_path=routing.local_repo_path,
                    task_title=task.title,
                    task_description=effective_description,
                    model=routing.preferred_agent_model,
                )
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
            else:
                orchestrator = await self._build_orchestrator(organization_id, routing)
                task_description_for_ai = task.description or ''
                task_image_inputs: list[str] = []
                if mode == 'ai':
                    task_image_inputs = await self._build_task_image_inputs(task_description_for_ai, organization_id)
                # Build repo context into task description before flow starts
                _repo_ctx = await self._build_repo_context(
                    local_repo_path=routing.local_repo_path,
                    organization_id=organization_id,
                    user_id=task.created_by_user_id,
                    task_title=task.title or '',
                    task_description=task.description or '',
                )
                await task_service.add_log(task.id, organization_id, 'agent',
                    f'Repo context built: {len(_repo_ctx or "")} chars, '
                    f'has_agents_md: {"AGENTS.MD" in (_repo_ctx or "")}, '
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
                    repo_root = Path(routing.local_repo_path).expanduser().resolve() if routing.local_repo_path else None
                    agents_md_content, agents_md_source, agents_pkg_dir = self._resolve_repo_guide(repo_root)
                    if not agents_md_content:
                        agents_md_content = self._build_full_scan_context(
                            repo_root,
                            task.title,
                            task_description_for_ai,
                        )
                        agents_md_source = 'fallback:full_scan'
                    if not agents_md_content:
                        agents_md_content = flow_state.get('context_summary', '')
                        agents_md_source = 'fallback:flow_context'

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

                    # Step 2b: Read the actual files from disk
                    file_contents, total_read, found_files, missing_files = self._read_plan_files(repo_root, plan_files)

                    if plan_files and total_read == 0:
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
                            file_contents, total_read, found_files, missing_files = self._read_plan_files(repo_root, plan_files)

                    if not plan_files:
                        raise RuntimeError('AI planner returned no repository files. Aborting before code generation.')
                    if total_read == 0:
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

                    flow_state['spec'] = plan

                # Step 3: Developer generate code
                if mode == 'ai':
                    # AI mode step 3: send plan + file contents
                    await task_service.add_log(task.id, organization_id, 'agent',
                        f'Step 3/{total_steps}: Developer coding...\n'
                        f'  plan_files: {plan_files}\n'
                        f'  file_contents: {total_read} chars ({len(plan_files)} files)\n'
                        f'  task_images: {len(task_image_inputs)}\n'
                        f'  system_prompt: AI_CODE_SYSTEM_PROMPT\n'
                        f'  model: {routing.preferred_agent_model or "default"} | max_output_tokens: 128000'
                    )
                    u_before = _get_usage(flow_state)
                    s_start = datetime.utcnow()
                    s_clock = time.perf_counter()
                    generated, code_usage, code_model = await orchestrator.agents.run_ai_code(
                        task_title=task.title,
                        task_description=task_description_for_ai,
                        plan=plan,
                        file_contents=file_contents,
                        task_images=task_image_inputs,
                    )
                    # Retry once on refusal
                    if generated.strip().lower().startswith("i'm sorry") or len(generated.strip()) < 100:
                        await task_service.add_log(task.id, organization_id, 'agent',
                            f'Developer refused or empty output ({len(generated)} chars), retrying...')
                        generated, code_usage2, code_model = await orchestrator.agents.run_ai_code(
                            task_title=task.title,
                            task_description=task_description_for_ai,
                            plan=plan,
                            file_contents=file_contents,
                            task_images=task_image_inputs,
                        )
                        orchestrator._merge_usage(flow_state, code_usage2)
                        flow_state['model_usage'].append(code_model)
                    orchestrator._merge_usage(flow_state, code_usage)
                    flow_state['model_usage'].append(code_model)
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
            pr_payload = await self._build_pr_payload(task=payload, reviewed_code=final_code, local_repo_path=routing.local_repo_path)
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

            await orchestrator.memory_store.upsert_memory(
                key=str(task.id),
                input_text=f"{task.title}\n{task.description or ''}",
                output_text=final_code,
                organization_id=organization_id,
            )

            publish_fire_and_forget(organization_id, 'task_status', {
                'task_id': task.id, 'status': 'completed', 'title': task.title,
            })

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
                from models.user_preference import UserPreference
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
        # Sanitize branch name
        branch_name = re.sub(r'[^a-zA-Z0-9/_#.-]', '-', branch_name).strip('-')

        parsed_files = self._parse_reviewed_output_to_files(reviewed_code, local_repo_path=local_repo_path)
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

    def _parse_reviewed_output_to_files(self, reviewed_code: str, local_repo_path: str | None = None) -> list[GitHubFileChange]:
        # Try multiple patterns — with and without fenced code blocks
        patterns = [
            # **File: path** + ```code```
            re.compile(r'\*{0,2}File:\s*(.*?)\*{0,2}\s*\r?\n```[^\n]*\r?\n(.*?)```', re.DOTALL),
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

    def _extract_task_routing(self, task: TaskRecord) -> TaskRouting:
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

        return TaskRouting(
            effective_source=effective_source,
            external_source=external_source,
            azure_project=azure_project,
            azure_repo_url=azure_repo_url,
            local_repo_mapping=meta.get('local repo mapping') or None,
            local_repo_path=meta.get('local repo path') or None,
            repo_playbook=meta.get('repo playbook') or None,
            preferred_agent=meta.get('preferred agent') or None,
            preferred_agent_provider=meta.get('preferred agent provider') or None,
            preferred_agent_model=meta.get('preferred agent model') or None,
            execution_prompt=meta.get('execution prompt') or None,
        )

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
        for file in files[:3]:
            snippet = file.content[:500].rstrip()
            lines.append(f'\nFile: {file.path}')
            lines.append('```')
            lines.append(snippet if snippet else '(empty)')
            lines.append('```')

        if len(files) > 3:
            lines.append(f'\n...and {len(files) - 3} more file(s).')
        return '\n'.join(lines)

    def _build_code_diff_message(self, repo_path: str, files: list[GitHubFileChange]) -> str:
        if not files:
            return 'No generated files to diff.'

        root = Path(repo_path).expanduser().resolve()
        lines: list[str] = [f'Diff files ({len(files)}):']

        for file in files[:3]:
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

        if len(files) > 3:
            lines.append(f'\n...and {len(files) - 3} more file(s).')
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
                memory_provider=memory_provider,
                memory_api_key=memory_api_key,
                memory_base_url=memory_base_url,
                memory_model=memory_model,
            )
        from services.llm.provider import LLMProvider
        llm = LLMProvider(
            provider=llm_runtime.provider,
            api_key=llm_runtime.api_key,
            base_url=llm_runtime.base_url,
            small_model=llm_runtime.model,
            large_model=llm_runtime.model,
        )
        return AgentOrchestrator(
            llm_provider=llm,
            memory_provider=memory_provider,
            memory_api_key=memory_api_key,
            memory_base_url=memory_base_url,
            memory_model=memory_model,
        )

    async def _resolve_llm_runtime(self, organization_id: int, routing: TaskRouting) -> LLMRuntimeConfig | None:
        provider = (routing.preferred_agent_provider or '').strip().lower()
        preferred_model = (routing.preferred_agent_model or '').strip() or None
        if provider not in {'openai', 'gemini'}:
            provider = 'openai'

        cfg_service = IntegrationConfigService(self.db_session)
        selected_cfg = await cfg_service.get_config(organization_id, provider)
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
        return LLMRuntimeConfig(
            provider='openai',
            api_key=selected_key,
            base_url=selected_base or (self.settings.openai_base_url or 'https://api.openai.com/v1'),
            model=preferred_model,
        )

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

        tiqr_dir = root / '.tiqr' / 'agents'
        if tiqr_dir.is_dir():
            md_files = sorted(
                (f for f in tiqr_dir.rglob('*.md') if f.is_file()),
                key=lambda f: f.stat().st_mtime,
                reverse=True,
            )
            for md_file in md_files:
                try:
                    pkg_dir = md_file.parent / 'packages'
                    return (
                        md_file.read_text(errors='replace'),
                        f'.tiqr:{md_file.relative_to(root)}',
                        str(pkg_dir) if pkg_dir.is_dir() else '',
                    )
                except Exception as exc:
                    logger.warning('Failed to read .tiqr repo guide %s: %s', md_file, exc)

        return '', '', ''

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

    async def _build_task_image_inputs(self, description: str | None, organization_id: int) -> list[str]:
        image_urls = self._extract_task_image_urls(description)
        if not image_urls:
            return []

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

    def _read_plan_files(self, repo_root: Path | None, plan_files: list[str]) -> tuple[str, int, list[str], list[str]]:
        if repo_root is None or not repo_root.is_dir():
            return '', 0, [], list(plan_files)

        file_contents_parts: list[str] = []
        total_read = 0
        found_files: list[str] = []
        missing_files: list[str] = []

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
                file_contents_parts.append(f'\n--- {normalized} ({len(content)} chars) ---\n{content}')
                total_read += len(content)
                found_files.append(normalized)
            except Exception:
                missing_files.append(normalized)
                file_contents_parts.append(f'\n--- {normalized} (read error) ---\n')

        return '\n'.join(file_contents_parts), total_read, found_files, missing_files

    async def _build_repo_context(
        self,
        local_repo_path: str | None,
        organization_id: int,
        user_id: int | None,
        task_title: str = '',
        task_description: str = '',
    ) -> str | None:
        repo_path = (local_repo_path or '').strip()
        if not repo_path:
            return None
        try:
            root = Path(repo_path).expanduser().resolve()
            if not root.exists() or not root.is_dir():
                return f'Local repo path is configured but not reachable: {repo_path}'

            git_info = self._get_git_info(root)
            agents_content, agents_source, _agents_pkg_dir = self._resolve_repo_guide(root)
            if agents_content and len(agents_content) > 500:
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

        # Extract keywords from task title + description for relevance scoring
        raw_text = f'{task_title} {task_description}'.lower()
        # Remove common stop words and short tokens, keep meaningful keywords
        stop_words = {
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
            'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'and',
            'but', 'or', 'not', 'no', 'so', 'if', 'then', 'than', 'that', 'this',
            'it', 'its', 'all', 'each', 'any', 'both', 'few', 'more', 'most',
            'other', 'some', 'such', 'only', 'same', 'also', 'just', 'about',
            'local', 'repo', 'path', 'file', 'code', 'task', 'new', 'add', 'fix',
        }
        keywords = [
            w for w in re.findall(r'[a-z_][a-z0-9_]*', raw_text)
            if len(w) > 2 and w not in stop_words
        ]

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

        # Score each file by keyword matches in filename and content preview
        scored: list[tuple[Path, int, float]] = []
        for f, size in all_files:
            rel_path_lower = str(f.relative_to(root)).lower()
            score = 0.0
            for kw in keywords:
                # Filename matches are worth more than content matches
                if kw in rel_path_lower:
                    score += 3.0
            # Read first 500 chars for content-based scoring
            try:
                with open(f, 'r', errors='replace') as fh:
                    preview = fh.read(500).lower()
                for kw in keywords:
                    if kw in preview:
                        score += 1.0
            except Exception:
                pass
            scored.append((f, size, score))

        # Sort by relevance score descending, then by path for stability
        scored.sort(key=lambda x: (-x[2], str(x[0])))

        # Read files in relevance order, highest-scoring first within budget
        result: list[tuple[str, str]] = []
        total_chars = 0
        max_total = self.settings.max_context_chars
        for f, _size, _score in scored:
            try:
                content = f.read_text(errors='replace')
                if total_chars + len(content) > max_total:
                    continue
                rel = str(f.relative_to(root))
                result.append((rel, content))
                total_chars += len(content)
            except Exception:
                continue

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
