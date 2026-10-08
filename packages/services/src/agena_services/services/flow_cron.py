"""Five-field cron parsing and next-run computation, dependency-free.

Supports ``*``, lists, ranges, steps (``*/15``, ``1-5/2``) and the usual
month / weekday names. When both day-of-month and day-of-week are
restricted, either matching fires — standard cron semantics. Timezone
handling is the caller's: pass an aware ``after`` and the result is aware
in the same zone, so DST moves follow the wall clock.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, List, NamedTuple, Optional, Set

_MONTHS = {m: i + 1 for i, m in enumerate(('jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'))}
_DAYS = {d: i for i, d in enumerate(('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'))}

PRESETS: Dict[str, str] = {
    '@hourly': '0 * * * *',
    '@daily': '0 0 * * *',
    '@weekly': '0 0 * * 0',
    '@monthly': '0 0 1 * *',
}

# Four years, so a Feb-29 schedule still resolves; month/day jumps keep it cheap.
MAX_SEARCH_DAYS = 1461


class CronSpec(NamedTuple):
    minutes: Set[int]
    hours: Set[int]
    days: Set[int]
    months: Set[int]
    weekdays: Set[int]
    any_day: bool
    any_weekday: bool

    def matches(self, dt: datetime) -> bool:
        if dt.month not in self.months or dt.hour not in self.hours or dt.minute not in self.minutes:
            return False
        return self._day_matches(dt)

    def _day_matches(self, dt: datetime) -> bool:
        dom = dt.day in self.days
        dow = ((dt.weekday() + 1) % 7) in self.weekdays  # Monday=0 → cron Sunday=0
        if self.any_day and self.any_weekday:
            return True
        if self.any_day:
            return dow
        if self.any_weekday:
            return dom
        return dom or dow


class CronError(ValueError):
    pass


def _atom(token: str, lo: int, hi: int, names: Optional[Dict[str, int]]) -> int:
    t = token.strip().lower()
    if names and t in names:
        return names[t]
    if not t.isdigit():
        raise CronError(f'Invalid value {token!r}')
    v = int(t)
    if v < lo or v > hi:
        raise CronError(f'Value {v} out of range {lo}-{hi}')
    return v


def _field(spec: str, lo: int, hi: int, names: Optional[Dict[str, int]] = None) -> Set[int]:
    out: Set[int] = set()
    for part in spec.split(','):
        part = part.strip()
        if not part:
            raise CronError('Empty list item')
        step = 1
        if '/' in part:
            part, step_s = part.split('/', 1)
            if not step_s.isdigit() or int(step_s) < 1:
                raise CronError(f'Invalid step {step_s!r}')
            step = int(step_s)
        if part == '*':
            start, end = lo, hi
        elif '-' in part:
            a, b = part.split('-', 1)
            start, end = _atom(a, lo, hi, names), _atom(b, lo, hi, names)
            if start > end:
                raise CronError(f'Range {part!r} is reversed')
        else:
            start = end = _atom(part, lo, hi, names)
            if step != 1 and '/' in spec:
                end = hi  # "5/10" → every 10 starting at 5, like Vixie cron
        out.update(range(start, end + 1, step))
    return out


def parse(expr: str) -> CronSpec:
    text = (expr or '').strip()
    text = PRESETS.get(text.lower(), text)
    fields = text.split()
    if len(fields) != 5:
        raise CronError('Expected 5 fields: minute hour day-of-month month day-of-week')
    minute, hour, dom, month, dow = fields
    weekdays = _field(dow.replace('7', '0') if dow.strip() == '7' else dow, 0, 7, _DAYS)
    if 7 in weekdays:  # some crons write Sunday as 7
        weekdays.discard(7)
        weekdays.add(0)
    return CronSpec(
        minutes=_field(minute, 0, 59),
        hours=_field(hour, 0, 23),
        days=_field(dom, 1, 31),
        months=_field(month, 1, 12, _MONTHS),
        weekdays=weekdays,
        any_day=dom.strip() == '*',
        any_weekday=dow.strip() == '*',
    )


def next_run(expr: str, after: datetime) -> datetime:
    """First matching minute strictly after ``after`` (aware, same tzinfo)."""
    spec = parse(expr)
    dt = (after + timedelta(minutes=1)).replace(second=0, microsecond=0)
    limit = after + timedelta(days=MAX_SEARCH_DAYS)
    while dt <= limit:
        if dt.month not in spec.months:
            # jump to the first day of the next month
            y, m = (dt.year + 1, 1) if dt.month == 12 else (dt.year, dt.month + 1)
            dt = dt.replace(year=y, month=m, day=1, hour=0, minute=0)
            continue
        if not spec._day_matches(dt):
            dt = (dt + timedelta(days=1)).replace(hour=0, minute=0)
            continue
        if dt.hour not in spec.hours:
            dt = (dt + timedelta(hours=1)).replace(minute=0)
            continue
        if dt.minute not in spec.minutes:
            dt = dt + timedelta(minutes=1)
            continue
        return dt
    raise CronError('No matching time within four years')


def upcoming(expr: str, after: datetime, count: int = 5) -> List[datetime]:
    out: List[datetime] = []
    cursor = after
    for _ in range(count):
        cursor = next_run(expr, cursor)
        out.append(cursor)
    return out
