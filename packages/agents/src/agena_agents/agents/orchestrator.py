from __future__ import annotations

from typing import Any

from agena_agents.agents.crewai_agents import CrewAIAgentRunner
from agena_agents.agents.langgraph_flow import OrchestrationState, build_graph
from agena_agents.memory.qdrant import QdrantMemoryStore
from agena_services.services.llm.provider import LLMProvider
from sqlalchemy.ext.asyncio import AsyncSession


class AgentOrchestrator:
    def __init__(
        self,
        llm_provider: LLMProvider | None = None,
        *,
        db: AsyncSession | None = None,
        memory_provider: str | None = None,
        memory_api_key: str | None = None,
        memory_base_url: str | None = None,
        memory_model: str | None = None,
    ) -> None:
        self.agents = CrewAIAgentRunner(llm_provider=llm_provider, db=db)
        self.memory_store = QdrantMemoryStore(
            embedding_provider=memory_provider,
            embedding_api_key=memory_api_key,
            embedding_base_url=memory_base_url,
            embedding_model=memory_model,
        )
        self.graph = build_graph(self)

    async def run(self, task: dict[str, Any]) -> OrchestrationState:
        state: OrchestrationState = {
            'task': task,
            'usage': {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0},
            'model_usage': [],
        }
        return await self.graph.ainvoke(state)

    async def fetch_context_node(self, state: OrchestrationState) -> OrchestrationState:
        task = state['task']
        org_id = int(task.get('organization_id', 0) or 0) or None
        memory_status = await self.memory_store.get_status()
        memory_context = await self.memory_store.search_similar(
            query=f"{task.get('title', '')}\n{task.get('description', '')}",
            limit=3,
            organization_id=org_id,
        )
        context_summary, usage, model = await self.agents.fetch_context(task_payload=task, memory_context=memory_context)
        # Extract source files from task description and append to context_summary
        desc = task.get('description', '')
        if '=== RELEVANT SOURCE FILES ===' in desc:
            start = desc.index('=== RELEVANT SOURCE FILES ===')
            end_marker = '=== END SOURCE FILES ==='
            end = desc.index(end_marker) + len(end_marker) if end_marker in desc else len(desc)
            context_summary = context_summary + '\n\n' + desc[start:end]
        self._merge_usage(state, usage)
        state['memory_context'] = memory_context
        state['memory_status'] = memory_status
        state['context_summary'] = context_summary
        state['model_usage'].append(model)
        return state

    async def analyze_node(self, state: OrchestrationState) -> OrchestrationState:
        spec, usage, model = await self.agents.run_product_manager(
            state['task'],
            context_summary=state.get('context_summary', ''),
        )
        self._merge_usage(state, usage)
        state['spec'] = spec
        state['model_usage'].append(model)
        return state

    async def generate_code_node(self, state: OrchestrationState) -> OrchestrationState:
        spec = state.get('spec', {})
        desc = state.get('task', {}).get('description', '')
        ctx = state.get('context_summary', '')
        run_mode = state.get('mode', 'flow')

        generated_code, usage, model = await self.agents.run_developer(
            spec=spec,
            context_summary=ctx,
            task_description=desc,
            target_files_context=ctx,
            direct_mode=(run_mode == 'ai'),
        )
        self._merge_usage(state, usage)
        state['generated_code'] = generated_code
        state['model_usage'].append(model)
        return state

    async def review_code_node(self, state: OrchestrationState) -> OrchestrationState:
        reviewed_code, usage, model = await self.agents.run_reviewer(
            generated_code=state['generated_code'],
            spec=state['spec'],
            context_summary=state.get('context_summary', ''),
        )
        self._merge_usage(state, usage)
        state['reviewed_code'] = reviewed_code
        state['model_usage'].append(model)
        return state

    async def finalize_node(self, state: OrchestrationState) -> OrchestrationState:
        final_code, usage, model = await self.agents.finalize(state['reviewed_code'])
        self._merge_usage(state, usage)
        state['final_code'] = final_code
        state['model_usage'].append(model)

        task = state['task']
        await self.memory_store.upsert_memory(
            key=str(task.get('id', '')),
            input_text=f"{task.get('title', '')}\n{task.get('description', '')}",
            output_text=final_code,
            organization_id=int(task.get('organization_id', 0) or 0) or None,
        )
        return state

    def _read_spec_target_files(self, spec: dict, description: str) -> str:
        """Read full contents of files referenced in PM spec file_changes."""
        import re
        from pathlib import Path

        # Extract local repo path from description
        local_repo = ''
        for line in description.splitlines():
            if line.strip().startswith('Local Repo Path:'):
                local_repo = line.split(':', 1)[1].strip()
                break
        if not local_repo:
            return ''

        root = Path(local_repo).expanduser().resolve()
        if not root.is_dir():
            return ''

        # Collect file paths from spec.file_changes
        target_paths: list[str] = []
        for fc in spec.get('file_changes', []):
            fp = str(fc.get('file', '')).strip()
            if fp:
                target_paths.append(fp)

        # Also extract file paths from spec.technical_notes
        for note in spec.get('technical_notes', []):
            for match in re.findall(r'[\w/]+\.\w{1,6}', str(note)):
                if match not in target_paths:
                    target_paths.append(match)

        if not target_paths:
            return ''

        lines = ['=== TARGET FILES (full contents for modification) ===']
        total = 0
        max_total = 500000  # large models handle 200K+ tokens
        for rel in target_paths:
            fp = root / rel
            if not fp.is_file():
                lines.append(f'\n--- {rel} (not found) ---')
                continue
            try:
                content = fp.read_text(errors='replace')
                if total + len(content) > max_total:
                    lines.append(f'\n--- {rel} ({len(content)} chars, skipped — budget reached) ---')
                    continue
                lines.append(f'\n--- {rel} ({len(content)} chars) ---')
                lines.append(content)
                total += len(content)
            except Exception:
                lines.append(f'\n--- {rel} (read error) ---')
        lines.append('=== END TARGET FILES ===')
        return '\n'.join(lines)

    def _merge_usage(self, state: OrchestrationState, usage: dict[str, int]) -> None:
        current = state.get('usage', {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0})
        current['prompt_tokens'] = int(current.get('prompt_tokens', 0) + usage.get('prompt_tokens', 0))
        current['completion_tokens'] = int(current.get('completion_tokens', 0) + usage.get('completion_tokens', 0))
        current['total_tokens'] = int(current.get('total_tokens', 0) + usage.get('total_tokens', 0))
        state['usage'] = current
