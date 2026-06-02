from __future__ import annotations

import logging
from typing import Any

import httpx

from agena_core.settings import get_settings
from agena_models.schemas.github import CreatePRRequest

logger = logging.getLogger(__name__)


def _patch_right_lines(patch: str) -> set[int]:
    """Parse a unified-diff patch and return the set of RIGHT-side (new file)
    line numbers that appear in the diff (added + context). GitHub only
    accepts inline comments on these lines."""
    lines: set[int] = set()
    if not patch:
        return lines
    cur = 0
    import re as _re
    for raw in patch.splitlines():
        m = _re.match(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@', raw)
        if m:
            cur = int(m.group(1))
            continue
        if not raw:
            continue
        c = raw[0]
        if c == '+':
            lines.add(cur)
            cur += 1
        elif c == ' ':
            lines.add(cur)
            cur += 1
        elif c == '-':
            pass  # left-only, no right line
    return lines


class GitHubClient:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.base_url = (
            f'https://api.github.com/repos/{self.settings.github_owner}/{self.settings.github_repo}'
        )

    async def create_branch(self, branch_name: str, base_branch: str) -> None:
        async with httpx.AsyncClient(timeout=30) as client:
            ref_data = await self._request_json(client, 'GET', f'/git/ref/heads/{base_branch}')
            sha = ref_data['object']['sha']
            payload = {'ref': f'refs/heads/{branch_name}', 'sha': sha}
            response = await client.post(
                f'{self.base_url}/git/refs',
                headers=self._headers(),
                json=payload,
            )
            if response.status_code not in {201, 422}:
                response.raise_for_status()

    async def commit_files(self, branch_name: str, commit_message: str, files: list[dict[str, str]]) -> None:
        async with httpx.AsyncClient(timeout=30) as client:
            for file_change in files:
                content_b64 = file_change['content'].encode('utf-8').decode('utf-8')
                payload = {
                    'message': commit_message,
                    'content': self._to_base64(content_b64),
                    'branch': branch_name,
                }

                get_response = await client.get(
                    f"{self.base_url}/contents/{file_change['path']}",
                    headers=self._headers(),
                    params={'ref': branch_name},
                )
                if get_response.status_code == 200:
                    payload['sha'] = get_response.json().get('sha')

                put_response = await client.put(
                    f"{self.base_url}/contents/{file_change['path']}",
                    headers=self._headers(),
                    json=payload,
                )
                put_response.raise_for_status()

    async def create_pull_request(self, payload: CreatePRRequest) -> str:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f'{self.base_url}/pulls',
                headers=self._headers(),
                json={
                    'title': payload.title,
                    'body': payload.body,
                    'head': payload.branch_name,
                    'base': payload.base_branch,
                },
            )
            response.raise_for_status()
            return response.json()['html_url']

    async def create_pr_with_files(self, payload: CreatePRRequest) -> str:
        await self.create_branch(payload.branch_name, payload.base_branch)
        await self.commit_files(
            branch_name=payload.branch_name,
            commit_message=payload.commit_message,
            files=[f.model_dump() for f in payload.files],
        )
        return await self.create_pull_request(payload)

    async def list_pr_issue_comments(self, owner: str, repo: str, pr_number: int) -> list[dict[str, Any]]:
        url = f'https://api.github.com/repos/{owner}/{repo}/issues/{pr_number}/comments'
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, headers=self._headers())
            response.raise_for_status()
            data = response.json()
        if not isinstance(data, list):
            return []
        return data

    async def post_pr_issue_comment(self, owner: str, repo: str, pr_number: int, body: str) -> dict[str, Any]:
        url = f'https://api.github.com/repos/{owner}/{repo}/issues/{pr_number}/comments'
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, headers=self._headers(), json={'body': body})
            response.raise_for_status()
            return response.json()

    # ── PR Reviewer (per-call token + owner/repo; not the env-global base_url) ──

    @staticmethod
    def _th(token: str) -> dict[str, str]:
        return {
            'Authorization': f'Bearer {token}',
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        }

    async def list_open_pull_requests(self, *, token: str, owner: str, repo: str) -> list[dict[str, Any]]:
        """Live list of open PRs for a repo."""
        url = f'https://api.github.com/repos/{owner}/{repo}/pulls?state=open&per_page=100'
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=self._th(token))
            if resp.status_code >= 400:
                raise RuntimeError(f'GitHub {resp.status_code}: {resp.text[:200]}')
            rows = resp.json() or []
        return [{
            'id': str(pr.get('number') or ''),
            'title': str(pr.get('title') or '').strip(),
            'author': str((pr.get('user') or {}).get('login') or ''),
            'source_branch': str((pr.get('head') or {}).get('ref') or ''),
            'target_branch': str((pr.get('base') or {}).get('ref') or ''),
            'created': str(pr.get('created_at') or ''),
            'url': str(pr.get('html_url') or ''),
            'head_sha': str((pr.get('head') or {}).get('sha') or ''),
        } for pr in rows]

    async def get_pull_request(self, *, token: str, owner: str, repo: str, pr_number: str) -> dict[str, Any] | None:
        url = f'https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}'
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=self._th(token))
        if resp.status_code != 200:
            return None
        pr = resp.json() or {}
        return {
            'head_sha': str((pr.get('head') or {}).get('sha') or ''),
            'source_branch': str((pr.get('head') or {}).get('ref') or ''),
            'title': str(pr.get('title') or ''),
            'url': str(pr.get('html_url') or ''),
        }

    async def fetch_pr_files(self, *, token: str, owner: str, repo: str, pr_number: str) -> list[dict[str, Any]]:
        """Changed files of a PR with their unified-diff patch. From the patch
        we derive which RIGHT-side (new) line numbers are commentable — GitHub
        rejects inline comments on lines outside the diff."""
        url = f'https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/files?per_page=100'
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=self._th(token))
            if resp.status_code >= 400:
                raise RuntimeError(f'GitHub {resp.status_code}: {resp.text[:200]}')
            rows = resp.json() or []
        out: list[dict[str, Any]] = []
        for f in rows:
            if str(f.get('status') or '') == 'removed':
                continue
            out.append({
                'path': str(f.get('filename') or ''),
                'patch': str(f.get('patch') or ''),
                'lines': _patch_right_lines(str(f.get('patch') or '')),
            })
        return out

    async def fetch_file_content(self, *, token: str, owner: str, repo: str, path: str, ref: str) -> str | None:
        from urllib.parse import quote
        url = f'https://api.github.com/repos/{owner}/{repo}/contents/{quote(path)}?ref={quote(ref)}'
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.get(url, headers={**self._th(token), 'Accept': 'application/vnd.github.raw+json'})
            if resp.status_code != 200:
                return None
            return resp.text
        except Exception:
            return None

    async def post_pr_inline_comment(self, *, token: str, owner: str, repo: str, pr_number: str, commit_id: str, path: str, line: int, body: str) -> str | None:
        url = f'https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/comments'
        payload = {'body': body, 'commit_id': commit_id, 'path': path, 'line': max(1, int(line or 1)), 'side': 'RIGHT'}
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(url, headers=self._th(token), json=payload)
            if resp.status_code >= 400:
                logger.warning('GitHub inline comment %s: %s', resp.status_code, resp.text[:200])
                return None
            return str((resp.json() or {}).get('id') or '') or None
        except Exception as exc:
            logger.warning('GitHub inline comment failed: %s', exc)
            return None

    async def post_issue_comment(self, *, token: str, owner: str, repo: str, pr_number: str, body: str) -> str | None:
        """Top-level PR comment (token-aware; the summary verdict goes here)."""
        url = f'https://api.github.com/repos/{owner}/{repo}/issues/{pr_number}/comments'
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(url, headers=self._th(token), json={'body': body})
            if resp.status_code >= 400:
                logger.warning('GitHub issue comment %s: %s', resp.status_code, resp.text[:200])
                return None
            return str((resp.json() or {}).get('id') or '') or None
        except Exception as exc:
            logger.warning('GitHub issue comment failed: %s', exc)
            return None

    async def _request_json(self, client: httpx.AsyncClient, method: str, path: str) -> dict[str, Any]:
        response = await client.request(method, f'{self.base_url}{path}', headers=self._headers())
        response.raise_for_status()
        return response.json()

    def _headers(self) -> dict[str, str]:
        return {
            'Authorization': f'Bearer {self.settings.github_token}',
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        }

    def _to_base64(self, content: str) -> str:
        import base64

        return base64.b64encode(content.encode('utf-8')).decode('utf-8')
