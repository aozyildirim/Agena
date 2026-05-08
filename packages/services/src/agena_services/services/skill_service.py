"""Skill catalog — reusable patterns extracted from completed tasks.

Each skill lives as a DB row (for listing, stats, CRUD) AND as a Qdrant
point (for semantic retrieval when a new task needs grounding).

The embedding text is `{name}\n{description}\n{approach_summary}\n\nFiles: {files}`
so skills whose touched files or approach overlap the new task surface
near the top.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_agents.memory.qdrant import QdrantMemoryStore
from agena_models.models.skill import Skill
from agena_models.schemas.skill import SkillCreate, SkillHit, SkillUpdate

logger = logging.getLogger(__name__)


# File extensions that unambiguously imply a programming language.
# Documentation / config / data extensions are intentionally absent —
# a `.md` or `.json` doesn't tell us whether a PHP-specific skill is
# applicable to a Python or TS repo.
_EXT_TO_LANG: dict[str, str] = {
    '.php': 'php',
    '.py': 'python',
    '.go': 'go',
    '.rb': 'ruby',
    '.rs': 'rust',
    '.java': 'java',
    '.kt': 'kotlin',
    '.scala': 'scala',
    '.cs': 'csharp',
    '.swift': 'swift',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp',
    '.c': 'c', '.h': 'c',
}

# In-memory cache of {abs_path → frozenset[lang]}. Skills are looked
# up on every task run; a repo's file-extension distribution doesn't
# shift minute-to-minute, so memoising the walk keeps this cheap.
_REPO_LANG_CACHE: dict[str, frozenset[str]] = {}

_LANG_SCAN_SKIP_DIRS = {
    '.git', 'node_modules', 'vendor', 'venv', '.venv',
    'dist', 'build', '__pycache__', '.next', 'target',
}

# Maps a tag / pattern_type token (case-folded) to a normalised language
# id. The structured `tags` array on each Skill is the publisher's
# declaration of intent — when a tag like "php" or "django" is present
# we trust it instead of guessing from prose. Aliases collapse the
# common framework / variant names onto their host language.
_TAG_TO_LANG: dict[str, str] = {
    'php': 'php',
    'python': 'python', 'py': 'python', 'django': 'python',
    'flask': 'python', 'fastapi': 'python',
    'go': 'go', 'golang': 'go',
    'ruby': 'ruby', 'rails': 'ruby',
    'rust': 'rust',
    'java': 'java', 'spring': 'java',
    'kotlin': 'kotlin',
    'scala': 'scala',
    'csharp': 'csharp', 'c#': 'csharp', '.net': 'csharp', 'dotnet': 'csharp',
    'swift': 'swift',
    'typescript': 'typescript', 'ts': 'typescript', 'tsx': 'typescript',
    'javascript': 'javascript', 'js': 'javascript',
    'node': 'javascript', 'nodejs': 'javascript', 'node.js': 'javascript',
    'cpp': 'cpp', 'c++': 'cpp',
    'c': 'c',
}


class SkillService:
    # Same tiering semantics as refinement similarity — short-text
    # multilingual embeddings compress into a narrow band, so absolute
    # score cutoffs + relative gap are what make the signal usable.
    # Cutoffs were tuned on Turkish task titles → English skill descriptions
    # which sit in the 0.40–0.65 band; the previous 0.55 floor and 0.72/0.82
    # tiers meant nothing ever cleared the bar in practice and the agent
    # had to rediscover patterns every run.
    TIER_STRONG_SCORE = 0.62
    TIER_RELATED_SCORE = 0.50
    SIMILAR_MIN_SCORE = 0.42
    SIMILAR_MAX_GAP = 0.10

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.memory = QdrantMemoryStore()

    # ----- CRUD -----

    async def create(
        self,
        organization_id: int,
        payload: SkillCreate,
        *,
        user_id: int | None = None,
    ) -> Skill:
        skill = Skill(
            organization_id=organization_id,
            created_by_user_id=user_id,
            source_task_id=payload.source_task_id,
            name=payload.name.strip()[:256],
            description=(payload.description or '').strip() or None,
            pattern_type=(payload.pattern_type or 'other').strip()[:48] or 'other',
            tags=[t.strip() for t in (payload.tags or []) if t and t.strip()][:20],
            touched_files=[f for f in (payload.touched_files or []) if f][:50],
            approach_summary=(payload.approach_summary or '').strip() or None,
            prompt_fragment=(payload.prompt_fragment or '').strip() or None,
        )
        self.db.add(skill)
        await self.db.flush()
        skill.qdrant_key = f'skill:{organization_id}:{skill.id}'
        await self.db.commit()
        await self.db.refresh(skill)
        await self._upsert_vector(skill)
        return skill

    async def update(
        self,
        organization_id: int,
        skill_id: int,
        payload: SkillUpdate,
    ) -> Skill | None:
        skill = await self._get_owned(organization_id, skill_id)
        if skill is None:
            return None
        data = payload.model_dump(exclude_unset=True)
        for key, value in data.items():
            if key in ('tags', 'touched_files') and value is not None:
                setattr(skill, key, value[:50])
            elif value is not None:
                setattr(skill, key, value)
        await self.db.commit()
        await self.db.refresh(skill)
        await self._upsert_vector(skill)
        return skill

    async def delete(self, organization_id: int, skill_id: int) -> bool:
        skill = await self._get_owned(organization_id, skill_id)
        if skill is None:
            return False
        await self.db.execute(delete(Skill).where(Skill.id == skill_id))
        await self.db.commit()
        # Best-effort Qdrant cleanup — a stale point here doesn't break
        # anything, it just ranks lower over time.
        if skill.qdrant_key:
            try:
                await self._delete_vector(skill.qdrant_key)
            except Exception as exc:
                logger.info('Qdrant point delete failed for skill %s: %s', skill_id, exc)
        return True

    async def list(
        self,
        organization_id: int,
        *,
        page: int = 1,
        page_size: int = 20,
        q: str | None = None,
        pattern_type: str | None = None,
        tag: str | None = None,
    ) -> tuple[list[Skill], int]:
        stmt = select(Skill).where(Skill.organization_id == organization_id)
        if pattern_type:
            stmt = stmt.where(Skill.pattern_type == pattern_type)
        rows = (await self.db.execute(stmt)).scalars().all()
        # Filter by tag/query in memory — per-org volume stays modest.
        if tag:
            tag_lc = tag.lower()
            rows = [s for s in rows if any((t or '').lower() == tag_lc for t in (s.tags or []))]
        if q:
            q_lc = q.lower()
            rows = [
                s for s in rows
                if q_lc in (s.name or '').lower()
                or q_lc in (s.description or '').lower()
                or q_lc in (s.approach_summary or '').lower()
                or any(q_lc in (t or '').lower() for t in (s.tags or []))
            ]
        total = len(rows)
        rows.sort(key=lambda s: s.created_at, reverse=True)
        start = (page - 1) * page_size
        return rows[start:start + page_size], total

    async def get(self, organization_id: int, skill_id: int) -> Skill | None:
        return await self._get_owned(organization_id, skill_id)

    async def list_all_for_org(self, organization_id: int) -> list[Skill]:
        """Unpaginated list — used by import-defaults to dedupe by name.
        Per-org volume stays modest (typically < 100 rows), so a full
        scan is fine."""
        rows = (await self.db.execute(
            select(Skill).where(Skill.organization_id == organization_id)
        )).scalars().all()
        return list(rows)

    # ----- Retrieval -----

    async def find_relevant(
        self,
        organization_id: int,
        *,
        title: str,
        description: str = '',
        touched_files: list[str] | None = None,
        limit: int = 3,
        local_repo_path: str | None = None,
    ) -> list[SkillHit]:
        """Top-K skills most relevant to an incoming task. Called by agents
        before they plan or write code, so prior solutions reach the LLM
        as grounding.

        ``local_repo_path`` enables a language gate: a skill whose
        touched_files imply (say) PHP is dropped when the target repo
        contains zero ``.php`` files. Prevents cross-language bleed-over
        when the embedding model rates a Turkish title as 0.6+ similar to
        a PHP skill purely on linguistic shape."""
        if not self.memory.enabled:
            return []
        query = self._embed_text(
            name=title,
            description=description,
            approach_summary='',
            touched_files=touched_files or [],
        )
        if not query:
            return []
        try:
            rows = await self.memory.search_similar(
                query,
                limit=max(limit * 4, 12),
                organization_id=organization_id,
                extra_filters={'kind': 'skill'},
            )
        except Exception as exc:
            logger.info('Qdrant skill search failed: %s', exc)
            return []
        filtered = [r for r in rows if (r.get('_score') or 0) >= self.SIMILAR_MIN_SCORE]
        if not filtered:
            return []
        top_score = max(r.get('_score') or 0 for r in filtered)
        gap_cut = top_score - self.SIMILAR_MAX_GAP
        filtered = [r for r in filtered if (r.get('_score') or 0) >= gap_cut]

        # Load DB rows for extra metadata (pattern_type, tags, usage_count)
        skill_ids: list[int] = []
        for r in filtered[:limit]:
            try:
                sid = int(r.get('skill_id') or 0)
            except (TypeError, ValueError):
                sid = 0
            if sid:
                skill_ids.append(sid)
        skills_by_id: dict[int, Skill] = {}
        if skill_ids:
            # Include both the org's own skills and active public skills —
            # public ones live with organization_id NULL so the OR clause
            # is the cleanest way to merge the two surfaces.
            stmt = select(Skill).where(
                Skill.id.in_(skill_ids),
                or_(
                    Skill.organization_id == organization_id,
                    and_(Skill.organization_id.is_(None), Skill.is_public.is_(True), Skill.is_active.is_(True)),
                ),
            )
            for s in (await self.db.execute(stmt)).scalars().all():
                skills_by_id[s.id] = s

        # Language gate — drop skills whose touched_files imply a
        # language the target repo doesn't contain. We only filter when
        # the skill's language signal is unambiguous AND we successfully
        # scanned the repo; absent either signal we keep the hit (the
        # vector score already cleared the threshold).
        repo_langs = self._repo_languages(local_repo_path)

        out: list[SkillHit] = []
        for r in filtered[:limit]:
            try:
                sid = int(r.get('skill_id') or 0)
            except (TypeError, ValueError):
                continue
            skill = skills_by_id.get(sid)
            if skill is None:
                continue

            if repo_langs is not None:
                # Use the skill's own structured metadata (tags +
                # pattern_type) as the primary language signal, with
                # touched_files as a secondary fallback. Skills whose
                # publisher didn't tag a language stay unfiltered — we
                # never invent a signal from free-form text.
                skill_langs = (
                    self._lang_from_tags(skill.tags, skill.pattern_type)
                    | self._lang_from_paths(skill.touched_files)
                )
                if skill_langs and not (skill_langs & repo_langs):
                    logger.info(
                        'Skill %s (%s) dropped by language gate: skill=%s repo=%s',
                        skill.id, (skill.name or '')[:60], sorted(skill_langs), sorted(repo_langs),
                    )
                    continue
            score = float(r.get('_score') or 0.0)
            if score >= self.TIER_STRONG_SCORE:
                tier = 'strong'
            elif score >= self.TIER_RELATED_SCORE:
                tier = 'related'
            else:
                tier = 'weak'
            out.append(SkillHit(
                id=skill.id,
                name=skill.name,
                description=skill.description or '',
                pattern_type=skill.pattern_type,
                tags=list(skill.tags or []),
                touched_files=list(skill.touched_files or []),
                approach_summary=skill.approach_summary or '',
                prompt_fragment=skill.prompt_fragment or '',
                score=score,
                tier=tier,
                usage_count=skill.usage_count,
            ))

        # Stamp usage for retrieved skills (>= related tier only — weak
        # hits shouldn't inflate the counter).
        bumped_ids = [h.id for h in out if h.tier in ('strong', 'related')]
        if bumped_ids:
            try:
                now = datetime.utcnow()
                stmt = select(Skill).where(Skill.id.in_(bumped_ids))
                for s in (await self.db.execute(stmt)).scalars().all():
                    s.usage_count = (s.usage_count or 0) + 1
                    s.last_used_at = now
                await self.db.commit()
            except Exception:
                pass
        return out

    @staticmethod
    def format_for_prompt(hits: list[SkillHit], is_turkish: bool = True) -> str:
        if not hits:
            return ''
        header = (
            'Takım Bilgi Tabanından İlgili Çözümler (Skills):'
            if is_turkish else
            "Relevant solutions from your team's knowledge base (Skills):"
        )
        lines = [header]
        for i, h in enumerate(hits, 1):
            tag_str = ', '.join(h.tags[:4]) if h.tags else ''
            files_str = ', '.join(h.touched_files[:3]) if h.touched_files else ''
            lines.append(f'  {i}. [{h.pattern_type}] {h.name}')
            if h.approach_summary:
                lines.append(f'     Yaklaşım: {h.approach_summary[:300]}' if is_turkish
                             else f'     Approach: {h.approach_summary[:300]}')
            if h.prompt_fragment:
                lines.append(f'     {h.prompt_fragment[:400]}')
            meta_bits = []
            if tag_str:
                meta_bits.append(f'tags: {tag_str}')
            if files_str:
                meta_bits.append(f'files: {files_str}')
            if h.usage_count:
                meta_bits.append(
                    f'{h.usage_count} kez kullanıldı' if is_turkish
                    else f'used {h.usage_count} times'
                )
            if meta_bits:
                lines.append('     ({})'.format(' | '.join(meta_bits)))
        trailer = (
            'Yukarıdaki çözümlerden uygulanabilir olanları mevcut iş için uyarla, '
            'ama körü körüne kopyalama — bağlam farklı olabilir.'
            if is_turkish else
            'Adapt the applicable solutions above to the current task; do not copy '
            'blindly — the context may differ.'
        )
        lines.append('')
        lines.append(trailer)
        return '\n'.join(lines)

    # ----- Internals -----

    @staticmethod
    def _lang_from_paths(paths: list[str] | None) -> set[str]:
        """Map a list of file paths to the set of languages they imply,
        using extension. Empty when none of the paths have a recognised
        source extension (e.g. all .md / .json — language-agnostic skill)."""
        out: set[str] = set()
        for p in paths or []:
            ext = os.path.splitext(str(p))[1].lower()
            lang = _EXT_TO_LANG.get(ext)
            if lang:
                out.add(lang)
        return out

    @staticmethod
    def _lang_from_tags(tags: list[str] | None, pattern_type: str | None) -> set[str]:
        """Resolve languages declared by the publisher in the skill's
        ``tags`` array (and ``pattern_type`` as a single-token fallback).
        Unknown tokens are ignored — generic skills like
        ``tags=['error-handling']`` produce the empty set, so the gate
        leaves them alone."""
        out: set[str] = set()
        for tok in list(tags or []) + ([pattern_type] if pattern_type else []):
            norm = str(tok or '').strip().lower()
            lang = _TAG_TO_LANG.get(norm)
            if lang:
                out.add(lang)
        return out

    @staticmethod
    def _repo_languages(local_repo_path: str | None) -> frozenset[str] | None:
        """Walk the checkout once and cache the set of languages with
        at least one source file. Returns None when the path is missing
        or unusable so callers can fall back to no-filter behaviour
        (better to keep a possibly-irrelevant skill than to silently
        drop everything)."""
        if not local_repo_path:
            return None
        cached = _REPO_LANG_CACHE.get(local_repo_path)
        if cached is not None:
            return cached
        if not os.path.isdir(local_repo_path):
            return None
        found: set[str] = set()
        file_count = 0
        # Cap the walk: we only need to know which languages are
        # present, not enumerate every file. Vendor / build dirs are
        # pruned because they routinely contain code in unrelated
        # languages (e.g. node_modules in a Python repo).
        for dirpath, dirnames, filenames in os.walk(local_repo_path):
            dirnames[:] = [
                d for d in dirnames
                if d not in _LANG_SCAN_SKIP_DIRS and not d.startswith('.')
            ]
            for fn in filenames:
                ext = os.path.splitext(fn)[1].lower()
                lang = _EXT_TO_LANG.get(ext)
                if lang:
                    found.add(lang)
            file_count += len(filenames)
            if file_count > 8000:
                break
        result = frozenset(found)
        _REPO_LANG_CACHE[local_repo_path] = result
        return result

    async def _get_owned(self, organization_id: int, skill_id: int) -> Skill | None:
        stmt = select(Skill).where(
            Skill.id == skill_id, Skill.organization_id == organization_id
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    @staticmethod
    def _embed_text(
        *,
        name: str,
        description: str,
        approach_summary: str,
        touched_files: list[str],
    ) -> str:
        parts: list[str] = [str(name or '').strip()]
        if description:
            parts.append(str(description)[:1500])
        if approach_summary:
            parts.append(str(approach_summary)[:1500])
        if touched_files:
            parts.append('Files: ' + ', '.join(touched_files[:20]))
        return '\n\n'.join(p for p in parts if p).strip()[:6000]

    async def _upsert_vector(self, skill: Skill) -> None:
        if not self.memory.enabled:
            return
        text = self._embed_text(
            name=skill.name,
            description=skill.description or '',
            approach_summary=skill.approach_summary or '',
            touched_files=list(skill.touched_files or []),
        )
        if not text:
            return
        payload: dict[str, Any] = {
            'kind': 'skill',
            'skill_id': int(skill.id),
            'name': skill.name[:300],
            'pattern_type': skill.pattern_type,
            'tags': list(skill.tags or [])[:10],
            'touched_files': list(skill.touched_files or [])[:20],
        }
        try:
            await self.memory.upsert_memory(
                key=skill.qdrant_key or f'skill:{skill.organization_id}:{skill.id}',
                input_text=text,
                output_text='',
                organization_id=skill.organization_id,
                extra=payload,
            )
        except Exception as exc:
            logger.warning('Skill vector upsert failed for skill %s: %s', skill.id, exc)

    async def _delete_vector(self, qdrant_key: str) -> None:
        if not self.memory.enabled or not self.memory.client:
            return
        import uuid as _uuid
        point_id = str(_uuid.uuid5(_uuid.NAMESPACE_DNS, f'task-{qdrant_key}'))
        await self.memory.client.delete(
            collection_name=self.memory.settings.qdrant_collection,
            points_selector=[point_id],
        )
