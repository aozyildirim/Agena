"""Plan tier definitions for per-organization billing quotas."""

from __future__ import annotations

from typing import Any

PLANS: dict[str, dict[str, Any]] = {
    'free': {
        'name': 'Free',
        'max_tasks_per_month': 50,
        'max_members': 10,
        'max_agents': 10,
        'features': ['basic_orchestration', 'advanced_analytics', 'custom_agents'],
    },
    'pro': {
        'name': 'Pro',
        'max_tasks_per_month': -1,  # unlimited
        'max_members': -1,
        'max_agents': -1,
        'features': ['basic_orchestration', 'advanced_analytics', 'priority_queue', 'custom_agents'],
    },
    'enterprise': {
        'name': 'Enterprise',
        'max_tasks_per_month': -1,  # unlimited
        'max_members': -1,
        'max_agents': -1,
        'features': ['basic_orchestration', 'advanced_analytics', 'priority_queue', 'custom_agents', 'sso', 'audit_log'],
    },
}


def get_plan(plan_name: str) -> dict[str, Any]:
    """Return plan dict for *plan_name*, falling back to ``free``."""
    return PLANS.get(plan_name, PLANS['free'])
