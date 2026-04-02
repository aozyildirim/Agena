from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, StateGraph


class OrchestrationState(TypedDict, total=False):
    task: dict
    memory_context: list[dict]
    memory_status: dict
    context_summary: str
    spec: dict
    generated_code: str
    reviewed_code: str
    final_code: str
    usage: dict[str, int]
    model_usage: list[str]


def build_graph(orchestrator: 'AgentOrchestrator'):
    graph = StateGraph(OrchestrationState)

    graph.add_node('fetch_context', orchestrator.fetch_context_node)
    graph.add_node('analyze', orchestrator.analyze_node)
    graph.add_node('generate_code', orchestrator.generate_code_node)

    graph.set_entry_point('fetch_context')
    graph.add_edge('fetch_context', 'analyze')
    graph.add_edge('analyze', 'generate_code')
    graph.add_edge('generate_code', END)

    return graph.compile()
