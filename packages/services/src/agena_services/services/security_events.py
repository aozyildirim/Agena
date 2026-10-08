"""Which audit-trail events deserve a security alert, and how to word them.

Pure module: no ORM, no I/O — the rules are unit-tested on a bare checkout
and applied by SecurityAlertService.
"""

from __future__ import annotations

from typing import Any, Mapping, NamedTuple, Optional

SECURITY_ALERT_EVENT = 'security_alert'
# A sign-in counts as "new" when the user has signed in within this window
# but never from this address.
NEW_LOGIN_WINDOW_DAYS = 90


class Alert(NamedTuple):
    title: str
    message: str
    severity: str
    # Also tell the account owner, not just org owners/admins.
    account_scoped: bool


# action → (title, severity, account_scoped)
_RULES = {
    'auth.change_password': ('Password changed', 'info', True),
    'auth.logout_all': ('Signed out of all sessions', 'info', True),
    'api-keys.create_api_key': ('API key created', 'warning', False),
    'api-keys.revoke_api_key': ('API key revoked', 'info', False),
    'integrations.upsert_integration': ('Integration credentials updated', 'warning', False),
    'integrations.delete_integration': ('Integration removed', 'warning', False),
    'team.change_member_role': ('Member role changed', 'warning', False),
    'team.remove_member_by_email': ('Member removed', 'warning', False),
}


def _target_hint(action: str, details: Optional[Mapping[str, Any]]) -> str:
    params = (details or {}).get('path_params') or {}
    if not isinstance(params, Mapping):
        return ''
    if action.startswith('integrations.') and params.get('provider'):
        return f" ({params['provider']})"
    if action.startswith('api-keys.') and params.get('key_id'):
        return f" (#{params['key_id']})"
    return ''


def describe(
    action: str,
    status_code: int,
    actor_email: Optional[str],
    ip_address: Optional[str],
    details: Optional[Mapping[str, Any]] = None,
) -> Optional[Alert]:
    """The alert for a recorded request, or None when it is not security-relevant."""
    rule = _RULES.get(action)
    if rule is None or not (200 <= int(status_code or 0) < 300):
        return None
    title, severity, account_scoped = rule
    who = actor_email or 'someone'
    where = f' from {ip_address}' if ip_address else ''
    return Alert(title, f'{who}{where}: {title.lower()}{_target_hint(action, details)}.', severity, account_scoped)


def new_login_alert(actor_email: Optional[str], ip_address: Optional[str]) -> Alert:
    who = actor_email or 'someone'
    return Alert(
        'New sign-in from an unfamiliar address',
        f'{who} signed in from {ip_address or "an unknown address"} for the first time in {NEW_LOGIN_WINDOW_DAYS} days. '
        'If this was not you, sign out everywhere and change your password.',
        'warning',
        True,
    )
