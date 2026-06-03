"""Shared local-embedder singleton. Both QdrantMemoryStore (task memory)
and RepoFileIndexer (repo file shortlist) embed through here, so they
share one in-memory copy of the model.

Model: sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
- 384-dim cosine, ~120MB on disk, ~50ms per text on CPU
- Multilingual (TR/EN/RU/etc.) — chosen because the user base writes
  task descriptions in mixed languages and we want sane retrieval
  across all of them.

The fastembed model file is cached under ~/.cache/fastembed, which the
worker container persists via a named volume so the download only
happens once on a given host.
"""

from __future__ import annotations

import asyncio
import logging
import os

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = 'BAAI/bge-small-en-v1.5'
EMBEDDING_DIM = 384
# Pin the cache to a path the docker-compose volume mounts so the
# ~120MB MiniLM weights survive container recreates.
EMBEDDING_CACHE_DIR = os.environ.get('FASTEMBED_CACHE_DIR', '/root/.cache/fastembed')

_FASTEMBED_MODEL = None


def _get_model():
    global _FASTEMBED_MODEL
    if _FASTEMBED_MODEL is None:
        from fastembed import TextEmbedding
        os.makedirs(EMBEDDING_CACHE_DIR, exist_ok=True)
        _FASTEMBED_MODEL = TextEmbedding(
            model_name=EMBEDDING_MODEL,
            cache_dir=EMBEDDING_CACHE_DIR,
        )
    return _FASTEMBED_MODEL


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed one or more texts. Returns one vector per input.

    fastembed is sync, so we run it in a thread pool to keep the
    asyncio loop responsive. On failure returns an empty list.
    """
    if not texts:
        return []

    def _run() -> list[list[float]]:
        model = _get_model()
        return [list(v) for v in model.embed(texts)]

    try:
        return await asyncio.to_thread(_run)
    except Exception as exc:
        logger.warning('local_embedder failed: %s', exc)
        return []
