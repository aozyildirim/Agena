"""Audit-trail middleware.

After a request has been handled, if it was state-changing and made by an
authenticated member, write one ``audit_logs`` row describing it. By then
everything needed is already on the request:

* ``request.state.tenant`` — set by ``get_current_tenant``, so only
  requests that passed authentication and the org-membership check are
  recorded. Anonymous endpoints (login, inbound webhooks, share links)
  never produce a row; login/signup are recorded explicitly by their routes.
* ``request.scope['route']`` — the matched APIRoute, whose path template
  and endpoint name make up the stable ``action`` column.
* ``request.state.request_id`` — from RequestIDMiddleware, for correlation
  with the structured request log.

Only metadata is recorded, never the body. The recorder is injectable so
the rules can be tested without a database; failures are logged and
swallowed — this middleware cannot change a response.
"""

from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable, Dict, Optional

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from agena_services.services.audit_actions import (
    MUTATING_METHODS,
    client_ip,
    derive_action,
    derive_target,
    redact_query,
)

logger = logging.getLogger(__name__)

Recorder = Callable[..., Awaitable[None]]


async def _default_recorder(**fields: Any) -> None:
    # Imported lazily so this module stays importable without a database.
    from agena_services.services.audit_service import record_request

    await record_request(**fields)


class AuditMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Any, recorder: Optional[Recorder] = None) -> None:
        super().__init__(app)
        self._record = recorder or _default_recorder

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        if request.method in MUTATING_METHODS:
            try:
                fields = self.describe(request, response.status_code)
                if fields is not None:
                    await self._record(**fields)
            except Exception:
                logger.warning('audit: could not record %s %s', request.method, request.url.path, exc_info=True)
        return response

    @staticmethod
    def describe(request: Request, status_code: int) -> Optional[Dict[str, Any]]:
        """The row for this request, or None when nobody authenticated."""
        tenant = getattr(request.state, 'tenant', None)
        if tenant is None:
            return None

        route = request.scope.get('route')
        template = getattr(route, 'path', None)
        path = request.url.path
        target_type, target_id = derive_target(request.path_params, path)

        details: Dict[str, Any] = {}
        if request.path_params:
            details['path_params'] = {k: str(v)[:64] for k, v in request.path_params.items()}
        query = redact_query(request.query_params.multi_items())
        if query:
            details['query'] = query
        api_key_id = getattr(tenant, 'api_key_id', None)
        if api_key_id is not None:
            details['api_key_id'] = api_key_id

        return dict(
            organization_id=tenant.organization_id,
            workspace_id=getattr(tenant, 'workspace_id', None),
            actor_user_id=tenant.user_id,
            actor_email=tenant.email,
            actor_role=tenant.role,
            action=derive_action(getattr(route, 'name', None), list(getattr(route, 'tags', None) or []), request.method, template or path),
            method=request.method,
            path=path,
            route=template,
            target_type=target_type,
            target_id=target_id,
            status_code=int(status_code),
            request_id=getattr(request.state, 'request_id', None),
            ip_address=client_ip(request.headers, request.client.host if request.client else None),
            user_agent=request.headers.get('user-agent'),
            details=details or None,
        )
