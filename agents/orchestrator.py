from __future__ import annotations

from typing import Any

from agents.crewai_agents import CrewAIAgentRunner
from agents.langgraph_flow import OrchestrationState, build_graph
from memory.qdrant import QdrantMemoryStore
from services.llm.provider import LLMProvider


class AgentOrchestrator:
    def __init__(
        self,
        llm_provider: LLMProvider | None = None,
        *,
        memory_provider: str | None = None,
        memory_api_key: str | None = None,
        memory_base_url: str | None = None,
        memory_model: str | None = None,
    ) -> None:
        self.agents = CrewAIAgentRunner(llm_provider=llm_provider)
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
        generated_code, usage, model = await self.agents.run_developer(
            spec=state['spec'],
            context_summary=state.get('context_summary', ''),
        )
        self._merge_usage(state, usage)
        state['generated_code'] = generated_code
        state['model_usage'].append(model)
        return state

    async def review_code_node(self, state: OrchestrationState) -> OrchestrationState:
        reviewed_code, usage, model = await self.agents.run_reviewer(
            generated_code=state['generated_code'],
            spec=state['spec'],
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

    def _merge_usage(self, state: OrchestrationState, usage: dict[str, int]) -> None:
        current = state.get('usage', {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0})
        current['prompt_tokens'] = int(current.get('prompt_tokens', 0) + usage.get('prompt_tokens', 0))
        current['completion_tokens'] = int(current.get('completion_tokens', 0) + usage.get('completion_tokens', 0))
        current['total_tokens'] = int(current.get('total_tokens', 0) + usage.get('total_tokens', 0))
        state['usage'] = current
