"""Subdomain-based tenant resolution middleware.

Extracts the organization slug from the ``Host`` header (e.g.
``acme.agena.app`` -> ``acme``) or from the ``X-Tenant-Slug`` header
(useful for local development where real subdomains aren't available).

The resolved ``organization_id`` is stored in ``request.state.tenant_org_id``
so downstream dependencies can read it without a second DB lookup.
"""

from __future__ import annotations

import logging
import re

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_core.database import SessionLocal
from agena_models.models.organization import Organization

logger = logging.getLogger(__name__)

# Routes that should bypass tenant resolution entirely.
_SKIP_PREFIXES = (
    '/health',
    '/docs',
    '/openapi.json',
    '/redoc',
    '/auth/',
    '/invites/',
)

# Known non-tenant host prefixes (bare domain, system subdomains, localhost, IP addresses).
_NON_TENANT_SUBDOMAINS = {
    'api',
    'www',
    'localhost',
}

# Bare hosts/IPs that should never be treated as tenant slugs.
_BARE_HOST_RE = re.compile(
    r'^(127\.\d+\.\d+\.\d+|0\.0\.0\.0|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$'
)


def _extract_slug_from_host(host: str) -> str | None:
    """Return the subdomain slug from a host like ``acme.agena.app:3010``.

    Returns ``None`` when the host is a bare domain, IP, or localhost.
    """
    # Strip port
    hostname = host.split(':')[0]
    parts = hostname.split('.')
    if len(parts) < 3:
        # e.g. "agena.app" or "localhost" -- no subdomain
        return None
    subdomain = parts[0].lower()
    if subdomain in _NON_TENANT_SUBDOMAINS or _BARE_HOST_RE.match(subdomain):
        return None
    return subdomain


class TenantMiddleware(BaseHTTPMiddleware):
    """Resolve tenant from subdomain or ``X-Tenant-Slug`` header."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path

        # Skip routes that don't need tenant context.
        if any(path.startswith(prefix) for prefix in _SKIP_PREFIXES):
            return await call_next(request)

        # 1. Try subdomain from Host header
        host = request.headers.get('host', '')
        slug = _extract_slug_from_host(host)

        # 2. Fallback: X-Tenant-Slug header (local dev)
        if not slug:
            slug = request.headers.get('x-tenant-slug')

        # If no slug resolved, let the request pass through -- the auth
        # dependency will still enforce org membership via the JWT token.
        if not slug:
            request.state.tenant_org_id = None
            return await call_next(request)

        # Look up organization by slug
        async with SessionLocal() as session:
            result = await session.execute(
                select(Organization.id).where(Organization.slug == slug)
            )
            org_id = result.scalar_one_or_none()

        if org_id is None:
            return JSONResponse(
                status_code=404,
                content={'detail': f'Organization not found for slug: {slug}'},
            )

        request.state.tenant_org_id = org_id
        return await call_next(request)
