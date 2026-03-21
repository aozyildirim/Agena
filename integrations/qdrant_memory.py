from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from core.settings import get_settings

logger = logging.getLogger(__name__)


class QdrantMemoryStore:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.enabled = self.settings.qdrant_enabled
        self.client: AsyncQdrantClient | None = None

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

    async def upsert_memory(self, task_id: str, task_text: str, solution_text: str) -> None:
        if not self.enabled or not self.client:
            return
        await self.ensure_collection()

        vector = self._fake_embedding(task_text + '\n' + solution_text)
        point = PointStruct(
            id=str(uuid4()),
            vector=vector,
            payload={'task_id': task_id, 'task': task_text, 'solution': solution_text},
        )
        await self.client.upsert(collection_name=self.settings.qdrant_collection, points=[point])

    async def search_similar(self, query: str, limit: int = 3) -> list[dict[str, Any]]:
        if not self.enabled or not self.client:
            return []
        await self.ensure_collection()

        results = await self.client.search(
            collection_name=self.settings.qdrant_collection,
            query_vector=self._fake_embedding(query),
            limit=limit,
        )
        return [r.payload for r in results if r.payload]

    def _fake_embedding(self, text: str) -> list[float]:
        # Placeholder embedding so the module remains optional and dependency-light.
        base = [float((ord(char) % 31) / 31.0) for char in text[:1536]]
        if len(base) < 1536:
            base.extend([0.0] * (1536 - len(base)))
        return base[:1536]
