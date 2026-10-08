"""Pure helpers that turn a handled request into an audit-log row.

Kept free of SQLAlchemy and FastAPI imports so they can be unit-tested on a
bare checkout and reused by callers that record events by hand.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, Mapping, Optional, Sequence, Tuple

MUTATING_METHODS = frozenset({'POST', 'PUT', 'PATCH', 'DELETE'})

# Query-string keys whose values never belong in an audit row.
_SENSITIVE_KEY_RE = re.compile(
    r'(token|secret|password|passwd|api[_-]?key|authorization|credential|signature)', re.I
)
_ACTION_SAFE_RE = re.compile(r'[^a-z0-9_.-]+')


def derive_action(route_name: Optional[str], tags: Sequence[str], method: str, path: str) -> str:
    """``<area>.<endpoint>`` — e.g. ``tasks.assign_task``, ``auth.login``.

    The router tag names the area; the endpoint function name is stable
    across path changes, which is what makes the column filterable over
    time. Falls back to the first path segment / the HTTP method.
    """
    area = (tags[0] if tags else '').strip().lower()
    if not area:
        segments = [s for s in path.split('/') if s]
        area = segments[0].lower() if segments else 'root'
    name = (route_name or '').strip().lower() or method.lower()
    return _ACTION_SAFE_RE.sub('_', f'{area}.{name}')[:96]


def derive_target(path_params: Mapping[str, Any], path: str) -> Tuple[Optional[str], Optional[str]]:
    """Best-effort subject of the request, from its path parameters.

    ``/tasks/{task_id}/attachments/{attachment_id}`` → ``('task', '12')``:
    the first ``*_id`` parameter names what the request is about, later
    ones are sub-resources. A bare ``{id}`` falls back to the first path
    segment, singularised.
    """
    for key, value in path_params.items():
        if key.endswith('_id') and len(key) > 3:
            return key[:-3], str(value)[:64]
    if 'id' in path_params:
        segments = [s for s in path.split('/') if s]
        base = segments[0] if segments else 'item'
        if base.endswith('s') and len(base) > 1:
            base = base[:-1]
        return base, str(path_params['id'])[:64]
    return None, None


def redact_query(items: Iterable[Tuple[str, Any]]) -> Dict[str, str]:
    """Query parameters with anything secret-shaped masked."""
    out: Dict[str, str] = {}
    for key, value in items:
        out[key] = '[redacted]' if _SENSITIVE_KEY_RE.search(key) else str(value)[:200]
    return out


def client_ip(headers: Mapping[str, str], fallback: Optional[str]) -> Optional[str]:
    """Originating address behind nginx / Cloudflare, else the socket peer."""
    forwarded = headers.get('x-forwarded-for') or ''
    if forwarded:
        return forwarded.split(',')[0].strip()[:64] or None
    real = headers.get('x-real-ip')
    if real:
        return real.strip()[:64] or None
    return fallback or None
