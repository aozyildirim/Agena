"""Structured request logging middleware.

Logs every request as a JSON line to stdout so Docker logs can capture it.
Fields: timestamp, org_id, user_id, method, path, status_code, duration_ms.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from agena_core.security.jwt import decode_token

logger = logging.getLogger('api.request_log')

# Paths to exclude from logging (noisy / health probes).
_SKIP_PREFIXES = (
    '/health',
    '/docs',
    '/openapi.json',
    '/redoc',
)


class RequestLoggerMiddleware(BaseHTTPMiddleware):
    """Emit one structured JSON log line per request."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path

        if any(path.startswith(prefix) for prefix in _SKIP_PREFIXES):
            return await call_next(request)

        start = time.perf_counter()
        org_id, user_id = self._extract_identity(request)

        response: Response | None = None
        try:
            response = await call_next(request)
            return response
        finally:
            duration_ms = round((time.perf_counter() - start) * 1000)
            status_code = response.status_code if response else 500
            log_entry = {
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'org_id': org_id,
                'user_id': user_id,
                'method': request.method,
                'path': path,
                'status_code': status_code,
                'duration_ms': duration_ms,
            }
            logger.info(json.dumps(log_entry, ensure_ascii=False))

    @staticmethod
    def _extract_identity(request: Request) -> tuple[int | None, int | None]:
        auth_header = request.headers.get('authorization', '')
        if not auth_header.lower().startswith('bearer '):
            return None, None
        token = auth_header[7:].strip()
        if not token:
            return None, None
        try:
            payload = decode_token(token)
            org_id = int(payload.get('org_id', 0) or 0) or None
            user_id = int(payload.get('user_id', 0) or 0) or None
            return org_id, user_id
        except (ValueError, Exception):
            return None, None
