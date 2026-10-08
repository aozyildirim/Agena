from agena_services.services.gitlab_webhook import (
    gitlab_mr_url,
    is_gitlab_mr_merged,
)
from agena_services.services.remote_repo_service import RemoteRepoService, parse_gitlab_spec

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
