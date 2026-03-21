from __future__ import annotations

import json
from typing import Any

from redis.asyncio import Redis

from core.settings import get_settings


class QueueService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.client = Redis.from_url(self.settings.redis_url, decode_responses=True)

    async def enqueue(self, payload: dict[str, Any], queue_name: str | None = None) -> str:
        key = queue_name or self.settings.redis_queue_name
        await self.client.lpush(key, json.dumps(payload))
        return key

    async def dequeue(self, queue_name: str | None = None, timeout: int = 5) -> dict[str, Any] | None:
        key = queue_name or self.settings.redis_queue_name
        result = await self.client.brpop(key, timeout=timeout)
        if not result:
            return None

        _, raw_payload = result
        return json.loads(raw_payload)

    async def queue_size(self, queue_name: str | None = None) -> int:
        key = queue_name or self.settings.redis_queue_name
        return int(await self.client.llen(key))
