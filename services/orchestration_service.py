from __future__ import annotations

import difflib
import re
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from tenacity import retry, stop_after_attempt, wait_exponential

from agents.orchestrator import AgentOrchestrator
from core.settings import get_settings
from models.run_record import RunRecord
from models.task_record import TaskRecord
from schemas.agent import AgentRunResult, UsageStats
from schemas.github import CreatePRRequest, GitHubFileChange
from services.azure_pr_service import AzurePRService
from services.codex_cli_service import CodexCLIService
from services.github_service import GitHubService
from services.integration_config_service import IntegrationConfigService
from services.llm.cost_tracker import CostTracker
from services.local_repo_service import LocalRepoService
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


class OrchestrationService:
    def __init__(self, db_session: AsyncSession) -> None:
        self.settings = get_settings()
        self.db_session = db_session
        self.orchestrator = AgentOrchestrator()
        self.github_service = GitHubService()
        self.azure_pr_service = AzurePRService(db_session)
        self.codex_cli_service = CodexCLIService()
        self.local_repo_service = LocalRepoService()
        self.cost_tracker = CostTracker()

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8), reraise=True)
    async def run_task_record(self, organization_id: int, task_id: int, create_pr: bool = True) -> AgentRunResult:
        task = await self.db_session.get(TaskRecord, task_id)
        if task is None or task.organization_id != organization_id:
            raise ValueError('Task not found for organization')

        task_service = TaskService(self.db_session)
        usage_service = UsageService(self.db_session)
        run_started_at = datetime.utcnow()
        run_started_clock = time.perf_counter()

        task.status = 'running'
        await self.db_session.commit()
        await task_service.add_log(
            task.id,
            organization_id,
            'running',
            f'Agent pipeline started at {run_started_at.isoformat()}Z',
        )

        routing = self._extract_task_routing(task)
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
            task.story_context,
            task.acceptance_criteria,
            task.edge_cases,
        )
        payload = {
            'id': str(task.id),
            'title': task.title,
            'description': effective_description,
            'source': routing.effective_source,
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
                    final_code = await self.codex_cli_service.generate_file_markdown(
                        repo_path=routing.local_repo_path,
                        task_title=task.title,
                        task_description=effective_description,
                        model=routing.preferred_agent_model,
                        # For codex_cli we rely on codex auth.json session, not org OpenAI key.
                        # Restricted API keys may not have responses/model scopes and break execution.
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
            else:
                state = await self.orchestrator.run(payload)
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

            final_code = state.get('final_code', '')
            pr_url = None
            branch_name = None
            pr_payload = self._build_pr_payload(task=payload, reviewed_code=final_code)
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
                    remote_url=routing.azure_repo_url if routing.effective_source == 'azure' else None,
                    remote_pat=azure_remote_pat,
                )
                if not has_changes:
                    await task_service.add_log(task.id, organization_id, 'local_exec', 'No file changes detected, skipping PR')

                if create_pr and has_changes:
                    if routing.effective_source == 'azure' and routing.azure_project and routing.azure_repo_url:
                        pr_url = await self.azure_pr_service.create_pr(
                            organization_id,
                            project=routing.azure_project,
                            repo_url=routing.azure_repo_url,
                            source_branch=branch_name,
                            target_branch=pr_payload.base_branch,
                            title=pr_payload.title,
                            description=pr_payload.body,
                        )
                        await task_service.add_log(task.id, organization_id, 'pr', f'Azure PR created: {pr_url}')
                    else:
                        await task_service.add_log(
                            task.id,
                            organization_id,
                            'pr',
                            'Local push completed but PR target was not resolved from task mapping',
                        )
            elif create_pr and self._can_create_github_pr():
                branch_name = pr_payload.branch_name
                pr_url = await self.github_service.create_pr(pr_payload)
                await task_service.add_log(task.id, organization_id, 'pr', f'GitHub PR created: {pr_url}')
            elif create_pr:
                await task_service.add_log(task.id, organization_id, 'pr', 'PR skipped because provider configuration is missing')

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

            await usage_service.increment_tokens(organization_id, int(usage.get('total_tokens', 0)))
            run_finished_at = datetime.utcnow()
            duration_sec = round(time.perf_counter() - run_started_clock, 2)
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
            usage = state.get('usage', {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0})
            run_finished_at = datetime.utcnow()
            duration_sec = round(time.perf_counter() - run_started_clock, 2)
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
            raise

    def _build_pr_payload(self, task: dict[str, Any], reviewed_code: str) -> CreatePRRequest:
        branch_suffix = datetime.utcnow().strftime('%Y%m%d%H%M%S')
        safe_id = re.sub(r'[^a-zA-Z0-9_-]', '-', task.get('id', 'task'))
        branch_name = f'ai-task/{safe_id}-{branch_suffix}'

        parsed_files = self._parse_reviewed_output_to_files(reviewed_code)
        if not parsed_files:
            parsed_files = [
                GitHubFileChange(
                    path=f'generated/task_{safe_id}.md',
                    content=reviewed_code,
                )
            ]

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

    def _parse_reviewed_output_to_files(self, reviewed_code: str) -> list[GitHubFileChange]:
        file_pattern = re.compile(r'\*\*File:\s*(.*?)\*\*\n```[\w\n]*\n(.*?)```', re.DOTALL)
        matches = file_pattern.findall(reviewed_code)
        files: list[GitHubFileChange] = []
        for path, content in matches:
            files.append(GitHubFileChange(path=path.strip(), content=content.rstrip() + '\n'))
        return files

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

        return TaskRouting(
            effective_source=effective_source,
            external_source=external_source,
            azure_project=meta.get('project') or None,
            azure_repo_url=meta.get('azure repo') or None,
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

    def _is_mock_run(self, state: dict[str, Any]) -> bool:
        model_usage = state.get('model_usage') or []
        return any(str(model).startswith('mock-local') for model in model_usage)

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

    def _build_effective_description(
        self,
        base_description: str | None,
        execution_prompt: str | None,
        repo_playbook: str | None = None,
        tenant_playbook: str | None = None,
        story_context: str | None = None,
        acceptance_criteria: str | None = None,
        edge_cases: str | None = None,
    ) -> str:
        desc = (base_description or '').strip()
        prompt = (execution_prompt or '').strip()
        repo_rules = (repo_playbook or '').strip()
        playbook = (tenant_playbook or '').strip()
        story = (story_context or '').strip()
        criteria = (acceptance_criteria or '').strip()
        edges = (edge_cases or '').strip()
        chunks: list[str] = []
        if desc:
            chunks.append(desc)
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
