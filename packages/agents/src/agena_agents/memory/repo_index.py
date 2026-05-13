"""Repo file indexer — embed file paths + head snippets into Qdrant so
orchestration can hand the CLI subagent a shortlist of relevant files
instead of letting it grep the whole repo on every task.

Uses fastembed (local, CPU-only multilingual model) so there is no API
cost and no rate limit. Model downloads once on first use (~400MB),
then ~50ms per embedding.

Indexing is lazy: a task's first run on a given repo walks the tree,
embeds every kept file, and upserts one point per file into a dedicated
`repo_files` Qdrant collection. Subsequent tasks reuse the index unless
the repo's HEAD sha has changed.
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import uuid
from pathlib import Path
from typing import Callable, Awaitable

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, FieldCondition, Filter, MatchValue, PointStruct, VectorParams

from agena_core.settings import get_settings
from agena_agents.memory.local_embedder import EMBEDDING_DIM, EMBEDDING_MODEL, embed_texts as _embed_texts

logger = logging.getLogger(__name__)

REPO_FILES_COLLECTION = 'repo_files'
MAX_FILE_BYTES = 500_000

# Azure DevOps and Jira often wrap task descriptions in <div>/<span>/
# `style=...` HTML. Embedding those tags drags the query toward .scss
# / .css / .twig files instead of the semantic content. Strip down to
# plain text before embedding the user-supplied task.
_HTML_TAG_RE = re.compile(r'<[^>]+>')
_HTML_ENTITY_RE = re.compile(r'&[a-zA-Z]+;|&#\d+;')


def _strip_html(text: str) -> str:
    if not text:
        return ''
    out = _HTML_TAG_RE.sub(' ', text)
    out = _HTML_ENTITY_RE.sub(' ', out)
    return re.sub(r'\s+', ' ', out).strip()
MAX_FILES_PER_REPO = 5000
SNIPPET_CHARS = 4000
EMBED_BATCH = 32
TOP_K_DEFAULT = 8

SKIP_DIRS = {
    '.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', '.next', '.nuxt',
    '.venv', 'venv', '__pycache__', 'target', '.idea', '.vscode', '.gradle', 'bin', 'obj',
    '.terraform', '.serverless', 'coverage', '.cache', '.parcel-cache', '.turbo',
}

SKIP_EXTS = {
    '.lock', '.map', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp', '.tiff', '.webp',
    '.woff', '.woff2', '.ttf', '.eot', '.otf', '.pdf', '.zip', '.gz', '.tar', '.7z', '.rar',
    '.so', '.dll', '.exe', '.bin', '.class', '.jar', '.pyc', '.pyo', '.mp3', '.mp4', '.mov',
    '.avi', '.webm', '.wasm', '.iso', '.dmg',
}

LogFn = Callable[[str], Awaitable[None]]


class RepoFileIndexer:
    """Local-embedding repo indexer. Talks to Qdrant directly (does not
    depend on QdrantMemoryStore — that one is for API-based embedders).
    """

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
        names = {c.name for c in collections.collections}
        if REPO_FILES_COLLECTION not in names:
            await self.client.create_collection(
                collection_name=REPO_FILES_COLLECTION,
                vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
            )
            return
        try:
            info = await self.client.get_collection(REPO_FILES_COLLECTION)
            current_size = getattr(getattr(info.config.params, 'vectors', None), 'size', None)
            if current_size and int(current_size) != EMBEDDING_DIM:
                logger.warning(
                    'repo_files collection has dim=%s but local model produces %s; recreating',
                    current_size, EMBEDDING_DIM,
                )
                await self.client.delete_collection(collection_name=REPO_FILES_COLLECTION)
                await self.client.create_collection(
                    collection_name=REPO_FILES_COLLECTION,
                    vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
                )
        except Exception:
            pass

    async def ensure_indexed(
        self,
        *,
        repo_path: str,
        organization_id: int,
        log_fn: LogFn | None = None,
    ) -> dict:
        async def _log(msg: str) -> None:
            if log_fn:
                try:
                    await log_fn(msg)
                except Exception:
                    pass

        if not self.enabled or not self.client:
            return {'indexed': 0, 'skipped': True, 'reason': 'disabled'}
        head_sha = self._head_sha(repo_path)
        if not head_sha:
            await _log('Repo index skipped: HEAD sha could not be resolved.')
            return {'indexed': 0, 'skipped': True, 'reason': 'no_head'}
        await self.ensure_collection()
        if await self._is_fresh(repo_path=repo_path, organization_id=organization_id, head_sha=head_sha):
            await _log(f'Repo index up to date (HEAD {head_sha[:8]}); reusing existing points.')
            return {'indexed': 0, 'skipped': True, 'reason': 'fresh', 'head_sha': head_sha[:8]}

        files = self._walk_files(repo_path)
        if not files:
            await _log('Repo index skipped: no eligible files found.')
            return {'indexed': 0, 'skipped': True, 'reason': 'empty'}

        await _log(f'Indexing {len(files)} files (HEAD {head_sha[:8]}, model={EMBEDDING_MODEL})…')
        await self._delete_for_repo(repo_path=repo_path, organization_id=organization_id)
        count = await self._index_files(
            repo_path=repo_path,
            organization_id=organization_id,
            head_sha=head_sha,
            files=files,
            log_fn=log_fn,
        )
        await _log(f'Repo indexed: {count}/{len(files)} files @ {head_sha[:8]}')
        return {'indexed': count, 'total': len(files), 'head_sha': head_sha[:8]}

    async def query_candidates(
        self,
        *,
        task_text: str,
        repo_path: str,
        organization_id: int,
        top_k: int = TOP_K_DEFAULT,
    ) -> list[str]:
        if not self.enabled or not self.client:
            return []
        await self.ensure_collection()
        clean_text = _strip_html(task_text)
        vectors = await self._embed_texts([clean_text or task_text])
        if not vectors:
            return []
        flt = Filter(must=[
            FieldCondition(key='organization_id', match=MatchValue(value=int(organization_id))),
            FieldCondition(key='repo_root', match=MatchValue(value=self._normalize_path(repo_path))),
        ])
        try:
            results = await self.client.search(
                collection_name=REPO_FILES_COLLECTION,
                query_vector=vectors[0],
                limit=top_k,
                query_filter=flt,
            )
        except Exception as exc:
            logger.warning('repo_files candidate query failed: %s', exc)
            return []
        out: list[str] = []
        for r in results:
            p = (r.payload or {}).get('path')
            if p:
                out.append(p)
        return out

    def _head_sha(self, repo_path: str) -> str:
        """Anchor the index to the remote default branch (typically
        origin/main) rather than the local HEAD. Each AI task leaves
        the repo on a fresh feature branch with a new commit, so HEAD
        is unstable; we'd reindex every single task. origin/HEAD
        moves only when the user pulls real upstream changes, which
        is exactly when reindexing is warranted.
        """
        for ref in ('origin/HEAD', 'origin/main', 'origin/master', 'HEAD'):
            try:
                sha = subprocess.check_output(
                    ['git', '-C', repo_path, 'rev-parse', ref],
                    stderr=subprocess.DEVNULL,
                    timeout=5,
                ).decode().strip()
                if sha:
                    return sha
            except Exception:
                continue
        return ''

    def _normalize_path(self, p: str) -> str:
        return os.path.abspath(p).rstrip('/')

    async def _is_fresh(self, *, repo_path: str, organization_id: int, head_sha: str) -> bool:
        try:
            batch, _ = await self.client.scroll(
                collection_name=REPO_FILES_COLLECTION,
                scroll_filter=Filter(must=[
                    FieldCondition(key='organization_id', match=MatchValue(value=int(organization_id))),
                    FieldCondition(key='repo_root', match=MatchValue(value=self._normalize_path(repo_path))),
                ]),
                limit=1,
                with_payload=True,
                with_vectors=False,
            )
            if not batch:
                return False
            return (batch[0].payload or {}).get('head_sha') == head_sha
        except Exception:
            return False

    async def _delete_for_repo(self, *, repo_path: str, organization_id: int) -> None:
        try:
            await self.client.delete(
                collection_name=REPO_FILES_COLLECTION,
                points_selector=Filter(must=[
                    FieldCondition(key='organization_id', match=MatchValue(value=int(organization_id))),
                    FieldCondition(key='repo_root', match=MatchValue(value=self._normalize_path(repo_path))),
                ]),
            )
        except Exception:
            pass

    def _walk_files(self, repo_path: str) -> list[str]:
        root = Path(repo_path)
        if not root.is_dir():
            return []
        keep: list[str] = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith('.')]
            for fname in filenames:
                ext = os.path.splitext(fname)[1].lower()
                if ext in SKIP_EXTS:
                    continue
                lower = fname.lower()
                if 'lock' in lower and lower.endswith(('.json', '.yaml', '.yml', '.toml')):
                    continue
                full = os.path.join(dirpath, fname)
                try:
                    if os.path.getsize(full) > MAX_FILE_BYTES:
                        continue
                except OSError:
                    continue
                keep.append(full)
                if len(keep) >= MAX_FILES_PER_REPO:
                    return keep
        return keep

    async def _index_files(
        self,
        *,
        repo_path: str,
        organization_id: int,
        head_sha: str,
        files: list[str],
        log_fn: LogFn | None = None,
    ) -> int:
        root_norm = self._normalize_path(repo_path)
        snippets: list[tuple[str, str]] = []
        for full in files:
            rel = os.path.relpath(full, repo_path)
            try:
                with open(full, encoding='utf-8', errors='ignore') as fh:
                    content = fh.read(SNIPPET_CHARS)
            except OSError:
                continue
            snippets.append((rel, f'path: {rel}\n\n{content}'))
        if not snippets:
            return 0

        total_written = 0
        total_batches = (len(snippets) + EMBED_BATCH - 1) // EMBED_BATCH
        for i in range(0, len(snippets), EMBED_BATCH):
            chunk = snippets[i:i + EMBED_BATCH]
            try:
                vectors = await self._embed_texts([s[1] for s in chunk])
            except Exception as exc:
                logger.warning('embedding batch failed: %s', exc)
                vectors = []
            if len(vectors) != len(chunk):
                continue
            points: list[PointStruct] = []
            for (rel, _txt), vec in zip(chunk, vectors):
                pid = str(uuid.uuid5(
                    uuid.NAMESPACE_DNS,
                    f'repo_file:{organization_id}:{root_norm}:{rel}',
                ))
                points.append(PointStruct(
                    id=pid,
                    vector=vec,
                    payload={
                        'organization_id': int(organization_id),
                        'repo_root': root_norm,
                        'path': rel,
                        'head_sha': head_sha,
                    },
                ))
            try:
                await self.client.upsert(collection_name=REPO_FILES_COLLECTION, points=points)
                total_written += len(points)
            except Exception as exc:
                logger.warning('repo_files upsert batch failed: %s', exc)

            batch_idx = (i // EMBED_BATCH) + 1
            if log_fn and (batch_idx == 1 or batch_idx % 5 == 0 or batch_idx == total_batches):
                try:
                    await log_fn(f'Indexing progress: batch {batch_idx}/{total_batches} ({total_written}/{len(snippets)} files)')
                except Exception:
                    pass
        return total_written

    async def _embed_texts(self, texts: list[str]) -> list[list[float]]:
        return await _embed_texts(texts)
