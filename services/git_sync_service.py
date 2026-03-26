from __future__ import annotations

import base64
import logging
from datetime import datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.git_commit import GitCommit
from models.git_deployment import GitDeployment
from models.git_pull_request import GitPullRequest
from models.integration_config import IntegrationConfig

logger = logging.getLogger(__name__)


class GitSyncService:
    """Fetches commits, PRs, and deployments from GitHub/Azure and upserts them
    into the local database.  All HTTP calls use ``httpx.AsyncClient``."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Public entry point ───────────────────────────────────────────────────

    async def sync_repo(
        self,
        organization_id: int,
        repo_mapping: dict[str, Any],
    ) -> dict[str, int]:
        """Determine provider from *repo_mapping* and run the appropriate sync
        methods.  Returns a dict with ``commits_synced``, ``prs_synced``, and
        ``deployments_synced`` counts."""

        provider = str(repo_mapping.get('provider') or '').lower()
        repo_mapping_id = str(repo_mapping.get('id') or '')
        commits = 0
        prs = 0
        deployments = 0

        if provider == 'github':
            owner = str(repo_mapping.get('github_owner') or '').strip()
            repo = str(repo_mapping.get('github_repo') or '').strip()
            if not owner or not repo:
                raise ValueError('github_owner and github_repo are required for GitHub sync')

            creds = await self._get_credentials(organization_id, 'github')
            token = creds['token']

            commits = await self._sync_github_commits(
                organization_id, repo_mapping_id, owner, repo, token,
            )
            prs = await self._sync_github_prs(
                organization_id, repo_mapping_id, owner, repo, token,
            )
            deployments = await self._sync_github_deployments(
                organization_id, repo_mapping_id, owner, repo, token,
            )

        elif provider == 'azure':
            org_url = str(repo_mapping.get('azure_repo_url') or '').strip()
            project = str(repo_mapping.get('azure_project') or '').strip()
            repo_name = self._extract_azure_repo_name(org_url)
            if not project or not repo_name:
                raise ValueError('azure_project and azure_repo_url are required for Azure sync')

            creds = await self._get_credentials(organization_id, 'azure')
            pat = creds['token']
            base_url = creds['base_url']

            commits = await self._sync_azure_commits(
                organization_id, repo_mapping_id, base_url, project, repo_name, pat,
            )
            prs = await self._sync_azure_prs(
                organization_id, repo_mapping_id, base_url, project, repo_name, pat,
            )
        else:
            raise ValueError(f'Unsupported provider: {provider}')

        return {
            'commits_synced': commits,
            'prs_synced': prs,
            'deployments_synced': deployments,
        }

    # ── GitHub sync methods ──────────────────────────────────────────────────

    async def _sync_github_commits(
        self,
        org_id: int,
        repo_mapping_id: str,
        owner: str,
        repo: str,
        token: str,
        since_days: int = 365,
    ) -> int:
        since = (datetime.utcnow() - timedelta(days=since_days)).strftime('%Y-%m-%dT%H:%M:%SZ')
        url = f'https://api.github.com/repos/{owner}/{repo}/commits'
        params: dict[str, str] = {'since': since, 'per_page': '100'}
        headers = self._github_headers(token)
        count = 0

        async with httpx.AsyncClient(timeout=30) as client:
            while url:
                response = await self._request_with_rate_limit(client, 'GET', url, headers=headers, params=params)
                if response is None:
                    break
                items = response.json()
                if not isinstance(items, list):
                    break

                for item in items:
                    sha = str(item.get('sha') or '')
                    if not sha:
                        continue
                    commit_data = item.get('commit') or {}
                    author_info = commit_data.get('author') or {}
                    committed_at_str = author_info.get('date') or ''
                    if not committed_at_str:
                        continue

                    committed_at = self._parse_datetime(committed_at_str)
                    stats = item.get('stats') or {}

                    await self._upsert_commit(
                        org_id=org_id,
                        repo_mapping_id=repo_mapping_id,
                        sha=sha,
                        author_name=(author_info.get('name') or '')[:255],
                        author_email=(author_info.get('email') or '')[:255],
                        message=(commit_data.get('message') or '')[:5000],
                        committed_at=committed_at,
                        additions=int(stats.get('additions') or 0),
                        deletions=int(stats.get('deletions') or 0),
                        files_changed=len(item.get('files') or []),
                    )
                    count += 1

                url = self._next_page_url(response)
                params = {}  # params are already in the next URL

        await self.db.commit()
        logger.info('GitHub commits synced: %d for %s/%s', count, owner, repo)
        return count

    async def _sync_github_prs(
        self,
        org_id: int,
        repo_mapping_id: str,
        owner: str,
        repo: str,
        token: str,
        since_days: int = 365,
    ) -> int:
        cutoff = datetime.utcnow() - timedelta(days=since_days)
        url = f'https://api.github.com/repos/{owner}/{repo}/pulls'
        params: dict[str, str] = {'state': 'all', 'sort': 'updated', 'per_page': '100'}
        headers = self._github_headers(token)
        count = 0

        async with httpx.AsyncClient(timeout=30) as client:
            while url:
                response = await self._request_with_rate_limit(client, 'GET', url, headers=headers, params=params)
                if response is None:
                    break
                items = response.json()
                if not isinstance(items, list):
                    break

                stop_pagination = False
                for item in items:
                    updated_at_str = item.get('updated_at') or ''
                    if updated_at_str:
                        updated_at = self._parse_datetime(updated_at_str)
                        if updated_at < cutoff:
                            stop_pagination = True
                            break

                    pr_number = str(item.get('number') or '')
                    if not pr_number:
                        continue

                    user = item.get('user') or {}
                    head = item.get('head') or {}
                    base_info = item.get('base') or {}

                    await self._upsert_pr(
                        org_id=org_id,
                        repo_mapping_id=repo_mapping_id,
                        provider='github',
                        external_id=pr_number,
                        title=(item.get('title') or '')[:512],
                        author=(user.get('login') or '')[:255],
                        status=(item.get('state') or '')[:32],
                        source_branch=(head.get('ref') or '')[:255],
                        target_branch=(base_info.get('ref') or '')[:255],
                        created_at_ext=self._parse_datetime_opt(item.get('created_at')),
                        merged_at=self._parse_datetime_opt(item.get('merged_at')),
                        closed_at=self._parse_datetime_opt(item.get('closed_at')),
                        additions=int(item.get('additions') or 0),
                        deletions=int(item.get('deletions') or 0),
                        commits_count=int(item.get('commits') or 0),
                        review_comments=int(item.get('review_comments') or 0),
                    )
                    count += 1

                if stop_pagination:
                    break
                url = self._next_page_url(response)
                params = {}

        await self.db.commit()
        logger.info('GitHub PRs synced: %d for %s/%s', count, owner, repo)
        return count

    async def _sync_github_deployments(
        self,
        org_id: int,
        repo_mapping_id: str,
        owner: str,
        repo: str,
        token: str,
    ) -> int:
        url = f'https://api.github.com/repos/{owner}/{repo}/deployments'
        params: dict[str, str] = {'per_page': '100'}
        headers = self._github_headers(token)
        count = 0

        async with httpx.AsyncClient(timeout=30) as client:
            while url:
                response = await self._request_with_rate_limit(client, 'GET', url, headers=headers, params=params)
                if response is None:
                    break
                items = response.json()
                if not isinstance(items, list):
                    break

                for item in items:
                    deploy_id = str(item.get('id') or '')
                    if not deploy_id:
                        continue

                    # Fetch latest status for this deployment
                    status_url = f'https://api.github.com/repos/{owner}/{repo}/deployments/{deploy_id}/statuses'
                    status_resp = await self._request_with_rate_limit(
                        client, 'GET', status_url, headers=headers, params={'per_page': '1'},
                    )
                    deploy_status = ''
                    if status_resp is not None:
                        statuses = status_resp.json()
                        if isinstance(statuses, list) and statuses:
                            deploy_status = str(statuses[0].get('state') or '')

                    environment = str(item.get('environment') or 'production')[:64]
                    created_at_str = item.get('created_at') or ''
                    deployed_at = self._parse_datetime(created_at_str) if created_at_str else datetime.utcnow()
                    sha = str(item.get('sha') or '')[:64]

                    await self._upsert_deployment(
                        org_id=org_id,
                        repo_mapping_id=repo_mapping_id,
                        provider='github',
                        external_id=deploy_id,
                        environment=environment,
                        status=deploy_status[:32],
                        deployed_at=deployed_at,
                        sha=sha,
                    )
                    count += 1

                url = self._next_page_url(response)
                params = {}

        await self.db.commit()
        logger.info('GitHub deployments synced: %d for %s/%s', count, owner, repo)
        return count

    # ── Azure sync methods ───────────────────────────────────────────────────

    async def _sync_azure_commits(
        self,
        org_id: int,
        repo_mapping_id: str,
        org_url: str,
        project: str,
        repo_name: str,
        pat: str,
        since_days: int = 365,
    ) -> int:
        since = (datetime.utcnow() - timedelta(days=since_days)).strftime('%Y-%m-%dT%H:%M:%SZ')
        base = org_url.rstrip('/')
        url = (
            f'{base}/{project}/_apis/git/repositories/{repo_name}/commits'
            f'?searchCriteria.fromDate={since}&api-version=7.1'
        )
        headers = self._azure_headers(pat)
        count = 0

        async with httpx.AsyncClient(timeout=30) as client:
            while url:
                response = await self._request_with_rate_limit(client, 'GET', url, headers=headers)
                if response is None:
                    break
                data = response.json()
                items = data.get('value') or []
                if not isinstance(items, list):
                    break

                for item in items:
                    commit_id = str(item.get('commitId') or '')
                    if not commit_id:
                        continue
                    author_info = item.get('author') or {}
                    committed_at_str = author_info.get('date') or ''
                    if not committed_at_str:
                        continue

                    change_counts = item.get('changeCounts') or {}
                    await self._upsert_commit(
                        org_id=org_id,
                        repo_mapping_id=repo_mapping_id,
                        sha=commit_id[:64],
                        author_name=(author_info.get('name') or '')[:255],
                        author_email=(author_info.get('email') or '')[:255],
                        message=(item.get('comment') or '')[:5000],
                        committed_at=self._parse_datetime(committed_at_str),
                        additions=int(change_counts.get('Add') or 0),
                        deletions=int(change_counts.get('Delete') or 0),
                        files_changed=int(change_counts.get('Edit') or 0),
                    )
                    count += 1

                # Azure pagination via nextLink
                url = data.get('nextLink') or ''
                if not url:
                    break

        await self.db.commit()
        logger.info('Azure commits synced: %d for %s/%s', count, project, repo_name)
        return count

    async def _sync_azure_prs(
        self,
        org_id: int,
        repo_mapping_id: str,
        org_url: str,
        project: str,
        repo_name: str,
        pat: str,
    ) -> int:
        base = org_url.rstrip('/')
        url = (
            f'{base}/{project}/_apis/git/repositories/{repo_name}/pullrequests'
            f'?searchCriteria.status=all&api-version=7.1'
        )
        headers = self._azure_headers(pat)
        count = 0

        async with httpx.AsyncClient(timeout=30) as client:
            while url:
                response = await self._request_with_rate_limit(client, 'GET', url, headers=headers)
                if response is None:
                    break
                data = response.json()
                items = data.get('value') or []
                if not isinstance(items, list):
                    break

                for item in items:
                    pr_id = str(item.get('pullRequestId') or '')
                    if not pr_id:
                        continue

                    created_by = item.get('createdBy') or {}
                    source_ref = str(item.get('sourceRefName') or '').replace('refs/heads/', '')
                    target_ref = str(item.get('targetRefName') or '').replace('refs/heads/', '')

                    await self._upsert_pr(
                        org_id=org_id,
                        repo_mapping_id=repo_mapping_id,
                        provider='azure',
                        external_id=pr_id,
                        title=(item.get('title') or '')[:512],
                        author=(created_by.get('displayName') or created_by.get('uniqueName') or '')[:255],
                        status=(item.get('status') or '')[:32],
                        source_branch=source_ref[:255],
                        target_branch=target_ref[:255],
                        created_at_ext=self._parse_datetime_opt(item.get('creationDate')),
                        merged_at=self._parse_datetime_opt(item.get('closedDate') if item.get('status') == 'completed' else None),
                        closed_at=self._parse_datetime_opt(item.get('closedDate')),
                        additions=0,
                        deletions=0,
                        commits_count=0,
                        review_comments=0,
                    )
                    count += 1

                url = data.get('nextLink') or ''
                if not url:
                    break

        await self.db.commit()
        logger.info('Azure PRs synced: %d for %s/%s', count, project, repo_name)
        return count

    # ── Credential helper ────────────────────────────────────────────────────

    async def _get_credentials(self, org_id: int, provider: str) -> dict[str, str]:
        """Query IntegrationConfig for the org's GitHub/Azure credentials."""
        result = await self.db.execute(
            select(IntegrationConfig).where(
                IntegrationConfig.organization_id == org_id,
                IntegrationConfig.provider == provider,
            )
        )
        config = result.scalar_one_or_none()
        if config is None or not config.secret:
            raise ValueError(f'{provider} integration not configured for this organization')

        return {
            'token': config.secret.strip(),
            'base_url': (config.base_url or '').strip(),
            'project': (config.project or '').strip(),
            'username': (config.username or '').strip(),
        }

    # ── Sync status helper ───────────────────────────────────────────────────

    async def get_sync_status(self, organization_id: int) -> list[dict[str, Any]]:
        """Return last sync time and record counts per repo_mapping_id."""
        results: list[dict[str, Any]] = []

        # Commits
        commit_rows = (await self.db.execute(
            select(
                GitCommit.repo_mapping_id,
                func.count(GitCommit.id).label('count'),
                func.max(GitCommit.created_at).label('last_sync'),
            )
            .where(GitCommit.organization_id == organization_id)
            .group_by(GitCommit.repo_mapping_id)
        )).all()

        # PRs
        pr_rows = (await self.db.execute(
            select(
                GitPullRequest.repo_mapping_id,
                func.count(GitPullRequest.id).label('count'),
                func.max(GitPullRequest.created_at).label('last_sync'),
            )
            .where(GitPullRequest.organization_id == organization_id)
            .group_by(GitPullRequest.repo_mapping_id)
        )).all()

        # Deployments
        deploy_rows = (await self.db.execute(
            select(
                GitDeployment.repo_mapping_id,
                func.count(GitDeployment.id).label('count'),
                func.max(GitDeployment.created_at).label('last_sync'),
            )
            .where(GitDeployment.organization_id == organization_id)
            .group_by(GitDeployment.repo_mapping_id)
        )).all()

        # Merge into a single dict per repo_mapping_id
        merged: dict[str, dict[str, Any]] = {}
        for row in commit_rows:
            key = row.repo_mapping_id
            merged.setdefault(key, {'repo_mapping_id': key, 'commits': 0, 'prs': 0, 'deployments': 0, 'last_sync': None})
            merged[key]['commits'] = row.count
            merged[key]['last_sync'] = self._latest(merged[key]['last_sync'], row.last_sync)
        for row in pr_rows:
            key = row.repo_mapping_id
            merged.setdefault(key, {'repo_mapping_id': key, 'commits': 0, 'prs': 0, 'deployments': 0, 'last_sync': None})
            merged[key]['prs'] = row.count
            merged[key]['last_sync'] = self._latest(merged[key]['last_sync'], row.last_sync)
        for row in deploy_rows:
            key = row.repo_mapping_id
            merged.setdefault(key, {'repo_mapping_id': key, 'commits': 0, 'prs': 0, 'deployments': 0, 'last_sync': None})
            merged[key]['deployments'] = row.count
            merged[key]['last_sync'] = self._latest(merged[key]['last_sync'], row.last_sync)

        for entry in merged.values():
            if entry['last_sync'] is not None:
                entry['last_sync'] = entry['last_sync'].isoformat() + 'Z'
            results.append(entry)

        return results

    # ── Upsert helpers (MySQL ON DUPLICATE KEY UPDATE) ───────────────────────

    async def _upsert_commit(
        self,
        *,
        org_id: int,
        repo_mapping_id: str,
        sha: str,
        author_name: str,
        author_email: str,
        message: str,
        committed_at: datetime,
        additions: int,
        deletions: int,
        files_changed: int,
    ) -> None:
        from sqlalchemy.dialects.mysql import insert as mysql_insert

        stmt = mysql_insert(GitCommit).values(
            organization_id=org_id,
            repo_mapping_id=repo_mapping_id,
            sha=sha,
            author_name=author_name,
            author_email=author_email,
            message=message,
            committed_at=committed_at,
            additions=additions,
            deletions=deletions,
            files_changed=files_changed,
        )
        stmt = stmt.on_duplicate_key_update(
            author_name=stmt.inserted.author_name,
            author_email=stmt.inserted.author_email,
            message=stmt.inserted.message,
            additions=stmt.inserted.additions,
            deletions=stmt.inserted.deletions,
            files_changed=stmt.inserted.files_changed,
        )
        await self.db.execute(stmt)

    async def _upsert_pr(
        self,
        *,
        org_id: int,
        repo_mapping_id: str,
        provider: str,
        external_id: str,
        title: str,
        author: str,
        status: str,
        source_branch: str,
        target_branch: str,
        created_at_ext: datetime | None,
        merged_at: datetime | None,
        closed_at: datetime | None,
        additions: int,
        deletions: int,
        commits_count: int,
        review_comments: int,
    ) -> None:
        from sqlalchemy.dialects.mysql import insert as mysql_insert

        stmt = mysql_insert(GitPullRequest).values(
            organization_id=org_id,
            repo_mapping_id=repo_mapping_id,
            provider=provider,
            external_id=external_id,
            title=title,
            author=author,
            status=status,
            source_branch=source_branch,
            target_branch=target_branch,
            created_at_ext=created_at_ext,
            merged_at=merged_at,
            closed_at=closed_at,
            additions=additions,
            deletions=deletions,
            commits_count=commits_count,
            review_comments=review_comments,
        )
        stmt = stmt.on_duplicate_key_update(
            title=stmt.inserted.title,
            author=stmt.inserted.author,
            status=stmt.inserted.status,
            source_branch=stmt.inserted.source_branch,
            target_branch=stmt.inserted.target_branch,
            created_at_ext=stmt.inserted.created_at_ext,
            merged_at=stmt.inserted.merged_at,
            closed_at=stmt.inserted.closed_at,
            additions=stmt.inserted.additions,
            deletions=stmt.inserted.deletions,
            commits_count=stmt.inserted.commits_count,
            review_comments=stmt.inserted.review_comments,
        )
        await self.db.execute(stmt)

    async def _upsert_deployment(
        self,
        *,
        org_id: int,
        repo_mapping_id: str,
        provider: str,
        external_id: str,
        environment: str,
        status: str,
        deployed_at: datetime,
        sha: str,
    ) -> None:
        from sqlalchemy.dialects.mysql import insert as mysql_insert

        stmt = mysql_insert(GitDeployment).values(
            organization_id=org_id,
            repo_mapping_id=repo_mapping_id,
            provider=provider,
            external_id=external_id,
            environment=environment,
            status=status,
            deployed_at=deployed_at,
            sha=sha,
        )
        stmt = stmt.on_duplicate_key_update(
            environment=stmt.inserted.environment,
            status=stmt.inserted.status,
            deployed_at=stmt.inserted.deployed_at,
            sha=stmt.inserted.sha,
        )
        await self.db.execute(stmt)

    # ── HTTP / auth helpers ──────────────────────────────────────────────────

    def _github_headers(self, token: str) -> dict[str, str]:
        return {
            'Authorization': f'Bearer {token}',
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        }

    def _azure_headers(self, pat: str) -> dict[str, str]:
        token = base64.b64encode(f':{pat}'.encode()).decode()
        return {'Authorization': f'Basic {token}', 'Content-Type': 'application/json'}

    async def _request_with_rate_limit(
        self,
        client: httpx.AsyncClient,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        params: dict[str, str] | None = None,
    ) -> httpx.Response | None:
        """Execute an HTTP request, handling 429 rate-limit responses
        gracefully by logging a warning and returning ``None``."""
        try:
            response = await client.request(method, url, headers=headers, params=params)
            if response.status_code == 429:
                logger.warning('Rate limited by API: %s %s', method, url)
                return None
            response.raise_for_status()
            return response
        except httpx.HTTPStatusError as exc:
            logger.warning('HTTP error %s for %s %s: %s', exc.response.status_code, method, url, exc)
            return None
        except httpx.RequestError as exc:
            logger.warning('Request error for %s %s: %s', method, url, exc)
            return None

    def _next_page_url(self, response: httpx.Response) -> str:
        """Parse the GitHub ``Link`` header to find the next page URL."""
        link_header = response.headers.get('link') or ''
        for part in link_header.split(','):
            if 'rel="next"' in part:
                url_part = part.split(';')[0].strip().strip('<>')
                if url_part:
                    return url_part
        return ''

    # ── Date / utility helpers ───────────────────────────────────────────────

    def _parse_datetime(self, value: str) -> datetime:
        """Parse ISO 8601 datetime strings from GitHub/Azure APIs."""
        value = value.strip()
        for fmt in ('%Y-%m-%dT%H:%M:%SZ', '%Y-%m-%dT%H:%M:%S.%fZ', '%Y-%m-%dT%H:%M:%S%z'):
            try:
                dt = datetime.strptime(value, fmt)
                return dt.replace(tzinfo=None) if dt.tzinfo else dt
            except ValueError:
                continue
        # Fallback: strip timezone suffix and try again
        if '+' in value:
            value = value.split('+')[0]
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return datetime.utcnow()

    def _parse_datetime_opt(self, value: Any) -> datetime | None:
        if not value:
            return None
        return self._parse_datetime(str(value))

    def _extract_azure_repo_name(self, repo_url: str) -> str:
        """Extract repository name from an Azure DevOps repo URL."""
        from urllib.parse import urlparse

        parsed = urlparse(repo_url)
        path = (parsed.path or '').rstrip('/')
        if '/_git/' in path:
            return path.split('/_git/')[-1].strip()
        return path.rsplit('/', 1)[-1].strip()

    def _latest(self, a: datetime | None, b: datetime | None) -> datetime | None:
        if a is None:
            return b
        if b is None:
            return a
        return max(a, b)
