"""Repo file indexer — embed file paths + head snippets into Qdrant so
orchestration can hand the CLI subagent a shortlist of relevant files
instead of letting it grep the whole repo on every task.

Uses fastembed (local, CPU-only multilingual model) so there is no API
cost and no rate limit. Model downloads once on first use (~400MB),
then ~50ms per embedding.

Indexing is lazy and incremental: a task's first run on a given repo
walks the tree, embeds every kept file, and upserts one point per file
into a dedicated `repo_files` Qdrant collection. Subsequent tasks reuse
the index unless the repo's *base* commit has changed — and even then
only the files whose content actually changed are re-embedded.

Freshness is keyed on the branch base (`git merge-base origin/main
HEAD`), NOT the local HEAD. Every AI task runs on a fresh feature
branch with a new commit, so the local HEAD changes every task; keying
on it forced a full reindex (~7 min, 5000 files) on every single task.
The merge-base stays constant across feature branches cut from the same
remote default branch, so the index is reused until the remote default
actually advances. When no remote ref is resolvable we fall back to a
time-based (TTL) staleness check rather than the unstable local HEAD.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import subprocess
import time
import uuid
from pathlib import Path
from typing import Callable, Awaitable

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, FieldCondition, Filter, MatchValue, PointIdsList, PointStruct, VectorParams

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
SCROLL_PAGE = 1000

# When the branch base can't be resolved (no remote-tracking ref) we
# don't key on the unstable local HEAD; we reindex only if the existing
# index is older than this.
REINDEX_TTL_SEC = 24 * 3600

# Per-repo bookkeeping lives in a single "meta" point (head_sha +
# indexed_at) separate from the file points, so incremental syncs can
# leave unchanged file points untouched while still moving the
# freshness marker forward. The meta point carries a sentinel vector
# (excluded from candidate search via a must_not on kind=meta).
META_KIND = 'meta'
FILE_KIND = 'file'
_META_VECTOR = [1.0] + [0.0] * (EMBEDDING_DIM - 1)

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
        await self.ensure_collection()

        root_norm = self._normalize_path(repo_path)
        anchor = self._anchor_sha(repo_path)
        now = int(time.time())
        meta = await self._load_meta(root_norm=root_norm, organization_id=organization_id)

        if meta and self._is_fresh(meta=meta, anchor=anchor, now=now):
            if anchor:
                await _log(f'Repo index up to date (base {anchor[:8]}); reusing existing points.')
            else:
                age_h = (now - int(meta.get('indexed_at') or 0)) // 3600
                await _log(
                    f'Repo index reused (no remote ref; {age_h}h old < '
                    f'{REINDEX_TTL_SEC // 3600}h TTL).'
                )
            return {
                'indexed': 0, 'skipped': True, 'reason': 'fresh',
                'head_sha': (anchor or (meta.get('head_sha') or ''))[:8],
            }

        files = self._walk_files(repo_path)
        if not files:
            await _log('Repo index skipped: no eligible files found.')
            return {'indexed': 0, 'skipped': True, 'reason': 'empty'}

        label = anchor[:8] if anchor else 'no-ref'
        sync = await self._sync_files(
            repo_path=repo_path,
            organization_id=organization_id,
            root_norm=root_norm,
            anchor=anchor,
            files=files,
            log_fn=log_fn,
        )
        await self._write_meta(
            root_norm=root_norm,
            organization_id=organization_id,
            head_sha=anchor,
            indexed_at=now,
            file_count=sync['kept'],
        )
        await _log(
            f"Repo index synced @ {label}: +{sync['embedded']} changed, "
            f"-{sync['deleted']} removed, {sync['unchanged']} unchanged"
        )
        return {
            'indexed': sync['embedded'],
            'total': len(files),
            'unchanged': sync['unchanged'],
            'deleted': sync['deleted'],
            'head_sha': label,
        }

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
        flt = Filter(
            must=[
                FieldCondition(key='organization_id', match=MatchValue(value=int(organization_id))),
                FieldCondition(key='repo_root', match=MatchValue(value=self._normalize_path(repo_path))),
            ],
            must_not=[FieldCondition(key='kind', match=MatchValue(value=META_KIND))],
        )
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

    # ── git anchor ────────────────────────────────────────────────────────

    def _anchor_sha(self, repo_path: str) -> str:
        """Stable index key: the commit the current branch forks from on
        the remote default branch.

        Every AI task runs on a fresh feature branch off the same main,
        so `merge-base(origin/main, HEAD)` stays constant — it only
        moves when the remote default actually advances *and* a new
        branch is cut from it. We deliberately NEVER fall back to the
        local HEAD (which changes on every task and would force a full
        reindex each time); when no remote ref resolves we return '' and
        the caller switches to a time-based (TTL) staleness check.
        """
        base_ref = ''
        for ref in ('origin/HEAD', 'origin/main', 'origin/master'):
            if self._git(repo_path, ['rev-parse', '--verify', '--quiet', ref]):
                base_ref = ref
                break
        if not base_ref:
            return ''
        mb = self._git(repo_path, ['merge-base', base_ref, 'HEAD'])
        if mb:
            return mb
        # Unrelated histories / no HEAD yet — anchor on the base ref tip
        # itself, still a stable remote-tracking value.
        return self._git(repo_path, ['rev-parse', base_ref])

    def _git(self, repo_path: str, args: list[str]) -> str:
        try:
            return subprocess.check_output(
                ['git', '-C', repo_path, *args],
                stderr=subprocess.DEVNULL,
                timeout=5,
            ).decode().strip()
        except Exception:
            return ''

    def _normalize_path(self, p: str) -> str:
        return os.path.abspath(p).rstrip('/')

    # ── freshness + meta point ──────────────────────────────────────────────

    def _is_fresh(self, *, meta: dict, anchor: str, now: int) -> bool:
        """Decide whether the existing index can be reused.

        With a resolvable branch base: fresh iff the stored base matches.
        Without one (no remote ref): fresh iff the index is younger than
        the TTL — never key on the volatile local HEAD.
        """
        if not meta:
            return False
        if anchor:
            return (meta.get('head_sha') or '') == anchor
        indexed_at = int(meta.get('indexed_at') or 0)
        return indexed_at > 0 and (now - indexed_at) < REINDEX_TTL_SEC

    def _meta_id(self, organization_id: int, root_norm: str) -> str:
        return str(uuid.uuid5(uuid.NAMESPACE_DNS, f'repo_meta:{organization_id}:{root_norm}'))

    def _file_id(self, organization_id: int, root_norm: str, rel: str) -> str:
        return str(uuid.uuid5(uuid.NAMESPACE_DNS, f'repo_file:{organization_id}:{root_norm}:{rel}'))

    async def _load_meta(self, *, root_norm: str, organization_id: int) -> dict | None:
        try:
            pts = await self.client.retrieve(
                collection_name=REPO_FILES_COLLECTION,
                ids=[self._meta_id(organization_id, root_norm)],
                with_payload=True,
                with_vectors=False,
            )
        except Exception:
            return None
        if not pts:
            return None
        return pts[0].payload or {}

    async def _write_meta(
        self, *, root_norm: str, organization_id: int,
        head_sha: str, indexed_at: int, file_count: int,
    ) -> None:
        try:
            await self.client.upsert(
                collection_name=REPO_FILES_COLLECTION,
                points=[PointStruct(
                    id=self._meta_id(organization_id, root_norm),
                    vector=list(_META_VECTOR),
                    payload={
                        'organization_id': int(organization_id),
                        'repo_root': root_norm,
                        'kind': META_KIND,
                        'head_sha': head_sha or '',
                        'indexed_at': int(indexed_at),
                        'file_count': int(file_count),
                    },
                )],
            )
        except Exception as exc:
            logger.warning('repo_files meta upsert failed: %s', exc)

    async def _delete_for_repo(self, *, repo_path: str, organization_id: int) -> None:
        """Drop every point (file points + meta) for this repo. Used by
        the manual reindex endpoint to force a full rebuild."""
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

    # ── walking + incremental sync ──────────────────────────────────────────

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

    async def _sync_files(
        self,
        *,
        repo_path: str,
        organization_id: int,
        root_norm: str,
        anchor: str,
        files: list[str],
        log_fn: LogFn | None = None,
    ) -> dict:
        """Incremental upsert: read each file's snippet, hash it, and
        only re-embed the files whose content changed since the last
        index. Removed files are deleted. Returns counts."""
        # 1. Read snippets + content hashes for the current tree.
        current: dict[str, tuple[str, str]] = {}  # rel -> (embed_text, content_hash)
        for full in files:
            rel = os.path.relpath(full, repo_path)
            try:
                with open(full, encoding='utf-8', errors='ignore') as fh:
                    content = fh.read(SNIPPET_CHARS)
            except OSError:
                continue
            chash = hashlib.sha1(content.encode('utf-8', 'ignore')).hexdigest()
            current[rel] = (f'path: {rel}\n\n{content}', chash)

        # 2. Existing file hashes (points missing content_hash → re-embed once).
        existing = await self._load_file_hashes(root_norm=root_norm, organization_id=organization_id)

        # 3. Diff.
        to_embed = [rel for rel, (_t, h) in current.items() if existing.get(rel) != h]
        to_delete = [rel for rel in existing if rel not in current]
        unchanged = len(current) - len(to_embed)

        # 4. Drop points for files no longer in the tree.
        if to_delete:
            await self._delete_files(root_norm=root_norm, organization_id=organization_id, rels=to_delete)

        # 5. Embed + upsert only changed/new files.
        embedded = 0
        if to_embed:
            embedded = await self._embed_and_upsert(
                organization_id=organization_id,
                root_norm=root_norm,
                anchor=anchor,
                items=[(rel, current[rel][0], current[rel][1]) for rel in to_embed],
                log_fn=log_fn,
            )
        return {
            'embedded': embedded,
            'deleted': len(to_delete),
            'unchanged': unchanged,
            'kept': len(current),
        }

    async def _load_file_hashes(self, *, root_norm: str, organization_id: int) -> dict[str, str | None]:
        out: dict[str, str | None] = {}
        flt = Filter(
            must=[
                FieldCondition(key='organization_id', match=MatchValue(value=int(organization_id))),
                FieldCondition(key='repo_root', match=MatchValue(value=root_norm)),
            ],
            must_not=[FieldCondition(key='kind', match=MatchValue(value=META_KIND))],
        )
        next_off = None
        try:
            while True:
                batch, next_off = await self.client.scroll(
                    collection_name=REPO_FILES_COLLECTION,
                    scroll_filter=flt,
                    limit=SCROLL_PAGE,
                    with_payload=True,
                    with_vectors=False,
                    offset=next_off,
                )
                for p in batch:
                    pl = p.payload or {}
                    rel = pl.get('path')
                    if rel:
                        out[rel] = pl.get('content_hash')
                if next_off is None:
                    break
        except Exception as exc:
            logger.warning('repo_files hash scan failed: %s', exc)
        return out

    async def _delete_files(self, *, root_norm: str, organization_id: int, rels: list[str]) -> None:
        ids = [self._file_id(organization_id, root_norm, rel) for rel in rels]
        for i in range(0, len(ids), SCROLL_PAGE):
            try:
                await self.client.delete(
                    collection_name=REPO_FILES_COLLECTION,
                    points_selector=PointIdsList(points=ids[i:i + SCROLL_PAGE]),
                )
            except Exception as exc:
                logger.warning('repo_files delete batch failed: %s', exc)

    async def _embed_and_upsert(
        self,
        *,
        organization_id: int,
        root_norm: str,
        anchor: str,
        items: list[tuple[str, str, str]],  # (rel, embed_text, content_hash)
        log_fn: LogFn | None = None,
    ) -> int:
        total_written = 0
        total_batches = (len(items) + EMBED_BATCH - 1) // EMBED_BATCH
        for i in range(0, len(items), EMBED_BATCH):
            chunk = items[i:i + EMBED_BATCH]
            try:
                vectors = await self._embed_texts([c[1] for c in chunk])
            except Exception as exc:
                logger.warning('embedding batch failed: %s', exc)
                vectors = []
            if len(vectors) != len(chunk):
                continue
            points: list[PointStruct] = []
            for (rel, _txt, chash), vec in zip(chunk, vectors):
                points.append(PointStruct(
                    id=self._file_id(organization_id, root_norm, rel),
                    vector=vec,
                    payload={
                        'organization_id': int(organization_id),
                        'repo_root': root_norm,
                        'kind': FILE_KIND,
                        'path': rel,
                        'content_hash': chash,
                        'head_sha': anchor or '',
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
                    await log_fn(
                        f'Indexing progress: batch {batch_idx}/{total_batches} '
                        f'({total_written}/{len(items)} changed files)'
                    )
                except Exception:
                    pass
        return total_written

    async def _embed_texts(self, texts: list[str]) -> list[list[float]]:
        return await _embed_texts(texts)
