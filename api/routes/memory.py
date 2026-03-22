from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api.dependencies import CurrentTenant, get_current_tenant
from memory.qdrant import QdrantMemoryStore

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


class MemorySchemaResponse(BaseModel):
    purpose: str
    what_is_stored: dict[str, str]
    retrieval_flow: list[str]
    constraints: list[str]
    privacy_scope: str


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
        'and where memory is injected into orchestration prompts.'
    ),
)
async def memory_schema(
    tenant: CurrentTenant = Depends(get_current_tenant),
) -> MemorySchemaResponse:
    _ = tenant
    return MemorySchemaResponse(
        purpose='Semantic context recall for AI orchestration pipeline.',
        what_is_stored={
            'key': 'Task identifier for traceability.',
            'organization_id': 'Tenant scope for retrieval filtering.',
            'input': 'Task title + effective description snapshot.',
            'output': 'Finalized generated code output snapshot.',
        },
        retrieval_flow=[
            'Task starts in orchestrator.fetch_context',
            'Query vector built from current task title + description',
            'Top similar memories fetched from Qdrant with organization_id filter',
            'Memories summarized and injected into analyze/generate/review flow',
        ],
        constraints=[
            'Embedding mode depends on configured provider key (OpenAI/Gemini); placeholder mode is fallback.',
            'Vector size fixed at 1536, cosine distance.',
            'Memory can be disabled globally with QDRANT_ENABLED=false.',
        ],
        privacy_scope='Organization-scoped retrieval via organization_id payload filtering.',
    )
