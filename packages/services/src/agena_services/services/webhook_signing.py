"""Pure helpers for outbound webhooks: secrets, signatures, retry schedule,
event matching. No I/O, unit-tested on a bare checkout."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Iterable, Sequence

SECRET_PREFIX = 'whsec_'
SIGNATURE_HEADER = 'X-Agena-Signature'
# Retry delays after each failed attempt; the list length is the attempt cap.
BACKOFF_SECONDS: Sequence[int] = (60, 300, 1800, 7200, 28800)
MAX_ATTEMPTS = len(BACKOFF_SECONDS) + 1
# An endpoint that fails this many deliveries in a row is switched off.
AUTO_DISABLE_AFTER = 20


def generate_secret() -> str:
    return f'{SECRET_PREFIX}{secrets.token_urlsafe(24)}'


def sign(secret: str, timestamp: str, body: bytes) -> str:
    """``sha256=<hex>`` over ``"<timestamp>.<body>"`` — the timestamp is
    part of the signed text so a captured delivery cannot be replayed with
    a new one."""
    mac = hmac.new(secret.encode('utf-8'), f'{timestamp}.'.encode('utf-8') + body, hashlib.sha256)
    return f'sha256={mac.hexdigest()}'


def verify(secret: str, timestamp: str, body: bytes, signature: str) -> bool:
    return hmac.compare_digest(sign(secret, timestamp, body), signature or '')


def backoff_seconds(attempts_so_far: int) -> int | None:
    """Delay before the next try after ``attempts_so_far`` failures, or None
    when the delivery should be given up."""
    if attempts_so_far <= 0:
        return BACKOFF_SECONDS[0]
    if attempts_so_far > len(BACKOFF_SECONDS):
        return None
    return BACKOFF_SECONDS[attempts_so_far - 1]


def event_matches(subscribed: Iterable[str] | None, event_type: str) -> bool:
    """``['*']`` (or empty) means everything; ``task.*``-style prefixes match
    by prefix; otherwise exact."""
    subs = [s.strip() for s in (subscribed or []) if s and s.strip()]
    if not subs or '*' in subs:
        return True
    for s in subs:
        if s == event_type:
            return True
        if s.endswith('*') and event_type.startswith(s[:-1]):
            return True
    return False
