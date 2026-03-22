from integrations.github_client import GitHubClient
from schemas.github import CreatePRRequest
from urllib.parse import urlparse
import re


class GitHubService:
    def __init__(self) -> None:
        self.client = GitHubClient()

    async def create_pr(self, payload: CreatePRRequest) -> str:
        return await self.client.create_pr_with_files(payload)

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
