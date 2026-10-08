"""Outbound webhooks: customer endpoints, event fan-out with dedupe, and
signed delivery with retries.

Events enter through ``emit_once`` (called from NotificationService for
every notification event, deduped per event instance in Redis) and are
delivered by the worker's poll via ``deliver_due``.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import logging
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import httpx
from redis.asyncio import Redis
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from agena_core.settings import get_settings
from agena_models.models.webhook_endpoint import WebhookDelivery, WebhookEndpoint
from agena_services.services.webhook_signing import (
    AUTO_DISABLE_AFTER,
    SIGNATURE_HEADER,
    backoff_seconds,
    event_matches,
    generate_secret,
    sign,
)

logger = logging.getLogger(__name__)

DELIVERY_TIMEOUT = 10.0
DUE_BATCH = 50
DEDUPE_TTL = 15
USER_AGENT = 'Agena-Webhooks/1.0 (+https://agena.dev)'

_redis: Redis | None = None


def _redis_client() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(get_settings().redis_url, decode_responses=True)
    return _redis


def _is_private_host(host: str | None) -> bool:
    """Plain http is only accepted towards the local machine or a private
    network — self-hosted receivers behind the same firewall — never to
    the public internet."""
    if not host:
        return False
    if host in ('localhost', 'host.docker.internal') or host.endswith('.local') or host.endswith('.internal'):
        return True
    try:
        return ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _validate_url(url: str) -> str:
    u = (url or '').strip()
    parsed = urlparse(u)
    if parsed.scheme not in ('https', 'http') or not parsed.netloc:
        raise ValueError('URL must start with http:// or https://')
    if parsed.scheme == 'http' and not _is_private_host(parsed.hostname):
        raise ValueError('Only https:// URLs are accepted (http is allowed for localhost and private networks)')
    return u[:1024]


class WebhookService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── endpoints ───────────────────────────────────────────────────────
    async def create(self, *, organization_id: int, user_id: int, name: str, url: str,
                     events: list[str] | None = None, enabled: bool = True) -> WebhookEndpoint:
        clean_name = (name or '').strip()
        if not clean_name:
            raise ValueError('Name is required')
        row = WebhookEndpoint(
            organization_id=organization_id, created_by_user_id=user_id, name=clean_name[:120],
            url=_validate_url(url), secret=generate_secret(), events=[e for e in (events or ['*']) if e] or ['*'], enabled=enabled,
        )
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def list(self, organization_id: int) -> list[WebhookEndpoint]:
        rows = await self.db.execute(
            select(WebhookEndpoint).where(WebhookEndpoint.organization_id == organization_id).order_by(WebhookEndpoint.created_at.desc())
        )
        return list(rows.scalars().all())

    async def get_owned(self, organization_id: int, endpoint_id: int) -> WebhookEndpoint | None:
        row = await self.db.get(WebhookEndpoint, endpoint_id)
        return row if row is not None and row.organization_id == organization_id else None

    async def update(self, row: WebhookEndpoint, *, name: str | None = None, url: str | None = None,
                     events: list[str] | None = None, enabled: bool | None = None) -> WebhookEndpoint:
        if name is not None and name.strip():
            row.name = name.strip()[:120]
        if url is not None:
            row.url = _validate_url(url)
        if events is not None:
            row.events = [e for e in events if e] or ['*']
        if enabled is not None:
            row.enabled = bool(enabled)
            if enabled:
                row.failure_count = 0
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def rotate_secret(self, row: WebhookEndpoint) -> WebhookEndpoint:
        row.secret = generate_secret()
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def delete(self, row: WebhookEndpoint) -> None:
        await self.db.delete(row)
        await self.db.commit()

    async def list_deliveries(self, organization_id: int, endpoint_id: int, limit: int = 30) -> list[WebhookDelivery]:
        rows = await self.db.execute(
            select(WebhookDelivery)
            .where(WebhookDelivery.organization_id == organization_id, WebhookDelivery.endpoint_id == endpoint_id)
            .order_by(WebhookDelivery.id.desc())
            .limit(limit)
        )
        return list(rows.scalars().all())

    # ── emission ────────────────────────────────────────────────────────
    async def emit(self, organization_id: int, event_type: str, payload: dict[str, Any]) -> int:
        """Queue one delivery per enabled, subscribed endpoint. Returns count."""
        endpoints = await self.db.execute(
            select(WebhookEndpoint).where(WebhookEndpoint.organization_id == organization_id, WebhookEndpoint.enabled.is_(True))
        )
        now = datetime.utcnow()
        queued = 0
        for ep in endpoints.scalars().all():
            if not event_matches(ep.events, event_type):
                continue
            self.db.add(WebhookDelivery(
                organization_id=organization_id, endpoint_id=ep.id, event_type=event_type,
                payload=payload, status='pending', attempts=0, next_attempt_at=now,
            ))
            queued += 1
        if queued:
            await self.db.commit()
        return queued

    async def emit_once(self, organization_id: int, event_type: str, payload: dict[str, Any], dedupe_key: str) -> int:
        """emit(), but at most once per ``dedupe_key`` within DEDUPE_TTL —
        notification events fire once per recipient user, webhooks must not."""
        digest = hashlib.sha256(f'{organization_id}:{event_type}:{dedupe_key}'.encode('utf-8')).hexdigest()
        try:
            fresh = await _redis_client().set(f'wh:dedupe:{digest}', '1', ex=DEDUPE_TTL, nx=True)
            if not fresh:
                return 0
        except Exception:
            logger.debug('webhook dedupe unavailable, emitting anyway', exc_info=True)
        return await self.emit(organization_id, event_type, payload)

    # ── delivery ────────────────────────────────────────────────────────
    async def due(self, now: datetime | None = None) -> list[WebhookDelivery]:
        now = now or datetime.utcnow()
        rows = await self.db.execute(
            select(WebhookDelivery)
            .where(WebhookDelivery.status == 'pending', WebhookDelivery.next_attempt_at <= now)
            .order_by(WebhookDelivery.next_attempt_at)
            .limit(DUE_BATCH)
        )
        return list(rows.scalars().all())

    async def claim(self, delivery: WebhookDelivery) -> bool:
        result = await self.db.execute(
            update(WebhookDelivery)
            .where(WebhookDelivery.id == delivery.id, WebhookDelivery.status == 'pending')
            .values(status='sending')
        )
        await self.db.commit()
        return result.rowcount == 1

    async def deliver(self, delivery: WebhookDelivery) -> bool:
        """POST one delivery and record the outcome. Returns True on 2xx."""
        endpoint = await self.db.get(WebhookEndpoint, delivery.endpoint_id)
        now = datetime.utcnow()
        if endpoint is None or not endpoint.enabled:
            delivery.status = 'failed'
            delivery.last_error = 'Endpoint disabled or deleted'
            await self.db.commit()
            return False

        body_obj = {
            'id': delivery.id,
            'event': delivery.event_type,
            'created_at': (delivery.created_at or now).isoformat() + 'Z',
            'organization_id': delivery.organization_id,
            'data': delivery.payload or {},
        }
        body = json.dumps(body_obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        timestamp = str(int(now.timestamp()))
        headers = {
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
            'X-Agena-Event': delivery.event_type,
            'X-Agena-Delivery-Id': str(delivery.id),
            'X-Agena-Timestamp': timestamp,
            SIGNATURE_HEADER: sign(endpoint.secret, timestamp, body),
        }
        delivery.attempts = int(delivery.attempts or 0) + 1
        ok = False
        try:
            async with httpx.AsyncClient(timeout=DELIVERY_TIMEOUT, follow_redirects=False) as client:
                resp = await client.post(endpoint.url, content=body, headers=headers)
            delivery.response_status = resp.status_code
            ok = 200 <= resp.status_code < 300
            delivery.last_error = None if ok else f'HTTP {resp.status_code}: {resp.text[:300]}'
        except Exception as exc:
            delivery.response_status = None
            delivery.last_error = f'{type(exc).__name__}: {str(exc)[:300]}'

        endpoint.last_delivery_at = now
        if ok:
            delivery.status = 'delivered'
            delivery.delivered_at = now
            delivery.next_attempt_at = None
            endpoint.failure_count = 0
            endpoint.last_status = 'ok'
        else:
            delay = backoff_seconds(delivery.attempts)
            endpoint.failure_count = int(endpoint.failure_count or 0) + 1
            endpoint.last_status = 'failing'
            if delay is None:
                delivery.status = 'failed'
                delivery.next_attempt_at = None
            else:
                delivery.status = 'pending'
                delivery.next_attempt_at = now + timedelta(seconds=delay)
            if endpoint.failure_count >= AUTO_DISABLE_AFTER:
                endpoint.enabled = False
                endpoint.last_status = 'disabled'
        await self.db.commit()
        return ok

    async def send_test(self, endpoint: WebhookEndpoint) -> WebhookDelivery:
        """Queue and immediately deliver a `ping` so the customer can see a
        signed request land."""
        delivery = WebhookDelivery(
            organization_id=endpoint.organization_id, endpoint_id=endpoint.id, event_type='ping',
            payload={'message': 'Agena webhook test', 'endpoint': endpoint.name}, status='sending', attempts=0,
            next_attempt_at=datetime.utcnow(),
        )
        self.db.add(delivery)
        await self.db.commit()
        await self.db.refresh(delivery)
        await self.deliver(delivery)
        await self.db.refresh(delivery)
        return delivery
