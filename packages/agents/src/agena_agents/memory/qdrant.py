from __future__ import annotations

import uuid
from typing import Any

import httpx
from openai import AsyncOpenAI
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, FieldCondition, Filter, MatchValue, PointStruct, VectorParams

from agena_core.settings import get_settings
from agena_agents.memory.base import MemoryStore

# Default vector size; overridden by _vector_size_for_model() below.
EMBEDDING_VECTOR_SIZE = 1536


def _vector_size_for_model(model: str) -> int:
    """OpenAI embedding dims:
    - text-embedding-3-small: 1536
    - text-embedding-3-large: 3072
    - text-embedding-ada-002 (legacy): 1536
    Gemini text-embedding-004 is 768 by default but we request 1536 via
    outputDimensionality.
    """
    m = (model or '').strip().lower()
    if 'large' in m:
        return 3072
    return 1536


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
        target_size = _vector_size_for_model(self.embedding_model or self.settings.qdrant_openai_embedding_model)
        collections = await self.client.get_collections()
        names = {item.name for item in collections.collections}
        name = self.settings.qdrant_collection
        if name not in names:
            await self.client.create_collection(
                collection_name=name,
                vectors_config=VectorParams(size=target_size, distance=Distance.COSINE),
            )
            return
        # Detect dimension mismatch (e.g. after switching from
        # text-embedding-3-small → text-embedding-3-large). If the existing
        # collection has the wrong vector size, recreate it. Points will be
        # re-inserted on the next backfill.
        try:
            info = await self.client.get_collection(name)
            current_size = None
            vectors = getattr(info.config.params, 'vectors', None)
            if vectors is not None:
                current_size = getattr(vectors, 'size', None)
            if current_size and int(current_size) != target_size:
                import logging as _l
                _l.getLogger(__name__).warning(
                    'Qdrant collection %s has vector size %s but model %s expects %s; recreating.',
                    name, current_size, self.embedding_model, target_size,
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
        """Page through every point matching org + filters. Used for the
        refinement history preview — we need to enumerate all points, not
        nearest-neighbor search."""
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
        """Exact count of points matching org + filters. Uses Qdrant's
        count API (server-side aggregate) so we don't have to scroll."""
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
            'vector_size': self._target_size(),
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
            'outputDimensionality': self._target_size(),
        }
        async with httpx.AsyncClient(timeout=self.settings.qdrant_embedding_timeout_sec) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
        values = ((data.get('embedding') or {}).get('values') or [])
        return [float(v) for v in values]

    def _target_size(self) -> int:
        return _vector_size_for_model(self.embedding_model or self.settings.qdrant_openai_embedding_model)

    def _normalize_vector(self, raw: list[float]) -> list[float]:
        size = self._target_size()
        vec = [float(v) for v in raw[:size]]
        if len(vec) < size:
            vec.extend([0.0] * (size - len(vec)))
        return vec

    def _deterministic_placeholder_embedding(self, text: str) -> list[float]:
        size = self._target_size()
        emb = [float((ord(c) % 31) / 31.0) for c in text[:size]]
        if len(emb) < size:
            emb.extend([0.0] * (size - len(emb)))
        return emb[:size]
