from datetime import datetime, timedelta, timezone

from agena_services.integrations.gitlab_client import _diff_added_lines
from agena_services.services.git_sync_parsing import gitlab_next_params, to_utc_naive
from agena_services.services.gitlab_webhook import (
    gitlab_mr_url,
    is_gitlab_mr_merged,
)
from agena_services.services.remote_repo_service import (
    RemoteRepoService,
    parse_gitlab_mr_url,
    parse_gitlab_spec,
)

MR_URL = 'https://gitlab.com/acme/platform/api/-/merge_requests/7'


def _payload(action='merge', state='merged', kind='merge_request'):
    return {'object_kind': kind, 'object_attributes': {'action': action, 'state': state, 'url': MR_URL}}


def test_merge_action_is_detected():
    assert is_gitlab_mr_merged(_payload())


def test_merged_state_without_action_is_detected():
    assert is_gitlab_mr_merged(_payload(action='update', state='merged'))


def test_open_and_close_are_not_merges():
    assert not is_gitlab_mr_merged(_payload(action='open', state='opened'))
    assert not is_gitlab_mr_merged(_payload(action='close', state='closed'))


def test_other_hook_kinds_are_ignored():
    assert not is_gitlab_mr_merged(_payload(kind='push'))
    assert gitlab_mr_url(_payload(kind='note')) == ''


def test_mr_url_is_taken_from_object_attributes():
    assert gitlab_mr_url(_payload()) == MR_URL


def test_malformed_payload_does_not_raise():
    assert not is_gitlab_mr_merged({'object_kind': 'merge_request', 'object_attributes': 'x'})
    assert gitlab_mr_url({'object_kind': 'merge_request'}) == ''


def test_spec_keeps_nested_group_path_and_branch():
    assert parse_gitlab_spec('gitlab:acme/platform/api@develop') == ('acme/platform/api', 'develop')


def test_spec_defaults_branch_to_main():
    assert parse_gitlab_spec('gitlab:acme/api') == ('acme/api', 'main')


def test_spec_rejects_a_bare_name():
    assert parse_gitlab_spec('gitlab:api') is None
    assert parse_gitlab_spec('') is None


def test_project_api_url_encodes_the_path():
    assert (
        RemoteRepoService.gitlab_project_api('https://git.corp.io/', 'acme/platform/api')
        == 'https://git.corp.io/api/v4/projects/acme%2Fplatform%2Fapi'
    )


def test_project_api_url_tolerates_an_api_suffix_and_default_host():
    assert RemoteRepoService.gitlab_project_api('https://git.corp.io/api/v4', 'a/b').startswith('https://git.corp.io/api/v4/projects/')
    assert RemoteRepoService.gitlab_project_api(None, 'a/b') == 'https://gitlab.com/api/v4/projects/a%2Fb'


def test_pagination_follows_the_next_page_header():
    params = {'per_page': '100', 'page': '1'}
    assert gitlab_next_params('2', params) == {'per_page': '100', 'page': '2'}
    # the caller's other filters have to survive the hop
    assert gitlab_next_params('2', params)['per_page'] == '100'


def test_pagination_stops_on_the_last_page():
    assert gitlab_next_params('', {'page': '7'}) is None
    assert gitlab_next_params(None, {'page': '7'}) is None


def test_offset_timestamps_are_converted_to_utc():
    assert to_utc_naive(datetime(2026, 10, 8, 12, tzinfo=timezone(timedelta(hours=3)))) == datetime(2026, 10, 8, 9)
    assert to_utc_naive(datetime(2026, 10, 8, 12, tzinfo=timezone(timedelta(hours=-5)))) == datetime(2026, 10, 8, 17)


def test_naive_timestamps_pass_through_untouched():
    naive = datetime(2026, 10, 8, 12)
    assert to_utc_naive(naive) is naive


DIFF = '''@@ -1,4 +10,5 @@
 context before
-removed line
+added one
+added two
 context after
'''


def test_only_added_lines_are_offered_for_inline_comments():
    # Context lines advance the counter but can't carry a GitLab discussion
    # without an old-side line, so they stay out.
    assert _diff_added_lines(DIFF) == {11, 12}


def test_a_file_with_no_hunk_header_yields_nothing():
    assert _diff_added_lines('+orphan line') == set()
    assert _diff_added_lines('') == set()


def test_consecutive_hunks_each_reset_the_counter():
    diff = '@@ -1 +1 @@\n+first\n@@ -50 +60 @@\n+second\n'
    assert _diff_added_lines(diff) == {1, 60}


def test_mr_url_parses_a_deeply_nested_group():
    assert parse_gitlab_mr_url('https://gl.corp.io/acme/platform/team/api/-/merge_requests/7') == (
        'acme/platform/team/api', 7,
    )


def test_mr_url_parses_a_plain_two_level_project():
    assert parse_gitlab_mr_url('https://gitlab.com/acme/api/-/merge_requests/12') == ('acme/api', 12)


def test_mr_url_rejects_other_urls():
    assert parse_gitlab_mr_url('https://github.com/acme/api/pull/3') is None
    assert parse_gitlab_mr_url('https://gitlab.com/acme/api/-/issues/5') is None
    assert parse_gitlab_mr_url('') is None
