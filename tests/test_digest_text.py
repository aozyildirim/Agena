"""Weekly digest rendering.

    PYTHONPATH=packages/services/src python -m pytest tests/test_digest_text.py
"""

from agena_services.services.digest_text import render

BASE = {
    'organization_name': 'Northwind', 'since': '2026-10-01T06:00', 'until': '2026-10-08T06:00',
    'tasks': {'created': 12, 'completed': 9, 'failed': 1}, 'prs_opened': 7,
    'flows': {'runs': 15, 'failed': 2},
    'ai': {'calls': 134, 'tokens': 1_234_567, 'cost_usd': 14.2, 'top_models': [{'model': 'gpt-5', 'cost_usd': 9.1}, {'model': 'gemini-2.5-pro', 'cost_usd': 5.1}]},
    'audit': {'events': 212, 'actors': 5, 'security_alerts': 3, 'top_actors': [{'email': 'ali@example.com', 'events': 88}]},
    'previous': {'tasks': {'created': 10, 'completed': 8, 'failed': 2}, 'ai': {'calls': 100, 'tokens': 900_000, 'cost_usd': 15.5}},
}


def test_render_full_digest():
    title, message = render(BASE)
    assert title == 'Weekly digest · Northwind'
    lines = message.split('\n')
    assert lines[0] == '2026-10-01 – 2026-10-08'
    assert lines[1] == 'Tasks: 12 created · 9 completed · 1 failed (90% completion) (+12% vs previous week)'
    assert lines[2] == 'Pull requests opened: 7'
    assert lines[3] == 'Flow runs: 15 (2 failed)'
    assert lines[4].startswith('AI usage: 134 calls · 1.2M tokens · $14.20 (-8% vs previous week); top models: gpt-5 ($9.10), gemini-2.5-pro ($5.10)')
    assert lines[5] == 'Audit: 212 actions by 5 people; 3 security alerts'
    assert lines[6] == 'Most active: ali@example.com (88)'


def test_render_quiet_week_omits_empty_sections_and_deltas():
    quiet = {**BASE, 'tasks': {'created': 0, 'completed': 0, 'failed': 0}, 'prs_opened': 0, 'flows': {'runs': 0, 'failed': 0},
             'ai': {'calls': 0, 'tokens': 0, 'cost_usd': 0}, 'audit': {'events': 0, 'actors': 0, 'security_alerts': 0, 'top_actors': []}, 'previous': {}}
    title, message = render(quiet)
    assert 'Flow runs' not in message and 'AI usage' not in message and 'Most active' not in message
    assert 'vs previous week' not in message
    assert 'Tasks: 0 created · 0 completed · 0 failed' in message


def test_render_without_org_name():
    title, _ = render({**BASE, 'organization_name': None})
    assert title == 'Weekly digest · your organization'
