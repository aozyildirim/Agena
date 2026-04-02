from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncGenerator

from redis.asyncio import Redis

from agena_core.settings import get_settings

logger = logging.getLogger(__name__)


class EventBus:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._client: Redis | None = None

    def _get_client(self) -> Redis:
        if self._client is None:
            self._client = Redis.from_url(self.settings.redis_url, decode_responses=True)
        return self._client

    @staticmethod
    def _channel(org_id: int) -> str:
        return f'ws:org:{org_id}'

    async def publish(self, org_id: int, event_type: str, payload: dict[str, Any]) -> None:
        message = json.dumps({'event': event_type, 'data': payload})
        client = self._get_client()
        await client.publish(self._channel(org_id), message)

    async def subscribe(self, org_id: int) -> AsyncGenerator[dict[str, Any], None]:
        client = Redis.from_url(self.settings.redis_url, decode_responses=True)
        pubsub = client.pubsub()
        await pubsub.subscribe(self._channel(org_id))
        try:
            while True:
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg is not None and msg['type'] == 'message':
                    try:
                        yield json.loads(msg['data'])
                    except (json.JSONDecodeError, TypeError):
                        continue
                else:
                    await asyncio.sleep(0.1)
        finally:
            await pubsub.unsubscribe(self._channel(org_id))
            await pubsub.close()
            await client.aclose()


def publish_fire_and_forget(org_id: int, event_type: str, payload: dict[str, Any]) -> None:
    """Fire-and-forget publish helper. Safe to call from sync or async contexts."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    async def _do() -> None:
        try:
            bus = EventBus()
            await bus.publish(org_id, event_type, payload)
        except Exception:
            logger.debug('EventBus publish failed (fire-and-forget)', exc_info=True)

    loop.create_task(_do())
