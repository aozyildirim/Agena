from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_agents.memory.qdrant import QdrantMemoryStore

router = APIRouter(prefix='/memory', tags=['memory'])


class MemoryStatusResponse(BaseModel):
    enabled: bool
    backend: str
    collection: str
    embedding_mode: str
    vector_size: int | None = None
    distance: str | None = None
    tenant_filtering: str | None = None
    points_count: int | None = None
    vectors_count: int | None = None
    url: str | None = None
    notes: str | None = None


class MemoryKindEntry(BaseModel):
    kind: str
    label: str
    description: str
    embed_recipe: str
    written_by: list[str]
    read_by: list[str]
    payload_keys: list[str]
    points_count: int


class MemorySchemaResponse(BaseModel):
    purpose: str
    what_is_stored: dict[str, str]
    retrieval_flow: list[str]
    constraints: list[str]
    privacy_scope: str
    kinds: list[MemoryKindEntry]


_KIND_DEFS: list[dict[str, Any]] = [
    {
        'kind': 'completed_task',
        'label': 'Refinement history (Azure / Jira)',
        'description': (
            'Closed work items with final story points, branches and PR titles. '
            'Used to ground SP estimates and surface "kim daha önce yaptı" context.'
        ),
        'embed_recipe': '{title}\\n\\n{clean_html(description)[:1500]}\\n\\nBranches: ...\\nPull Requests: ...',
        'written_by': [
            'RefinementHistoryIndexer.index_completed_item (Backfill button)',
        ],
        'read_by': [
            'RefinementService._fetch_similar_past (SP grounding)',
            '/refinement/debug-search (diagnostic)',
        ],
        'payload_keys': [
            'external_id', 'title', 'story_points', 'assigned_to',
            'work_item_type', 'state', 'sprint_name', 'sprint_path',
            'branches', 'pr_titles', 'pr_count', 'commit_count',
            'completed_at', 'created_at', 'url', 'source',
        ],
    },
    {
        'kind': 'skill',
        'label': 'Team Skill Catalog',
        'description': (
            'Curated patterns / lessons-learned (httpx pagination, idempotent migrations, '
            'multi-tenant scoping, ...). Injected into agent prompts before code generation.'
        ),
        'embed_recipe': '{name}\\n{description}\\n{approach_summary}\\n\\nFiles: {touched_files}',
        'written_by': [
            'SkillService.create / .update (every CRUD)',
            '/skills/import-defaults (seed 9 curated)',
        ],
        'read_by': [
            'SkillService.find_relevant (tier=strong/related → prompt fragment)',
            'SkillService.format_for_prompt (PM analyse + Developer planner)',
        ],
        'payload_keys': [
            'skill_id', 'name', 'pattern_type', 'tags', 'touched_files',
        ],
    },
    {
        'kind': '<agent_run>',
        'label': 'Agent task memory (no kind tag)',
        'description': (
            'Final code output of every completed orchestration task (LangGraph finalize_node). '
            'Used by fetch_context to recall similar prior solutions when a new task starts.'
        ),
        'embed_recipe': '{task.title}\\n{task.description}',
        'written_by': [
            'CodeOrchestrator.finalize_node (after every task completes)',
        ],
        'read_by': [
            'CodeOrchestrator.fetch_context_node (top-3, prepended to prompt)',
            'OrchestrationService remote-mode pre-flight memory search',
        ],
        'payload_keys': [
            'key', 'input', 'output', 'organization_id',
        ],
    },
]


@router.get(
    '/status',
    response_model=MemoryStatusResponse,
    summary='Memory backend status',
    description=(
        'Shows Qdrant vector memory backend status used by the fetch_context stage. '
        'Useful to verify whether memory is enabled, which collection is used, and current vector counts.'
    ),
)
async def memory_status(
    tenant: CurrentTenant = Depends(get_current_tenant),
) -> MemoryStatusResponse:
    _ = tenant  # explicit auth guard
    store = QdrantMemoryStore()
    status = await store.get_status()
    return MemoryStatusResponse(**status)


@router.get(
    '/schema',
    response_model=MemorySchemaResponse,
    summary='Memory payload schema and usage',
    description=(
        'Documents what is stored in Qdrant memory payloads, how retrieval is performed, '
        'and where memory is injected into orchestration prompts. Includes live per-kind counts '
        'scoped to the current tenant.'
    ),
)
async def memory_schema(
    tenant: CurrentTenant = Depends(get_current_tenant),
) -> MemorySchemaResponse:
    store = QdrantMemoryStore()

    # Live per-kind counts (tenant-scoped). The `<agent_run>` bucket has no
    # `kind` payload tag — we approximate it as "everything for this org
    # that has neither kind=completed_task nor kind=skill" by subtracting.
    kinds_out: list[MemoryKindEntry] = []
    total_org = await store.count_by_filters(organization_id=tenant.organization_id)
    tagged_total = 0
    for spec in _KIND_DEFS:
        if spec['kind'].startswith('<'):
            continue  # placeholder bucket — fill below
        c = await store.count_by_filters(
            organization_id=tenant.organization_id,
            extra_filters={'kind': spec['kind']},
        )
        tagged_total += c
        kinds_out.append(MemoryKindEntry(
            kind=spec['kind'],
            label=spec['label'],
            description=spec['description'],
            embed_recipe=spec['embed_recipe'],
            written_by=spec['written_by'],
            read_by=spec['read_by'],
            payload_keys=spec['payload_keys'],
            points_count=c,
        ))
    # Append agent_run bucket with computed count
    agent_run_spec = next((s for s in _KIND_DEFS if s['kind'].startswith('<')), None)
    if agent_run_spec is not None:
        agent_run_count = max(0, total_org - tagged_total)
        kinds_out.append(MemoryKindEntry(
            kind=agent_run_spec['kind'],
            label=agent_run_spec['label'],
            description=agent_run_spec['description'],
            embed_recipe=agent_run_spec['embed_recipe'],
            written_by=agent_run_spec['written_by'],
            read_by=agent_run_spec['read_by'],
            payload_keys=agent_run_spec['payload_keys'],
            points_count=agent_run_count,
        ))

    return MemorySchemaResponse(
        purpose=(
            'Semantic recall layer for the AI pipeline. Vectors ground story-point '
            'estimates, surface prior solutions, and inject team-curated patterns '
            'into agent prompts before code generation.'
        ),
        what_is_stored={
            'collection': 'task_memory (single collection, partitioned by `kind` payload + `organization_id`).',
            'vector_size': '1536, cosine distance.',
            'embedding': 'OpenAI / Gemini provider (config), placeholder fallback if unkeyed.',
            'tenancy': 'Every point carries organization_id; every search filters on it.',
        },
        retrieval_flow=[
            'Refinement: title+description → search kind=completed_task → top-K + score-gap filter → SP grounding + similar-past panel',
            'Skills (per task start): title+description+files → search kind=skill → tier=strong/related → format_for_prompt → injected into PM/planner prompt',
            'Agent fetch_context: title+description → search untagged → top-3 prior outputs → memory_context block in analyze prompt',
        ],
        constraints=[
            'Embedding mode depends on the configured provider key; placeholder mode degrades quality silently.',
            'Vector size fixed at 1536 — cannot mix providers without a fresh collection.',
            'Set QDRANT_ENABLED=false to disable the entire memory layer (search returns []).',
            'Per-tenant counts shown below are live (qdrant count API, exact=true).',
        ],
        privacy_scope=(
            'Strict per-organization filtering on every read AND write. '
            "No cross-org leakage; scrolls / counts also filter on organization_id."
        ),
        kinds=kinds_out,
    )
