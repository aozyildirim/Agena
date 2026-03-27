from __future__ import annotations

from typing import Any
from uuid import uuid4

import httpx
from openai import AsyncOpenAI
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, FieldCondition, Filter, MatchValue, PointStruct, VectorParams

from core.settings import get_settings
from memory.base import MemoryStore

EMBEDDING_VECTOR_SIZE = 1536


class QdrantMemoryStore(MemoryStore):
    def __init__(
        self,
        *,
        embedding_provider: str | None = None,
        embedding_api_key: str | None = None,
        embedding_base_url: str | None = None,
        embedding_model: str | None = None,
    ) -> None:
        self.settings = get_settings()
        self.enabled = self.settings.qdrant_enabled
        self.client: AsyncQdrantClient | None = None
        self._embedding_cache: dict[str, list[float]] = {}
        self.embedding_provider = (embedding_provider or self.settings.qdrant_embedding_provider or 'openai').strip().lower()
        self.embedding_api_key = (embedding_api_key or '').strip()
        self.embedding_base_url = (embedding_base_url or '').strip()
        self.embedding_model = (embedding_model or '').strip()
        self._openai_embedding_client: AsyncOpenAI | None = None

        if self.enabled:
            self.client = AsyncQdrantClient(
                url=self.settings.qdrant_url,
                api_key=self.settings.qdrant_api_key,
                prefer_grpc=False,
            )
        self._configure_embedding_client()

    def _configure_embedding_client(self) -> None:
        if self.embedding_provider not in {'openai', 'gemini'}:
            self.embedding_provider = 'openai'
        if not self.embedding_model:
            if self.embedding_provider == 'gemini':
                self.embedding_model = self.settings.qdrant_gemini_embedding_model
            else:
                self.embedding_model = self.settings.qdrant_openai_embedding_model
        if not self.embedding_api_key and self.embedding_provider == 'openai':
            self.embedding_api_key = (self.settings.openai_api_key or '').strip()
            self.embedding_base_url = self.embedding_base_url or (self.settings.openai_base_url or '').strip()
        if not self.embedding_api_key and self.embedding_provider == 'gemini':
            self.embedding_api_key = (self.settings.qdrant_gemini_api_key or '').strip()
        if self.embedding_provider == 'openai':
            api_key = (self.embedding_api_key or '').strip()
            if api_key and not api_key.startswith('your_'):
                import os as _os
                _ssl_verify = _os.getenv('SSL_VERIFY', 'true').strip().lower() not in ('false', '0', 'no')
                self._openai_embedding_client = AsyncOpenAI(
                    api_key=api_key,
                    base_url=self.embedding_base_url or None,
                    http_client=httpx.AsyncClient(verify=_ssl_verify),
                )

    async def ensure_collection(self) -> None:
        if not self.enabled or not self.client:
            return
        collections = await self.client.get_collections()
        names = {item.name for item in collections.collections}
        if self.settings.qdrant_collection not in names:
            await self.client.create_collection(
                collection_name=self.settings.qdrant_collection,
                vectors_config=VectorParams(size=EMBEDDING_VECTOR_SIZE, distance=Distance.COSINE),
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
        vector = await self._get_or_create_embedding(input_text)

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
        vector = await self._get_or_create_embedding(query)
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

    async def get_status(self) -> dict[str, Any]:
        mode = self._embedding_mode_label()
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
            'vector_size': EMBEDDING_VECTOR_SIZE,
            'distance': 'cosine',
            'tenant_filtering': 'organization_id payload filter',
            'points_count': int(points_count or 0),
            'vectors_count': int(vectors_count or 0),
            'url': self.settings.qdrant_url,
        }

    def _embedding_mode_label(self) -> str:
        if self._real_embedding_configured():
            return f'{self.embedding_provider}:{self.embedding_model}'
        return 'deterministic_placeholder'

    def _real_embedding_configured(self) -> bool:
        api_key = (self.embedding_api_key or '').strip()
        return bool(api_key and not api_key.startswith('your_'))

    async def _get_or_create_embedding(self, text: str) -> list[float]:
        if text in self._embedding_cache:
            return self._embedding_cache[text]

        emb = await self._generate_embedding(text)
        self._embedding_cache[text] = emb
        return emb

    async def _generate_embedding(self, text: str) -> list[float]:
        if self._real_embedding_configured():
            try:
                if self.embedding_provider == 'gemini':
                    emb = await self._generate_gemini_embedding(text)
                else:
                    emb = await self._generate_openai_embedding(text)
                if emb:
                    return self._normalize_vector(emb)
            except Exception:
                # Memory retrieval should not break task orchestration.
                pass
        return self._deterministic_placeholder_embedding(text)

    async def _generate_openai_embedding(self, text: str) -> list[float]:
        if self._openai_embedding_client is None:
            return []
        response = await self._openai_embedding_client.embeddings.create(
            model=self.embedding_model or self.settings.qdrant_openai_embedding_model,
            input=text,
        )
        data = getattr(response, 'data', None) or []
        if not data:
            return []
        vec = getattr(data[0], 'embedding', None)
        if not vec:
            return []
        return [float(v) for v in vec]

    async def _generate_gemini_embedding(self, text: str) -> list[float]:
        base = (self.embedding_base_url or 'https://generativelanguage.googleapis.com').rstrip('/')
        model = self.embedding_model or self.settings.qdrant_gemini_embedding_model
        url = f'{base}/v1beta/models/{model}:embedContent?key={self.embedding_api_key}'
        payload = {
            'model': f'models/{model}',
            'content': {'parts': [{'text': text}]},
            'outputDimensionality': EMBEDDING_VECTOR_SIZE,
        }
        async with httpx.AsyncClient(timeout=self.settings.qdrant_embedding_timeout_sec) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
        values = ((data.get('embedding') or {}).get('values') or [])
        return [float(v) for v in values]

    def _normalize_vector(self, raw: list[float]) -> list[float]:
        vec = [float(v) for v in raw[:EMBEDDING_VECTOR_SIZE]]
        if len(vec) < EMBEDDING_VECTOR_SIZE:
            vec.extend([0.0] * (EMBEDDING_VECTOR_SIZE - len(vec)))
        return vec

    def _deterministic_placeholder_embedding(self, text: str) -> list[float]:
        emb = [float((ord(c) % 31) / 31.0) for c in text[:EMBEDDING_VECTOR_SIZE]]
        if len(emb) < EMBEDDING_VECTOR_SIZE:
            emb.extend([0.0] * (EMBEDDING_VECTOR_SIZE - len(emb)))
        return emb[:EMBEDDING_VECTOR_SIZE]
