from __future__ import annotations

from typing import Any
from uuid import uuid4

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, FieldCondition, Filter, MatchValue, PointStruct, VectorParams

from core.settings import get_settings
from memory.base import MemoryStore


class QdrantMemoryStore(MemoryStore):
    def __init__(self) -> None:
        self.settings = get_settings()
        self.enabled = self.settings.qdrant_enabled
        self.client: AsyncQdrantClient | None = None
        self._embedding_cache: dict[str, list[float]] = {}

        if self.enabled:
            self.client = AsyncQdrantClient(
                url=self.settings.qdrant_url,
                api_key=self.settings.qdrant_api_key,
                prefer_grpc=False,
            )

    async def ensure_collection(self) -> None:
        if not self.enabled or not self.client:
            return
        collections = await self.client.get_collections()
        names = {item.name for item in collections.collections}
        if self.settings.qdrant_collection not in names:
            await self.client.create_collection(
                collection_name=self.settings.qdrant_collection,
                vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
            )

    async def upsert_memory(
        self,
        key: str,
        input_text: str,
        output_text: str,
        *,
        organization_id: int | None = None,
    ) -> None:
        if not self.enabled or not self.client:
            return
        await self.ensure_collection()
        combined = f'{input_text}\n{output_text}'
        vector = self._get_or_create_embedding(combined)

        payload: dict[str, Any] = {'key': key, 'input': input_text, 'output': output_text}
        if organization_id is not None and organization_id > 0:
            payload['organization_id'] = int(organization_id)

        point = PointStruct(
            id=str(uuid4()),
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
    ) -> list[dict[str, Any]]:
        if not self.enabled or not self.client:
            return []
        await self.ensure_collection()
        vector = self._get_or_create_embedding(query)
        query_filter: Filter | None = None
        if organization_id is not None and organization_id > 0:
            query_filter = Filter(
                must=[
                    FieldCondition(
                        key='organization_id',
                        match=MatchValue(value=int(organization_id)),
                    )
                ]
            )
        results = await self.client.search(
            collection_name=self.settings.qdrant_collection,
            query_vector=vector,
            limit=limit,
            query_filter=query_filter,
        )
        return [result.payload for result in results if result.payload]

    async def get_status(self) -> dict[str, Any]:
        if not self.enabled:
            return {
                'enabled': False,
                'backend': 'qdrant',
                'collection': self.settings.qdrant_collection,
                'embedding_mode': 'deterministic_placeholder',
                'notes': 'Memory is disabled (QDRANT_ENABLED=false).',
            }
        if not self.client:
            return {
                'enabled': False,
                'backend': 'qdrant',
                'collection': self.settings.qdrant_collection,
                'embedding_mode': 'deterministic_placeholder',
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
            'embedding_mode': 'deterministic_placeholder',
            'vector_size': 1536,
            'distance': 'cosine',
            'tenant_filtering': 'organization_id payload filter',
            'points_count': int(points_count or 0),
            'vectors_count': int(vectors_count or 0),
            'url': self.settings.qdrant_url,
        }

    def _get_or_create_embedding(self, text: str) -> list[float]:
        if text in self._embedding_cache:
            return self._embedding_cache[text]

        emb = [float((ord(c) % 31) / 31.0) for c in text[:1536]]
        if len(emb) < 1536:
            emb.extend([0.0] * (1536 - len(emb)))
        emb = emb[:1536]
        self._embedding_cache[text] = emb
        return emb
