"""Outbound webhook signing, retry schedule and event matching.

    PYTHONPATH=packages/services/src python -m pytest tests/test_webhook_signing.py
"""

from agena_services.services.webhook_signing import (
    AUTO_DISABLE_AFTER,
    BACKOFF_SECONDS,
    MAX_ATTEMPTS,
    backoff_seconds,
    event_matches,
    generate_secret,
    sign,
    verify,
)


def test_signature_is_deterministic_and_covers_timestamp_and_body():
    sig = sign('whsec_x', '1700000000', b'{"a":1}')
    assert sig.startswith('sha256=') and len(sig) == 7 + 64
    assert sig == sign('whsec_x', '1700000000', b'{"a":1}')
    assert sig != sign('whsec_x', '1700000001', b'{"a":1}')   # replay with new timestamp fails
    assert sig != sign('whsec_x', '1700000000', b'{"a":2}')
    assert sig != sign('whsec_y', '1700000000', b'{"a":1}')


def test_verify_round_trip_and_rejects_garbage():
    assert verify('s', 't', b'body', sign('s', 't', b'body'))
    assert not verify('s', 't', b'body', 'sha256=deadbeef')
    assert not verify('s', 't', b'body', '')


def test_secrets_are_prefixed_and_unique():
    a, b = generate_secret(), generate_secret()
    assert a.startswith('whsec_') and a != b and len(a) > 20


def test_backoff_schedule_then_give_up():
    assert [backoff_seconds(n) for n in range(1, len(BACKOFF_SECONDS) + 1)] == list(BACKOFF_SECONDS)
    assert backoff_seconds(len(BACKOFF_SECONDS) + 1) is None
    assert MAX_ATTEMPTS == len(BACKOFF_SECONDS) + 1
    assert AUTO_DISABLE_AFTER > MAX_ATTEMPTS


def test_event_matching():
    assert event_matches(['*'], 'task_completed')
    assert event_matches([], 'anything')
    assert event_matches(None, 'anything')
    assert event_matches(['task_completed'], 'task_completed')
    assert not event_matches(['task_completed'], 'task_failed')
    assert event_matches(['task_*'], 'task_failed')
    assert not event_matches(['task_*'], 'pr_created')
    assert event_matches(['pr_created', 'security_alert'], 'security_alert')
