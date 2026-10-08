"""API key format, hashing and role-capping rules (no database needed).

    PYTHONPATH=packages/services/src python -m pytest tests/test_api_keys.py
"""

from agena_services.services.api_key_tokens import (
    KEY_PREFIX,
    cap_role,
    display_prefix,
    effective_role,
    generate_key,
    hash_key,
    is_api_key,
)


def test_generated_keys_have_the_prefix_and_are_unique():
    seen = set()
    for _ in range(50):
        plain, prefix = generate_key()
        assert plain.startswith(KEY_PREFIX)
        assert len(plain) == len(KEY_PREFIX) + 32
        assert prefix == plain[:14] == display_prefix(plain)
        seen.add(plain)
    assert len(seen) == 50


def test_hash_is_deterministic_and_never_the_plaintext():
    plain, _ = generate_key()
    assert hash_key(plain) == hash_key(plain)
    assert len(hash_key(plain)) == 64
    assert plain not in hash_key(plain)
    assert hash_key(plain) != hash_key(plain + 'x')


def test_is_api_key_distinguishes_keys_from_jwts():
    assert is_api_key('agena_abc')
    assert not is_api_key('eyJhbGciOiJIUzI1NiJ9.e30.x')
    assert not is_api_key('')


def test_cap_role_never_exceeds_creator_or_admin():
    assert cap_role('member', 'owner') == 'member'
    assert cap_role('admin', 'owner') == 'admin'
    assert cap_role('ADMIN', 'admin') == 'admin'
    assert cap_role('owner', 'owner') is None          # never owner
    assert cap_role('admin', 'member') is None         # above creator
    assert cap_role('viewer', 'member') == 'viewer'
    assert cap_role('root', 'owner') is None           # unknown role


def test_effective_role_follows_a_demoted_creator():
    assert effective_role('admin', 'admin') == 'admin'
    assert effective_role('admin', 'member') == 'member'
    assert effective_role('viewer', 'owner') == 'viewer'
