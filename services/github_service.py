from integrations.github_client import GitHubClient
from schemas.github import CreatePRRequest


class GitHubService:
    def __init__(self) -> None:
        self.client = GitHubClient()

    async def create_pr(self, payload: CreatePRRequest) -> str:
        return await self.client.create_pr_with_files(payload)
