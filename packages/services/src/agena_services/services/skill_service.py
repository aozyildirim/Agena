"""Skill catalog — reusable patterns extracted from completed tasks.

Each skill lives as a DB row (for listing, stats, CRUD) AND as a Qdrant
point (for semantic retrieval when a new task needs grounding).

The embedding text is `{name}\n{description}\n{approach_summary}\n\nFiles: {files}`
so skills whose touched files or approach overlap the new task surface
near the top.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_agents.memory.qdrant import QdrantMemoryStore
from agena_models.models.skill import Skill
from agena_models.schemas.skill import SkillCreate, SkillHit, SkillUpdate

logger = logging.getLogger(__name__)


class SkillService:
    # Same tiering semantics as refinement similarity — short-text
    # multilingual embeddings compress into a narrow band, so absolute
    # score cutoffs + relative gap are what make the signal usable.
    TIER_STRONG_SCORE = 0.82
    TIER_RELATED_SCORE = 0.72
    SIMILAR_MIN_SCORE = 0.55
    SIMILAR_MAX_GAP = 0.06

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

    # ----- Retrieval -----

    async def find_relevant(
        self,
        organization_id: int,
        *,
        title: str,
        description: str = '',
        touched_files: list[str] | None = None,
        limit: int = 3,
    ) -> list[SkillHit]:
        """Top-K skills most relevant to an incoming task. Called by agents
        before they plan or write code, so prior solutions reach the LLM
        as grounding."""
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
            stmt = select(Skill).where(
                Skill.organization_id == organization_id,
                Skill.id.in_(skill_ids),
            )
            for s in (await self.db.execute(stmt)).scalars().all():
                skills_by_id[s.id] = s

        out: list[SkillHit] = []
        for r in filtered[:limit]:
            try:
                sid = int(r.get('skill_id') or 0)
            except (TypeError, ValueError):
                continue
            skill = skills_by_id.get(sid)
            if skill is None:
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
