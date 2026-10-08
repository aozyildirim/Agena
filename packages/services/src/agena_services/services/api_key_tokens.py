"""Pure helpers for organization API keys: format, hashing, role capping.

No SQLAlchemy or FastAPI imports, so the rules can be unit-tested on a bare
checkout and the auth dependency can call them without side effects.
"""

from __future__ import annotations

import hashlib
import secrets
from typing import Optional, Tuple

KEY_PREFIX = 'agena_'
# Keys never carry the owner role: billing and org deletion stay interactive.
MAX_KEY_ROLE = 'admin'

_ROLE_RANK = {'viewer': 0, 'member': 1, 'admin': 2, 'owner': 3}


def generate_key() -> Tuple[str, str]:
    """``(plaintext, display_prefix)``. 24 random bytes → 32 url-safe chars."""
    plain = f'{KEY_PREFIX}{secrets.token_urlsafe(24)}'
    return plain, display_prefix(plain)


def display_prefix(plain: str) -> str:
    """What the dashboard shows after creation: ``agena_`` plus 8 chars."""
    return plain[: len(KEY_PREFIX) + 8]


def hash_key(plain: str) -> str:
    """Keys are high-entropy, so a plain SHA-256 is enough — and it keeps the
    lookup a single indexed equality instead of a bcrypt verify per request."""
    return hashlib.sha256(plain.encode('utf-8')).hexdigest()


def is_api_key(token: str) -> bool:
    return bool(token) and token.startswith(KEY_PREFIX)


def role_rank(role: Optional[str]) -> int:
    return _ROLE_RANK.get((role or '').strip().lower(), -1)


def cap_role(requested: str, creator_role: str) -> Optional[str]:
    """The role a new key may carry, or None when ``requested`` is not grantable.

    A key can never exceed its creator's role, nor ``MAX_KEY_ROLE``.
    """
    req = (requested or '').strip().lower()
    if req not in _ROLE_RANK:
        return None
    if role_rank(req) > role_rank(MAX_KEY_ROLE):
        return None
    if role_rank(req) > role_rank(creator_role):
        return None
    return req


def effective_role(key_role: str, member_role: str) -> str:
    """At request time a key is worth the lesser of its own role and its
    creator's *current* role, so demoting someone also demotes their keys."""
    return key_role if role_rank(key_role) <= role_rank(member_role) else member_role
