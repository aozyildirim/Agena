"""Pure helpers for reading GitLab merge-request webhook payloads."""

from __future__ import annotations

from typing import Any


def _attrs(payload: dict[str, Any]) -> dict[str, Any]:
    attrs = payload.get('object_attributes')
    return attrs if isinstance(attrs, dict) else {}


def is_gitlab_merge_request_event(payload: dict[str, Any]) -> bool:
    return payload.get('object_kind') == 'merge_request'


def is_gitlab_mr_merged(payload: dict[str, Any]) -> bool:
    """True when a merge-request hook reports the MR has just been merged."""
    if not is_gitlab_merge_request_event(payload):
        return False
    attrs = _attrs(payload)
    return str(attrs.get('action') or '') == 'merge' or str(attrs.get('state') or '') == 'merged'


def gitlab_mr_url(payload: dict[str, Any]) -> str:
    """Web URL of the merge request, matching what ``create_mr`` stores on the task."""
    if not is_gitlab_merge_request_event(payload):
        return ''
    return str(_attrs(payload).get('url') or '').strip()
