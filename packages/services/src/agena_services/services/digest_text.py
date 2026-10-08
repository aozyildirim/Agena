"""Render a weekly digest dict as notification text. Pure; unit-tested."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


def _pct_delta(current: float, previous: float) -> Optional[int]:
    if previous <= 0:
        return None
    return int(round((current - previous) / previous * 100))


def _delta_str(current: float, previous: float) -> str:
    d = _pct_delta(current, previous)
    if d is None:
        return ''
    sign = '+' if d > 0 else ''
    return f' ({sign}{d}% vs previous week)'


def _tokens(n: int) -> str:
    if n >= 1_000_000:
        return f'{n / 1_000_000:.1f}M'
    if n >= 1_000:
        return f'{n / 1_000:.0f}k'
    return str(n)


def render(digest: Dict[str, Any]) -> Tuple[str, str]:
    """``(title, message)`` for NotificationService / e-mail / Slack."""
    org = digest.get('organization_name') or 'your organization'
    period = f"{digest.get('since', '')[:10]} – {digest.get('until', '')[:10]}"
    t = digest.get('tasks', {})
    p = digest.get('previous', {}).get('tasks', {})
    settled = int(t.get('completed', 0)) + int(t.get('failed', 0))
    rate = f" ({int(t.get('completed', 0)) * 100 // settled}% completion)" if settled else ''
    lines: List[str] = [
        f"Tasks: {t.get('created', 0)} created · {t.get('completed', 0)} completed · {t.get('failed', 0)} failed{rate}"
        f"{_delta_str(t.get('completed', 0), p.get('completed', 0))}",
        f"Pull requests opened: {digest.get('prs_opened', 0)}",
    ]
    f = digest.get('flows', {})
    if f.get('runs'):
        lines.append(f"Flow runs: {f['runs']} ({f.get('failed', 0)} failed)")
    ai = digest.get('ai', {})
    prev_ai = digest.get('previous', {}).get('ai', {})
    if ai.get('calls'):
        top = ', '.join(f"{m['model']} (${m['cost_usd']:.2f})" for m in ai.get('top_models', [])[:3])
        lines.append(
            f"AI usage: {ai['calls']} calls · {_tokens(int(ai.get('tokens', 0)))} tokens · ${float(ai.get('cost_usd', 0)):.2f}"
            f"{_delta_str(float(ai.get('cost_usd', 0)), float(prev_ai.get('cost_usd', 0)))}"
            + (f"; top models: {top}" if top else '')
        )
    a = digest.get('audit', {})
    lines.append(f"Audit: {a.get('events', 0)} actions by {a.get('actors', 0)} people; {a.get('security_alerts', 0)} security alerts")
    actors = a.get('top_actors') or []
    if actors:
        lines.append('Most active: ' + ', '.join(f"{x['email']} ({x['events']})" for x in actors[:3]))
    title = f'Weekly digest · {org}'
    return title, f'{period}\n' + '\n'.join(lines)
