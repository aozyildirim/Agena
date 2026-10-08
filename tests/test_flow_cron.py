"""Cron parsing and next-run computation for flow schedules.

    PYTHONPATH=packages/services/src python -m pytest tests/test_flow_cron.py
"""

from datetime import datetime, timedelta, timezone

import pytest

from agena_services.services.flow_cron import CronError, next_run, parse, upcoming

UTC = timezone.utc


def at(y, m, d, hh=0, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=UTC)


def test_parse_fields_lists_ranges_steps_and_names():
    s = parse('*/15 9-17 1,15 jan-mar mon-fri')
    assert s.minutes == {0, 15, 30, 45}
    assert s.hours == set(range(9, 18))
    assert s.days == {1, 15} and s.months == {1, 2, 3}
    assert s.weekdays == {1, 2, 3, 4, 5}
    assert not s.any_day and not s.any_weekday


def test_presets_and_sunday_as_seven():
    assert parse('@daily').hours == {0} and parse('@daily').minutes == {0}
    assert 0 in parse('0 0 * * 7').weekdays


@pytest.mark.parametrize('bad', ['', '* * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', 'a b c d e', '*/0 * * * *', '5-1 * * * *'])
def test_invalid_expressions_raise(bad):
    with pytest.raises(CronError):
        parse(bad)


def test_next_run_is_strictly_after_and_rounds_to_minute():
    # 09:00 every day; asked at 09:00:30 → tomorrow 09:00, not today
    assert next_run('0 9 * * *', datetime(2026, 10, 8, 9, 0, 30, tzinfo=UTC)) == at(2026, 10, 9, 9, 0)
    assert next_run('0 9 * * *', at(2026, 10, 8, 8, 59)) == at(2026, 10, 8, 9, 0)


def test_weekday_only_schedule_skips_the_weekend():
    # 2026-10-09 is a Friday
    assert next_run('0 9 * * 1-5', at(2026, 10, 9, 9, 0)) == at(2026, 10, 12, 9, 0)


def test_dom_and_dow_both_restricted_means_either():
    # 1st of month OR Monday; 2026-10-01 is Thursday → fires; then Monday Oct 5
    runs = upcoming('0 0 1 * 1', at(2026, 9, 30, 12, 0), 2)
    assert runs == [at(2026, 10, 1), at(2026, 10, 5)]


def test_month_jump_and_leap_day():
    assert next_run('0 0 29 2 *', at(2026, 1, 1)) == at(2028, 2, 29)
    assert next_run('30 6 * dec *', at(2026, 10, 8)) == at(2026, 12, 1, 6, 30)


def test_timezone_wall_clock_is_respected():
    plus3 = timezone(timedelta(hours=3))
    local = next_run('0 9 * * *', datetime(2026, 10, 8, 10, 0, tzinfo=plus3))
    assert local == datetime(2026, 10, 9, 9, 0, tzinfo=plus3)
    assert local.astimezone(UTC) == at(2026, 10, 9, 6, 0)


def test_upcoming_count():
    runs = upcoming('*/20 * * * *', at(2026, 10, 8, 10, 5), 3)
    assert runs == [at(2026, 10, 8, 10, 20), at(2026, 10, 8, 10, 40), at(2026, 10, 8, 11, 0)]
