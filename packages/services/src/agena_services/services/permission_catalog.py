"""Static catalog of permission keys grouped for the role-editor UI.

Adding a new permission means:
  1. Append the key here under the right group
  2. Apply ``require_workspace_perm("group:action")`` to the endpoint
  3. Re-deploy — existing roles default to NOT having it; org owner has
     to opt in via /dashboard/permissions

The grouping mirrors the dashboard sidebar so the matrix UI maps 1:1
to the user's mental model.
"""
from __future__ import annotations


PERMISSION_GROUPS: list[dict] = [
    {
        'group': 'workspace',
        'label': 'Workspace',
        'icon': '🗄',
        'permissions': [
            ('workspace:create', 'Create new workspaces in this organization'),
            ('workspace:delete', 'Delete a workspace'),
            ('workspace:manage', 'Edit workspace name / description / settings'),
            ('workspace:invite', 'Generate / rotate invite codes'),
        ],
    },
    {
        'group': 'members',
        'label': 'Members',
        'icon': '👥',
        'permissions': [
            ('members:add', 'Add members to a workspace'),
            ('members:remove', 'Remove members from a workspace'),
            ('members:assign-role', 'Change a member\'s role'),
        ],
    },
    {
        'group': 'tasks',
        'label': 'Tasks',
        'icon': '📋',
        'permissions': [
            ('tasks:create', 'Create new tasks'),
            ('tasks:edit', 'Edit task title / description / metadata'),
            ('tasks:delete', 'Delete tasks'),
            ('tasks:assign', 'Assign a task to AI / a teammate'),
            ('tasks:run-ai', 'Trigger an AI run on a task'),
        ],
    },
    {
        'group': 'sprints',
        'label': 'Sprints',
        'icon': '🗂',
        'permissions': [
            ('sprint:select', 'Pick which sprint is active for the workspace'),
            ('sprint:create', 'Create new sprints'),
            ('sprint:assign-task', 'Move tasks between sprints'),
        ],
    },
    {
        'group': 'code',
        'label': 'Code & Pull Requests',
        'icon': '🧑‍💻',
        'permissions': [
            ('code:write', 'AI agent runs that write code'),
            ('pr:create', 'Open pull requests'),
            ('pr:merge', 'Merge pull requests'),
            ('pr:close', 'Close / abandon pull requests'),
        ],
    },
    {
        'group': 'review',
        'label': 'Review',
        'icon': '🔎',
        'permissions': [
            ('review:request', 'Request a review'),
            ('review:approve', 'Approve a review'),
        ],
    },
    {
        'group': 'refinement',
        'label': 'Refinement',
        'icon': '🔬',
        'permissions': [
            ('refinement:run', 'Run AI refinement on a task'),
            ('refinement:approve', 'Approve / write back refinement results'),
        ],
    },
    {
        'group': 'repos',
        'label': 'Repositories',
        'icon': '🗺',
        'permissions': [
            ('repo:manage', 'Add / edit / remove repo mappings'),
        ],
    },
    {
        'group': 'ai',
        'label': 'AI agents & flows',
        'icon': '🤖',
        'permissions': [
            ('agents:manage', 'Create / edit / delete AI agents'),
            ('flows:manage', 'Create / edit / delete flows'),
            ('prompts:edit', 'Edit prompts in Prompt Studio'),
        ],
    },
    {
        'group': 'pages',
        'label': 'Pages',
        'icon': '📑',
        'permissions': [
            ('pages:office', 'View the Office home dashboard'),
            ('pages:triage', 'View the Triage inbox'),
            ('pages:review-backlog', 'View the Review Backlog'),
            ('pages:skills', 'View the Skills library'),
            ('pages:runtimes', 'View Runtimes'),
            ('pages:insights', 'View Insights'),
            ('pages:reviews', 'View the Reviews list'),
            ('pages:templates', 'View flow Templates'),
        ],
    },
    {
        'group': 'settings',
        'label': 'Settings',
        'icon': '⚙',
        'permissions': [
            ('integrations:manage', 'Connect / disconnect Sentry, Jira, GitHub etc.'),
            ('modules:configure', 'Toggle modules on / off for the org'),
            ('billing:read', 'See billing / invoices'),
            ('billing:manage', 'Change plan / payment method'),
            ('analytics:read', 'View DORA / analytics dashboards'),
        ],
    },
]


def all_permission_keys() -> list[str]:
    keys: list[str] = []
    for group in PERMISSION_GROUPS:
        for key, _ in group['permissions']:
            keys.append(key)
    return keys


def is_known(key: str) -> bool:
    return key in all_permission_keys()
