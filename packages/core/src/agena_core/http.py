"""Central SSL/HTTP configuration. Import this module early (before any httpx clients are created)."""
from __future__ import annotations

import os

import httpx


def _apply_ssl_patch() -> None:
    verify = os.getenv('SSL_VERIFY', 'true').strip().lower()
    if verify in ('false', '0', 'no'):
        _orig_async = httpx.AsyncClient.__init__
        _orig_sync = httpx.Client.__init__

        def _async_init(self: httpx.AsyncClient, *args: object, **kwargs: object) -> None:
            kwargs['verify'] = False
            _orig_async(self, *args, **kwargs)

        def _sync_init(self: httpx.Client, *args: object, **kwargs: object) -> None:
            kwargs['verify'] = False
            _orig_sync(self, *args, **kwargs)

        httpx.AsyncClient.__init__ = _async_init  # type: ignore[method-assign]
        httpx.Client.__init__ = _sync_init  # type: ignore[method-assign]


_apply_ssl_patch()
