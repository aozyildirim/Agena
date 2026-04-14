import base64
import logging
import re
from urllib.parse import urlparse

import httpx

from agena_services.integrations.github_client import GitHubClient
from agena_models.schemas.github import CreatePRRequest

logger = logging.getLogger(__name__)

_INVALID_PATH_CHARS_RE = re.compile(r'[\[\]*?<>|"#{};\x00]')


class GitHubService:
    def __init__(self) -> None:
        self.client = GitHubClient()

    async def create_pr(self, payload: CreatePRRequest) -> str:
        return await self.client.create_pr_with_files(payload)

    async def push_files_and_create_pr(
        self,
        *,
        owner: str,
        repo: str,
        branch_name: str,
        target_branch: str,
        title: str,
        body: str,
        files: list[dict],
        commit_message: str,
        organization_id: int | None = None,
    ) -> str:
        """Push files via GitHub API and create PR — no local repo needed."""
        from agena_services.services.integration_config_service import IntegrationConfigService
        from agena_core.settings import get_settings

        settings = get_settings()
        token = (settings.github_token or '').strip()

        # Try org-level integration token if global token missing
        if not token and organization_id:
            from agena_core.database import SessionLocal
            async with SessionLocal() as db:
                cfg_svc = IntegrationConfigService(db)
                gh_cfg = await cfg_svc.get_config(organization_id, 'github')
                if gh_cfg and gh_cfg.secret:
                    token = gh_cfg.secret
        if not token:
            raise ValueError('No GitHub token available')

        base = f'https://api.github.com/repos/{owner}/{repo}'
        headers = {'Authorization': f'token {token}', 'Accept': 'application/vnd.github.v3+json'}

        async with httpx.AsyncClient(timeout=30) as client:
            # 1. Get base branch SHA
            r = await client.get(f'{base}/git/ref/heads/{target_branch}', headers=headers)
            r.raise_for_status()
            base_sha = r.json()['object']['sha']

            # 2. Create branch
            r = await client.post(f'{base}/git/refs', headers=headers,
                json={'ref': f'refs/heads/{branch_name}', 'sha': base_sha})
            if r.status_code not in {201, 422}:  # 422 = already exists
                r.raise_for_status()

            # 3. Commit files one by one via Contents API
            for f in files:
                path = f.get('path', '').lstrip('/')
                content = f.get('content', '')
                if not path or not content:
                    continue
                if _INVALID_PATH_CHARS_RE.search(path):
                    logger.warning('Skipping file with invalid path in GitHub push: %r', path)
                    continue
                # Check if file exists to get its sha
                existing = await client.get(f'{base}/contents/{path}?ref={branch_name}', headers=headers)
                file_payload: dict = {
                    'message': commit_message,
                    'content': base64.b64encode(content.encode()).decode(),
                    'branch': branch_name,
                }
                if existing.status_code == 200:
                    file_payload['sha'] = existing.json()['sha']
                await client.put(f'{base}/contents/{path}', headers=headers, json=file_payload)

            # 4. Create PR
            r = await client.post(f'{base}/pulls', headers=headers, json={
                'title': title,
                'body': body,
                'head': branch_name,
                'base': target_branch,
            })
            if r.status_code == 422:
                # PR may already exist
                data = r.json()
                errors = data.get('errors', [])
                if any('pull request already exists' in str(e).lower() for e in errors):
                    # Find existing PR
                    search = await client.get(
                        f'{base}/pulls?head={owner}:{branch_name}&base={target_branch}&state=open',
                        headers=headers)
                    prs = search.json() if search.status_code == 200 else []
                    if prs:
                        return prs[0].get('html_url', '')
                r.raise_for_status()
            r.raise_for_status()
            return r.json().get('html_url', '')

    def parse_pr_ref(self, pr_url: str) -> tuple[str, str, int] | None:
        parsed = urlparse(pr_url)
        path = (parsed.path or '').strip('/')

        m_web = re.search(r'^([^/]+)/([^/]+)/pull/(\d+)$', path, flags=re.IGNORECASE)
        if m_web:
            return m_web.group(1), m_web.group(2), int(m_web.group(3))

        m_api = re.search(r'^repos/([^/]+)/([^/]+)/pulls/(\d+)$', path, flags=re.IGNORECASE)
        if m_api:
            return m_api.group(1), m_api.group(2), int(m_api.group(3))
        return None

    async def list_pr_comments(self, pr_url: str) -> list[dict[str, str]]:
        ref = self.parse_pr_ref(pr_url)
        if ref is None:
            raise ValueError('GitHub PR URL could not be parsed')
        owner, repo, pr_number = ref
        rows = await self.client.list_pr_issue_comments(owner, repo, pr_number)
        out: list[dict[str, str]] = []
        for row in rows:
            body = str(row.get('body') or '').strip()
            if not body:
                continue
            user = row.get('user') or {}
            out.append({
                'id': str(row.get('id') or ''),
                'author': str(user.get('login') or ''),
                'content': body,
            })
        return out

    async def post_pr_comment(self, pr_url: str, comment: str) -> str | None:
        ref = self.parse_pr_ref(pr_url)
        if ref is None:
            raise ValueError('GitHub PR URL could not be parsed')
        owner, repo, pr_number = ref
        row = await self.client.post_pr_issue_comment(owner, repo, pr_number, comment)
        return row.get('html_url') if isinstance(row, dict) else None
