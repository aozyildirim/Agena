import hashlib
import json
from typing import Any

from redis.asyncio import Redis

from agena_core.settings import get_settings


class PromptCache:
    def __init__(self) -> None:
        settings = get_settings()
        self.client = Redis.from_url(settings.redis_url, decode_responses=True)

    def build_key(self, model: str, system_prompt: str, user_prompt: str) -> str:
        payload = json.dumps({'m': model, 's': system_prompt, 'u': user_prompt}, sort_keys=True)
        key_hash = hashlib.sha256(payload.encode('utf-8')).hexdigest()
        return f'llm_cache:{key_hash}'

    async def get(self, key: str) -> dict[str, Any] | None:
        value = await self.client.get(key)
        if not value:
            return None
        return json.loads(value)

    async def set(self, key: str, value: dict[str, Any], ttl_seconds: int = 86400) -> None:
        await self.client.set(key, json.dumps(value), ex=ttl_seconds)
