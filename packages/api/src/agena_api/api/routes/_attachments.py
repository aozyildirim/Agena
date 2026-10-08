"""Hardened responses for user-supplied attachment bytes.

Attachments are arbitrary tenant uploads, and the ``/share/...`` variants hand
them to anonymous visitors on our own origin. Two rules keep that safe:

* only inert types are rendered in the browser — everything else is downgraded
  to an ``application/octet-stream`` download;
* the browser is told not to second-guess the type we declare (``nosniff``).

``image/svg+xml`` is deliberately absent from the allowlist. It satisfies a
naive ``content_type.startswith('image/')`` check but carries script, so an
SVG served inline from our origin is same-origin script execution.
"""

from __future__ import annotations

import os

from fastapi.responses import FileResponse

#: Image types a browser renders without executing anything they contain.
INLINE_SAFE_IMAGE_TYPES = frozenset({
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/x-icon',
})

NOSNIFF = {'X-Content-Type-Options': 'nosniff'}


def normalize_content_type(content_type: str | None) -> str:
    """Strip parameters and casing off a declared content type."""
    return (content_type or '').split(';', 1)[0].strip().lower()


def is_inline_safe_image(content_type: str | None) -> bool:
    return normalize_content_type(content_type) in INLINE_SAFE_IMAGE_TYPES


def attachment_response(
    path: str | os.PathLike[str],
    content_type: str | None,
    filename: str,
) -> FileResponse:
    """Serve a stored attachment, rendering only inert images inline."""
    declared = normalize_content_type(content_type)
    inline = declared in INLINE_SAFE_IMAGE_TYPES
    return FileResponse(
        path=str(path),
        media_type=declared if inline else 'application/octet-stream',
        filename=filename,
        content_disposition_type='inline' if inline else 'attachment',
        headers=dict(NOSNIFF),
    )
