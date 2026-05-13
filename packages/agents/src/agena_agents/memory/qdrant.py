from __future__ import annotations

import uuid
from typing import Any

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, FieldCondition, Filter, MatchValue, PointStruct, VectorParams

from agena_core.settings import get_settings
from agena_agents.memory.base import MemoryStore
from agena_agents.memory.local_embedder import EMBEDDING_DIM, EMBEDDING_MODEL, embed_texts


class QdrantMemoryStore(MemoryStore):
    """Task-memory store backed by Qdrant + a local multilingual embedder.

    Previously this class talked to OpenAI / Gemini for embeddings, but
    free-tier rate limits made bulk indexing impractical. Everything now
    runs through `local_embedder` (fastembed MiniLM, 384-dim, CPU,
    multilingual). The collection is auto-recreated if the stored vectors
    have a different dimension than the current model — useful when the
    embedder changes.
    """

    def __init__(self, **_unused_kwargs: Any) -> None:
        # Kwargs are accepted (and ignored) for backwards compatibility
        # with callers that used to override embedding_provider/api_key.
        self.settings = get_settings()
        self.enabled = self.settings.qdrant_enabled
        self.client: AsyncQdrantClient | None = None
        self._embedding_cache: dict[str, list[float]] = {}
        self.embedding_provider = 'local'
        self.embedding_model = EMBEDDING_MODEL

        if self.enabled:
            self.client = AsyncQdrantClient(
                url=self.settings.qdrant_url,
                api_key=self.settings.qdrant_api_key,
                prefer_grpc=False,
            )

    def _target_size(self) -> int:
        return EMBEDDING_DIM

    async def ensure_collection(self) -> None:
        if not self.enabled or not self.client:
            return
        target_size = self._target_size()
        collections = await self.client.get_collections()
        names = {item.name for item in collections.collections}
        name = self.settings.qdrant_collection
        if name not in names:
            await self.client.create_collection(
                collection_name=name,
                vectors_config=VectorParams(size=target_size, distance=Distance.COSINE),
            )
            return
        try:
            info = await self.client.get_collection(name)
            current_size = None
            vectors = getattr(info.config.params, 'vectors', None)
            if vectors is not None:
                current_size = getattr(vectors, 'size', None)
            if current_size and int(current_size) != target_size:
                import logging as _l
                _l.getLogger(__name__).warning(
                    'Qdrant collection %s has vector size %s but local model expects %s; recreating.',
                    name, current_size, target_size,
                )
                await self.client.delete_collection(collection_name=name)
                await self.client.create_collection(
                    collection_name=name,
                    vectors_config=VectorParams(size=target_size, distance=Distance.COSINE),
                )
        except Exception:
            pass

    async def upsert_memory(
        self,
        key: str,
        input_text: str,
        output_text: str,
        *,
        organization_id: int | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        if not self.enabled or not self.client:
            return
        await self.ensure_collection()
        vector = await self._get_or_create_embedding(input_text)

        payload: dict[str, Any] = {'key': key, 'input': input_text, 'output': output_text}
        if organization_id is not None and organization_id > 0:
            payload['organization_id'] = int(organization_id)
        if extra:
            for k, v in extra.items():
                if k in payload:
                    continue
                if v is None:
                    continue
                payload[k] = v

        point = PointStruct(
            id=str(uuid.uuid5(uuid.NAMESPACE_DNS, f'task-{key}')),
            vector=vector,
            payload=payload,
        )
        await self.client.upsert(collection_name=self.settings.qdrant_collection, points=[point])

    async def search_similar(
        self,
        query: str,
        limit: int = 3,
        *,
        organization_id: int | None = None,
        extra_filters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        if not self.enabled or not self.client:
            return []
        await self.ensure_collection()
        vector = await self._get_or_create_embedding(query)
        must: list[FieldCondition] = []
        if organization_id is not None and organization_id > 0:
            must.append(
                FieldCondition(
                    key='organization_id',
                    match=MatchValue(value=int(organization_id)),
                )
            )
        if extra_filters:
            for fk, fv in extra_filters.items():
                if fv is None:
                    continue
                must.append(FieldCondition(key=str(fk), match=MatchValue(value=fv)))
        query_filter = Filter(must=must) if must else None
        results = await self.client.search(
            collection_name=self.settings.qdrant_collection,
            query_vector=vector,
            limit=limit,
            query_filter=query_filter,
        )
        rows: list[dict[str, Any]] = []
        for result in results:
            payload = result.payload
            if not payload:
                continue
            row = dict(payload)
            score = getattr(result, 'score', None)
            if score is not None:
                try:
                    row['_score'] = float(score)
                except Exception:
                    pass
            rows.append(row)
        return rows

    async def scroll_by_filters(
        self,
        *,
        organization_id: int | None = None,
        extra_filters: dict[str, Any] | None = None,
        limit: int = 10000,
    ) -> list[dict[str, Any]]:
        if not self.enabled or not self.client:
            return []
        await self.ensure_collection()
        must: list[FieldCondition] = []
        if organization_id is not None and organization_id > 0:
            must.append(
                FieldCondition(key='organization_id', match=MatchValue(value=int(organization_id)))
            )
        if extra_filters:
            for fk, fv in extra_filters.items():
                if fv is None:
                    continue
                must.append(FieldCondition(key=str(fk), match=MatchValue(value=fv)))
        query_filter = Filter(must=must) if must else None

        rows: list[dict[str, Any]] = []
        next_page: Any = None
        per_page = min(max(int(limit) if limit else 1000, 100), 1000)
        while True:
            batch, next_page = await self.client.scroll(
                collection_name=self.settings.qdrant_collection,
                scroll_filter=query_filter,
                limit=per_page,
                offset=next_page,
                with_payload=True,
                with_vectors=False,
            )
            for point in batch:
                if point.payload:
                    rows.append(dict(point.payload))
            if next_page is None:
                break
            if limit and len(rows) >= limit:
                break
        return rows[: limit] if limit else rows

    async def count_by_filters(
        self,
        *,
        organization_id: int | None = None,
        extra_filters: dict[str, Any] | None = None,
    ) -> int:
        if not self.enabled or not self.client:
            return 0
        await self.ensure_collection()
        must: list[FieldCondition] = []
        if organization_id is not None and organization_id > 0:
            must.append(
                FieldCondition(key='organization_id', match=MatchValue(value=int(organization_id)))
            )
        if extra_filters:
            for fk, fv in extra_filters.items():
                if fv is None:
                    continue
                must.append(FieldCondition(key=str(fk), match=MatchValue(value=fv)))
        query_filter = Filter(must=must) if must else None
        try:
            result = await self.client.count(
                collection_name=self.settings.qdrant_collection,
                count_filter=query_filter,
                exact=True,
            )
            return int(getattr(result, 'count', 0) or 0)
        except Exception:
            return 0

    async def get_status(self) -> dict[str, Any]:
        mode = f'local:{EMBEDDING_MODEL}'
        if not self.enabled:
            return {
                'enabled': False,
                'backend': 'qdrant',
                'collection': self.settings.qdrant_collection,
                'embedding_mode': mode,
                'notes': 'Memory is disabled (QDRANT_ENABLED=false).',
            }
        if not self.client:
            return {
                'enabled': False,
                'backend': 'qdrant',
                'collection': self.settings.qdrant_collection,
                'embedding_mode': mode,
                'notes': 'Qdrant client is not initialized.',
            }
        await self.ensure_collection()
        info = await self.client.get_collection(self.settings.qdrant_collection)
        points_count = getattr(info, 'points_count', None)
        vectors_count = getattr(info, 'vectors_count', None)
        return {
            'enabled': True,
            'backend': 'qdrant',
            'collection': self.settings.qdrant_collection,
            'embedding_mode': mode,
            'vector_size': EMBEDDING_DIM,
            'distance': 'cosine',
            'tenant_filtering': 'organization_id payload filter',
            'points_count': int(points_count or 0),
            'vectors_count': int(vectors_count or 0),
            'url': self.settings.qdrant_url,
        }

    async def _get_or_create_embedding(self, text: str) -> list[float]:
        if text in self._embedding_cache:
            return self._embedding_cache[text]
        vectors = await embed_texts([text])
        emb = vectors[0] if vectors else [0.0] * EMBEDDING_DIM
        self._embedding_cache[text] = emb
        return emb
