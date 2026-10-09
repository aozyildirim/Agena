"""Pure parsing helpers shared by the provider syncs in ``git_sync_service``."""

from __future__ import annotations

from datetime import datetime, timezone


def to_utc_naive(dt: datetime) -> datetime:
    """Every ``git_*`` column stores naive UTC.

    GitHub and Azure answer in UTC already, but GitLab stamps carry the
    instance's offset — dropping that without converting would shift the
    timestamp by the offset, and leaving it on makes every comparison against
    a naive cutoff raise TypeError.
    """
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def gitlab_next_params(
    next_page_header: str | None,
    params: dict[str, str] | None,
) -> dict[str, str] | None:
    """Advance a GitLab query to the next page.

    GitLab paginates with ``X-Next-Page``, which is empty on the last page.
    Returning None ends the caller's loop.
    """
    next_page = (next_page_header or '').strip()
    if not next_page or params is None:
        return None
    return {**params, 'page': next_page}
