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

    async def list_payloads(self, queue_name: str | None = None) -> list[dict[str, Any]]:
        key = queue_name or self.settings.redis_queue_name
        raws = await self.client.lrange(key, 0, -1)
        items: list[dict[str, Any]] = []
        for raw in raws:
            try:
                items.append(json.loads(raw))
            except Exception:
                continue
        return items

    async def remove_task(self, *, organization_id: int, task_id: int, queue_name: str | None = None) -> int:
        key = queue_name or self.settings.redis_queue_name
        payload = json.dumps({'organization_id': organization_id, 'task_id': task_id, 'create_pr': True})
        removed = await self.client.lrem(key, 0, payload)
        if removed > 0:
            return int(removed)
        # Backward compatibility for queue entries with create_pr false
        payload2 = json.dumps({'organization_id': organization_id, 'task_id': task_id, 'create_pr': False})
        removed2 = await self.client.lrem(key, 0, payload2)
        return int(removed2)

    async def acquire_lock(self, lock_key: str, owner: str, ttl_sec: int = 1800) -> bool:
        full_key = f'queue_lock:{lock_key}'
        result = await self.client.set(full_key, owner, nx=True, ex=ttl_sec)
        return bool(result)

    async def release_lock(self, lock_key: str, owner: str) -> bool:
        full_key = f'queue_lock:{lock_key}'
        script = """
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
"""
        released = await self.client.eval(script, 1, full_key, owner)
        return bool(released)

    async def get_task_position(self, *, organization_id: int, task_id: int, queue_name: str | None = None) -> int | None:
        key = queue_name or self.settings.redis_queue_name
        items = await self.client.lrange(key, 0, -1)
        if not items:
            return None

        positions: list[int] = []
        total = len(items)
        for idx, raw in enumerate(items):
            try:
                payload = json.loads(raw)
            except Exception:
                continue
            if int(payload.get('organization_id', 0) or 0) != organization_id:
                continue
            if int(payload.get('task_id', 0) or 0) != task_id:
                continue
            # lpush + brpop FIFO: right-most item is next to process (position 1)
            positions.append(total - idx)
        if not positions:
            return None
        return min(positions)
