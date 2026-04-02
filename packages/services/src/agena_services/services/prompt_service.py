"""Prompt loader — reads prompt content from the `prompts` table with an in-process cache.

Usage:
    content = await PromptService.get(db, 'pm_system_prompt')

Call `PromptService.invalidate()` (or pass a specific slug) to bust the cache
after an admin edits a prompt record without restarting the process.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.prompt import Prompt

logger = logging.getLogger(__name__)

_cache: dict[str, str] = {}


class PromptService:
    @staticmethod
    async def get(db: AsyncSession, slug: str) -> str:
        if slug in _cache:
            return _cache[slug]
        content = await db.scalar(
            select(Prompt.content).where(Prompt.slug == slug, Prompt.is_active.is_(True))
        )
        if content is None:
            raise ValueError(f"Prompt '{slug}' not found or inactive in the prompts table")
        _cache[slug] = content
        logger.debug('Loaded prompt %s from database', slug)
        return content

    @staticmethod
    def invalidate(slug: str | None = None) -> None:
        """Bust the in-memory cache. Pass None to clear all."""
        if slug is None:
            _cache.clear()
        else:
            _cache.pop(slug, None)
