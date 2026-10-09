"""GitLab merge-request client for the PR reviewer.

Mirrors :class:`~agena_services.integrations.github_client.GitHubClient` method
for method so ``pr_review_service`` can treat GitLab as one more branch rather
than a separate flow. A GitLab project is addressed by its full path
(``group/subgroup/project``), which is why every call takes ``project_path``
where the GitHub client takes an owner and a repo.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from agena_services.services.remote_repo_service import RemoteRepoService

logger = logging.getLogger(__name__)


def _diff_added_lines(diff: str) -> set[int]:
    """New-side line numbers this diff *adds*.

    Deliberately narrower than the GitHub client's equivalent, which also
    returns context lines: GitLab rejects a discussion anchored to a context
    line unless the position carries the old-side line too, so offering those
    lines up would just produce 400s. Findings on any other line fall through
    to the review summary.
    """
    lines: set[int] = set()
    if not diff:
        return lines
    cur = 0
    for raw in diff.splitlines():
        hunk = re.match(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@', raw)
        if hunk:
            cur = int(hunk.group(1))
            continue
        if not raw:
            continue
        head = raw[0]
        if head == '+':
            if cur:  # no hunk header seen yet — there is no line number to use
                lines.add(cur)
                cur += 1
        elif head == ' ':
            cur += 1
    return lines


class GitLabClient:
    @staticmethod
    def _th(token: str) -> dict[str, str]:
        return {'PRIVATE-TOKEN': token, 'Accept': 'application/json'}

    @staticmethod
    def _api(base_url: str | None, project_path: str) -> str:
        return RemoteRepoService.gitlab_project_api(base_url, project_path)

    async def list_open_pull_requests(
        self, *, token: str, base_url: str | None, project_path: str,
    ) -> list[dict[str, Any]]:
        url = f'{self._api(base_url, project_path)}/merge_requests?state=opened&per_page=100'
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=self._th(token))
            if resp.status_code >= 400:
                raise RuntimeError(f'GitLab {resp.status_code}: {resp.text[:200]}')
            rows = resp.json() or []
        return [{
            'id': str(mr.get('iid') or ''),
            'title': str(mr.get('title') or '').strip(),
            'author': str((mr.get('author') or {}).get('username') or ''),
            'source_branch': str(mr.get('source_branch') or ''),
            'target_branch': str(mr.get('target_branch') or ''),
            'created': str(mr.get('created_at') or ''),
            'url': str(mr.get('web_url') or ''),
            'head_sha': str(mr.get('sha') or ''),
        } for mr in rows]

    async def get_pull_request(
        self, *, token: str, base_url: str | None, project_path: str, pr_number: str,
    ) -> dict[str, Any] | None:
        url = f'{self._api(base_url, project_path)}/merge_requests/{pr_number}'
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=self._th(token))
        if resp.status_code != 200:
            return None
        mr = resp.json() or {}
        refs = mr.get('diff_refs') or {}
        return {
            'head_sha': str(refs.get('head_sha') or mr.get('sha') or ''),
            'source_branch': str(mr.get('source_branch') or ''),
            'target_branch': str(mr.get('target_branch') or ''),
            'title': str(mr.get('title') or ''),
            'url': str(mr.get('web_url') or ''),
            # Anchoring a discussion to a line needs all three shas, and they
            # are only exposed here — the MR list omits diff_refs.
            'diff_refs': {
                'base_sha': str(refs.get('base_sha') or ''),
                'start_sha': str(refs.get('start_sha') or ''),
                'head_sha': str(refs.get('head_sha') or ''),
            },
        }

    async def fetch_pr_changed_files(
        self, *, token: str, base_url: str | None, project_path: str, pr_number: str,
    ) -> list[dict[str, Any]]:
        url = f'{self._api(base_url, project_path)}/merge_requests/{pr_number}/changes'
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=self._th(token))
            if resp.status_code >= 400:
                raise RuntimeError(f'GitLab {resp.status_code}: {resp.text[:200]}')
            data = resp.json() or {}
        out: list[dict[str, Any]] = []
        for change in (data.get('changes') or []):
            if change.get('deleted_file'):
                continue
            new_path = str(change.get('new_path') or '')
            if not new_path:
                continue
            diff = str(change.get('diff') or '')
            out.append({
                'path': new_path,
                'old_path': str(change.get('old_path') or new_path),
                'patch': diff,
                'lines': _diff_added_lines(diff),
            })
        return out

    async def fetch_file_content(
        self, *, token: str, base_url: str | None, project_path: str, path: str, ref: str,
    ) -> str | None:
        return await RemoteRepoService().gitlab_file_content(
            base_url, project_path, token, path, ref or 'main',
        )

    async def post_pr_inline_comment(
        self,
        *,
        token: str,
        base_url: str | None,
        project_path: str,
        pr_number: str,
        diff_refs: dict[str, str],
        path: str,
        line: int,
        body: str,
        old_path: str | None = None,
    ) -> str | None:
        if not all(diff_refs.get(k) for k in ('base_sha', 'start_sha', 'head_sha')):
            return None
        url = f'{self._api(base_url, project_path)}/merge_requests/{pr_number}/discussions'
        payload = {
            'body': body,
            'position': {
                'position_type': 'text',
                'base_sha': diff_refs['base_sha'],
                'start_sha': diff_refs['start_sha'],
                'head_sha': diff_refs['head_sha'],
                'new_path': path,
                'old_path': old_path or path,
                'new_line': max(1, int(line or 1)),
            },
        }
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(url, headers=self._th(token), json=payload)
            if resp.status_code >= 400:
                logger.warning('GitLab inline discussion %s: %s', resp.status_code, resp.text[:200])
                return None
            return str((resp.json() or {}).get('id') or '') or None
        except Exception as exc:
            logger.warning('GitLab inline discussion failed: %s', exc)
            return None

    async def post_issue_comment(
        self, *, token: str, base_url: str | None, project_path: str, pr_number: str, body: str,
    ) -> str | None:
        """MR-level note — where the review summary goes."""
        url = f'{self._api(base_url, project_path)}/merge_requests/{pr_number}/notes'
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(url, headers=self._th(token), json={'body': body})
            if resp.status_code >= 400:
                logger.warning('GitLab MR note %s: %s', resp.status_code, resp.text[:200])
                return None
            return str((resp.json() or {}).get('id') or '') or None
        except Exception as exc:
            logger.warning('GitLab MR note failed: %s', exc)
            return None

    async def list_pr_review_comments(
        self, *, token: str, base_url: str | None, project_path: str, pr_number: str,
    ) -> list[dict[str, Any]]:
        """Reviewer feedback on an MR, for the revision agent.

        GitLab returns inline and conversation notes from one endpoint; the
        system notes it writes for events ("added 1 commit") are dropped.
        """
        url = f'{self._api(base_url, project_path)}/merge_requests/{pr_number}/notes?per_page=100&sort=asc'
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.get(url, headers=self._th(token))
            if resp.status_code >= 400:
                return []
            rows = resp.json() or []
        except Exception as exc:
            logger.warning('GitLab MR notes fetch failed: %s', exc)
            return []
        out: list[dict[str, Any]] = []
        for note in rows:
            if not isinstance(note, dict) or note.get('system'):
                continue
            body = str(note.get('body') or '').strip()
            if not body:
                continue
            position = note.get('position') or {}
            out.append({
                'id': str(note.get('id') or ''),
                'author': str((note.get('author') or {}).get('username') or ''),
                'content': body,
                'path': str(position.get('new_path') or ''),
                'line': position.get('new_line') or None,
                'created': str(note.get('created_at') or ''),
            })
        return out
