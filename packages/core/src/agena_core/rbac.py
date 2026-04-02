"""Role-Based Access Control (RBAC) definitions.

Defines four roles (owner, admin, member, viewer) and a permission matrix
that maps each permission to the roles allowed to use it.
"""

from __future__ import annotations

ROLES = ('owner', 'admin', 'member', 'viewer')

# permission -> set of roles that have it
PERMISSION_MATRIX: dict[str, set[str]] = {
    'tasks:read':          {'owner', 'admin', 'member', 'viewer'},
    'tasks:write':         {'owner', 'admin', 'member'},
    'integrations:manage': {'owner', 'admin'},
    'team:manage':         {'owner', 'admin'},
    'billing:manage':      {'owner'},
    'org:manage':          {'owner'},
    'roles:manage':        {'owner', 'admin'},
}


def has_permission(role: str, permission: str) -> bool:
    """Return *True* if *role* is allowed *permission*."""
    allowed = PERMISSION_MATRIX.get(permission)
    if allowed is None:
        return False
    return role in allowed
