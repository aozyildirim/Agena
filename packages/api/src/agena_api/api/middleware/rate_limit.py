"""Per-organization rate limiting middleware using Redis.

Limits are determined by the organization's subscription plan:
  - free:       100 requests / minute
  - pro:        500 requests / minute
  - enterprise: unlimited

The middleware inspects the JWT token to extract ``org_id`` and uses a Redis
sliding-window counter (key per org per minute) to enforce limits.  When the
limit is exceeded a ``429 Too Many Requests`` response is returned.

Unauthenticated routes (/health, /auth/*, /docs, webhooks) are excluded.
"""

from __future__ import annotations

import logging
import time

from redis.asyncio import Redis
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from agena_core.settings import get_settings
from agena_core.security.jwt import decode_token

logger = logging.getLogger(__name__)

# Routes that bypass rate limiting.
_SKIP_PREFIXES = (
    '/health',
    '/docs',
    '/openapi.json',
    '/redoc',
    '/auth/',
    '/webhooks/',
    '/ws',
)

# Plan -> max requests per minute.  ``0`` means unlimited.
_PLAN_LIMITS: dict[str, int] = {
    'free': 1500,
    'pro': 5000,
    'enterprise': 0,
}

_WINDOW_SECONDS = 60


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Redis-backed per-organization rate limiter."""

    def __init__(self, app, redis_client: Redis | None = None) -> None:  # type: ignore[override]
        super().__init__(app)
        if redis_client is not None:
            self._redis = redis_client
        else:
            settings = get_settings()
            self._redis = Redis.from_url(settings.redis_url, decode_responses=True)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path

        # Skip routes that don't need rate limiting.
        if any(path.startswith(prefix) for prefix in _SKIP_PREFIXES):
            return await call_next(request)

        # In development we don't want the sliding window to fight hot-reload
        # + multi-tab workflows — trust the operator.
        try:
            if (get_settings().app_env or '').strip().lower() in ('dev', 'development', 'local'):
                return await call_next(request)
        except Exception:
            pass

        # Extract org_id from the Bearer token (best-effort; if missing let
        # the auth dependency handle rejection).
        org_id = self._extract_org_id(request)
        if org_id is None:
            return await call_next(request)

        # Resolve plan from a cached Redis key set by billing or fallback to free.
        plan = await self._get_plan(org_id)
        limit = _PLAN_LIMITS.get(plan, _PLAN_LIMITS['free'])

        # Unlimited plans skip counting entirely.
        if limit == 0:
            return await call_next(request)

        # Sliding window counter: one key per org per minute bucket.
        now = int(time.time())
        bucket = now // _WINDOW_SECONDS
        key = f'rate_limit:org:{org_id}:{bucket}'

        try:
            current = await self._redis.incr(key)
            if current == 1:
                await self._redis.expire(key, _WINDOW_SECONDS + 5)
        except Exception:
            # If Redis is unavailable, allow the request through.
            logger.warning('Rate limit Redis unavailable, allowing request')
            return await call_next(request)

        if current > limit:
            retry_after = _WINDOW_SECONDS - (now % _WINDOW_SECONDS)
            return JSONResponse(
                status_code=429,
                content={'detail': 'Too many requests. Please try again later.'},
                headers={
                    'Retry-After': str(retry_after),
                    'X-RateLimit-Limit': str(limit),
                    'X-RateLimit-Remaining': '0',
                },
            )

        response = await call_next(request)
        response.headers['X-RateLimit-Limit'] = str(limit)
        response.headers['X-RateLimit-Remaining'] = str(max(0, limit - current))
        return response

    @staticmethod
    def _extract_org_id(request: Request) -> int | None:
        auth_header = request.headers.get('authorization', '')
        if not auth_header.lower().startswith('bearer '):
            return None
        token = auth_header[7:].strip()
        if not token:
            return None
        try:
            payload = decode_token(token)
            org_id = int(payload.get('org_id', 0) or 0)
            return org_id if org_id > 0 else None
        except (ValueError, Exception):
            return None

    async def _get_plan(self, org_id: int) -> str:
        """Look up plan from Redis cache; default to 'free' if not cached.

        The billing service should set ``plan:org:<id>`` when the plan changes.
        """
        try:
            cached = await self._redis.get(f'plan:org:{org_id}')
            if cached and cached in _PLAN_LIMITS:
                return cached
        except Exception:
            pass
        return 'free'
