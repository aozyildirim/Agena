"""Which audit events become security alerts, and their wording.

    PYTHONPATH=packages/services/src python -m pytest tests/test_security_events.py
"""

from agena_services.services.security_events import describe, new_login_alert


def test_relevant_successful_actions_alert():
    a = describe('api-keys.create_api_key', 201, 'ali@example.com', '203.0.113.9', None)
    assert a is not None
    assert a.title == 'API key created' and a.severity == 'warning' and a.account_scoped is False
    assert a.message == 'ali@example.com from 203.0.113.9: api key created.'


def test_failed_attempts_do_not_alert():
    assert describe('api-keys.create_api_key', 400, 'ali@example.com', '203.0.113.9', None) is None
    assert describe('team.change_member_role', 403, 'ali@example.com', None, None) is None


def test_unrelated_actions_do_not_alert():
    assert describe('tasks.assign_task', 200, 'ali@example.com', '1.2.3.4', None) is None
    assert describe('preferences.save_preferences', 200, 'ali@example.com', '1.2.3.4', None) is None


def test_account_events_also_reach_the_account_owner():
    assert describe('auth.change_password', 200, 'a@b.c', None, None).account_scoped is True
    assert describe('auth.logout_all', 200, 'a@b.c', None, None).account_scoped is True
    assert describe('integrations.delete_integration', 200, 'a@b.c', None, None).account_scoped is False


def test_target_hint_uses_path_params():
    a = describe('integrations.upsert_integration', 200, 'a@b.c', '9.9.9.9', {'path_params': {'provider': 'github'}})
    assert a.message.endswith('integration credentials updated (github).')
    a = describe('api-keys.revoke_api_key', 200, 'a@b.c', None, {'path_params': {'key_id': '12'}})
    assert a.message == 'a@b.c: api key revoked (#12).'


def test_new_login_alert_wording():
    a = new_login_alert('a@b.c', '198.51.100.7')
    assert a.severity == 'warning' and a.account_scoped is True
    assert '198.51.100.7' in a.message and 'sign out everywhere' in a.message
