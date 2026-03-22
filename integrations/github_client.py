from __future__ import annotations

import logging
from typing import Any

import httpx

from core.settings import get_settings
from schemas.github import CreatePRRequest

logger = logging.getLogger(__name__)


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
