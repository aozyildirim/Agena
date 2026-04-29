from __future__ import annotations

import asyncio
import base64
import logging
from datetime import datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.git_commit import GitCommit
from agena_models.models.git_deployment import GitDeployment
from agena_models.models.git_pull_request import GitPullRequest
from agena_models.models.integration_config import IntegrationConfig

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
            deployments = await self._sync_azure_deployments(
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
        # Commit every N pages so progress shows up in the dashboard while a
        # long sync is still walking history. Without this users see "0
        # commits" for the entire ~10min Agena-sized backfill.
        commit_every_pages = 10
        pages_since_commit = 0

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

                pages_since_commit += 1
                if pages_since_commit >= commit_every_pages:
                    await self.db.commit()
                    pages_since_commit = 0

                url = self._next_page_url(response)
                # CRITICAL: must be None, not {}. httpx's `params={}`
                # overwrites the URL's existing query string instead of
                # leaving it alone, so the Link-header URL's `?page=N`
                # gets stripped and every fetch hits page 1 again. Took
                # 50k inserts collapsing into 100 unique SHAs to find.
                params = None

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
                params = None  # see commits sync — empty dict strips URL query

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
                params = None  # see commits sync — empty dict strips URL query

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
        # Azure git/commits API does NOT return `nextLink` in the body and
        # ignores Link headers. Pagination is via $top + $skip; default
        # $top is 100, max is 1000. Walk pages until a short page comes
        # back.
        page_size = 1000
        skip = 0
        headers = self._azure_headers(pat)
        count = 0
        commit_every_pages = 5
        pages_since_commit = 0

        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                url = (
                    f'{base}/{project}/_apis/git/repositories/{repo_name}/commits'
                    f'?searchCriteria.fromDate={since}'
                    f'&searchCriteria.$top={page_size}&searchCriteria.$skip={skip}'
                    '&api-version=7.1'
                )
                response = await self._request_with_rate_limit(client, 'GET', url, headers=headers)
                if response is None:
                    break
                data = response.json()
                items = data.get('value') or []
                if not isinstance(items, list) or not items:
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

                pages_since_commit += 1
                if pages_since_commit >= commit_every_pages:
                    await self.db.commit()
                    pages_since_commit = 0

                if len(items) < page_size:
                    break
                skip += page_size

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
        # Same pagination story as commits — body has no nextLink. Use
        # $top + $skip and walk until a short page lands.
        page_size = 1000
        skip = 0
        headers = self._azure_headers(pat)
        count = 0

        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                url = (
                    f'{base}/{project}/_apis/git/repositories/{repo_name}/pullrequests'
                    f'?searchCriteria.status=all'
                    f'&$top={page_size}&$skip={skip}'
                    '&api-version=7.1'
                )
                response = await self._request_with_rate_limit(client, 'GET', url, headers=headers)
                if response is None:
                    break
                data = response.json()
                items = data.get('value') or []
                if not isinstance(items, list) or not items:
                    break

                for item in items:
                    pr_id = str(item.get('pullRequestId') or '')
                    if not pr_id:
                        continue

                    created_by = item.get('createdBy') or {}
                    source_ref = str(item.get('sourceRefName') or '').replace('refs/heads/', '')
                    target_ref = str(item.get('targetRefName') or '').replace('refs/heads/', '')

                    # Reviewer count as proxy for review comments (Azure doesn't include thread count in PR list)
                    reviewers = item.get('reviewers') or []
                    review_count = len([r for r in reviewers if r.get('vote', 0) != 0])

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
                        review_comments=review_count,
                    )
                    count += 1

                if len(items) < page_size:
                    break
                skip += page_size

        await self.db.commit()
        # Backfill additions/deletions/commits_count for merged PRs that
        # are still 0/0 — Azure's PR list endpoint doesn't include diff
        # stats so the rows above land empty. We resolve them by asking
        # `/pullrequests/{id}/commits` (one call per PR) and summing the
        # additions/deletions of the matching SHAs in our git_commits
        # table. Concurrency-capped so we don't get rate-limited.
        await self._backfill_azure_pr_line_stats(
            org_id, repo_mapping_id, base, project, repo_name, headers,
        )
        logger.info('Azure PRs synced: %d for %s/%s', count, project, repo_name)
        return count

    async def _backfill_azure_pr_line_stats(
        self,
        org_id: int,
        repo_mapping_id: str,
        base: str,
        project: str,
        repo_name: str,
        headers: dict[str, str],
    ) -> None:
        from agena_models.models.git_pull_request import GitPullRequest as PR
        # Pick merged PRs in this repo with empty stats. Cap the batch so
        # a freshly-synced repo doesn't punish the user with a 30-min
        # backfill on first sync — subsequent syncs whittle the backlog
        # down. 200 per sync cycle ≈ ~30s with 10 concurrent calls.
        rows = (await self.db.execute(
            select(PR.id, PR.external_id)
            .where(
                PR.organization_id == org_id,
                PR.repo_mapping_id == repo_mapping_id,
                PR.merged_at.isnot(None),
                PR.additions == 0,
                PR.deletions == 0,
            )
            .order_by(PR.merged_at.desc())
            .limit(200)
        )).all()
        if not rows:
            return

        # Pull every relevant SHA → (additions, deletions) into memory
        # once so each PR resolves with no extra DB round-trips.
        commit_rows = (await self.db.execute(
            select(GitCommit.sha, GitCommit.additions, GitCommit.deletions)
            .where(
                GitCommit.organization_id == org_id,
                GitCommit.repo_mapping_id == repo_mapping_id,
            )
        )).all()
        sha_stats = {r.sha: (int(r.additions or 0), int(r.deletions or 0)) for r in commit_rows}

        sem = asyncio.Semaphore(10)
        async with httpx.AsyncClient(timeout=20) as client:
            async def _one(pr_id: int, ext_id: str) -> tuple[int, int, int, int] | None:
                async with sem:
                    url = (
                        f'{base}/{project}/_apis/git/repositories/{repo_name}'
                        f'/pullrequests/{ext_id}/commits?api-version=7.1'
                    )
                    resp = await self._request_with_rate_limit(client, 'GET', url, headers=headers)
                    if resp is None:
                        return None
                    try:
                        data = resp.json() or {}
                    except Exception:
                        return None
                    shas = [(c.get('commitId') or '') for c in (data.get('value') or [])]
                    add = 0
                    deletes = 0
                    matched = 0
                    for sha in shas:
                        if not sha:
                            continue
                        if sha in sha_stats:
                            a, d = sha_stats[sha]
                            add += a
                            deletes += d
                            matched += 1
                    return pr_id, add, deletes, len(shas)

            results = await asyncio.gather(
                *[_one(r.id, r.external_id) for r in rows],
                return_exceptions=True,
            )

        # Apply updates in a single tight loop. Skip rows where every
        # commit was an unsynced SHA (matched 0 of N) — leaving the row
        # at 0/0 lets a later sync retry once those commits are in the
        # local table.
        from sqlalchemy import update as sa_update
        applied = 0
        for r in results:
            if isinstance(r, Exception) or r is None:
                continue
            pr_id, add, deletes, n_commits = r
            if add == 0 and deletes == 0:
                # Either the PR really had 0 lines changed (rename-only,
                # binary, etc.) or none of its commits were in our local
                # mirror yet. Either way, leave the next sync to confirm.
                continue
            await self.db.execute(
                sa_update(PR)
                .where(PR.id == pr_id)
                .values(additions=add, deletions=deletes, commits_count=n_commits)
            )
            applied += 1
        if applied:
            await self.db.commit()
            logger.info(
                'Azure PR line-stats backfill: %d/%d for %s/%s',
                applied, len(rows), project, repo_name,
            )

    async def _sync_azure_deployments(
        self,
        org_id: int,
        repo_mapping_id: str,
        org_url: str,
        project: str,
        repo_name: str,
        pat: str,
        since_days: int = 365,
    ) -> int:
        """Pull Azure Pipelines builds and attribute each to the repo whose
        commit it built — by SHA join, not by ``repositoryId``.

        Why SHA-join instead of ``repositoryId={repo}``: many orgs keep
        Pipelines YAML in a centralized repo (e.g. ``yml-files``) and
        run multi-repo builds. Azure tags those builds with the YAML
        repo's GUID, not the deployed app's, so a strict ``repositoryId``
        filter returns 0 for the actual product repo even when builds
        run multiple times a day. Joining via the build's
        ``sourceVersion`` (commit SHA) → ``git_commits.sha`` → owning
        ``repo_mapping_id`` works regardless of how Pipelines are
        organized, with zero per-tenant configuration.

        Returns the count of deployments attributed to *this* call's
        ``repo_mapping_id``. Builds whose SHA matches a different repo
        in the same org are still upserted (under that other mapping)
        so a future per-repo sync doesn't have to re-fetch them — the
        result is idempotent thanks to the unique
        ``(provider, external_id)`` upsert in ``_upsert_deployment``.
        """
        base = org_url.rstrip('/')
        headers = self._azure_headers(pat)
        attributed_to_caller = 0
        attributed_unmatched = 0
        attributed_other_repo = 0

        # Build a SHA → repo_mapping_id index for the org once, up front.
        # Restricted to the org's commits, so a build's sourceVersion can
        # only resolve to a repo this caller is actually allowed to touch.
        sha_index = await self._build_sha_to_mapping_index(org_id)

        async with httpx.AsyncClient(timeout=30) as client:
            min_time = (datetime.utcnow() - timedelta(days=since_days)).strftime('%Y-%m-%dT%H:%M:%SZ')
            page_size = 1000
            continuation: str = ''
            while True:
                qs = (
                    f'?statusFilter=completed&minTime={min_time}'
                    f'&$top={page_size}'
                    '&api-version=7.1'
                )
                if continuation:
                    qs += f'&continuationToken={continuation}'
                response = await self._request_with_rate_limit(
                    client, 'GET',
                    f'{base}/{project}/_apis/build/builds{qs}',
                    headers=headers,
                )
                if response is None:
                    break
                data = response.json()
                items = data.get('value') or []
                if not isinstance(items, list) or not items:
                    break

                for item in items:
                    build_id = str(item.get('id') or '')
                    if not build_id:
                        continue
                    finish_time = item.get('finishTime') or item.get('queueTime')
                    if not finish_time:
                        continue
                    sha = (item.get('sourceVersion') or '').strip()[:64]
                    if not sha:
                        continue
                    matched_mapping = sha_index.get(sha)
                    if not matched_mapping:
                        attributed_unmatched += 1
                        continue
                    result = (item.get('result') or '').lower()
                    if result == 'succeeded':
                        status = 'success'
                    elif result == 'failed':
                        status = 'failure'
                    elif result == 'canceled':
                        status = 'cancelled'
                    else:
                        status = result or 'unknown'
                    await self._upsert_deployment(
                        org_id=org_id,
                        repo_mapping_id=matched_mapping,
                        provider='azure',
                        external_id=build_id,
                        environment='production',
                        status=status,
                        deployed_at=self._parse_datetime(finish_time),
                        sha=sha,
                    )
                    if str(matched_mapping) == str(repo_mapping_id):
                        attributed_to_caller += 1
                    else:
                        attributed_other_repo += 1

                continuation = response.headers.get('x-ms-continuationtoken', '')
                if not continuation:
                    break

        await self.db.commit()
        logger.info(
            'Azure deployments synced: %d for %s/%s (also wrote %d to other repos in this org via SHA join, %d builds had no matching commit)',
            attributed_to_caller, project, repo_name, attributed_other_repo, attributed_unmatched,
        )
        return attributed_to_caller

    async def _build_sha_to_mapping_index(self, org_id: int) -> dict[str, str]:
        """Map every commit SHA the org has synced to its owning
        ``repo_mapping_id``. Used to attribute Pipelines builds to the
        right repo even when Azure tags the build with a centralized
        YAML repo's GUID."""
        rows = (await self.db.execute(
            select(GitCommit.sha, GitCommit.repo_mapping_id)
            .where(GitCommit.organization_id == org_id)
        )).all()
        return {row.sha: str(row.repo_mapping_id) for row in rows if row.sha}

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
        first_commit_at: datetime | None = None,
    ) -> None:
        from sqlalchemy.dialects.mysql import insert as mysql_insert

        # DORA's lead-time-for-changes wants commit → merge, but neither
        # Azure's PR list nor GitHub's exposes the first-commit timestamp
        # without an extra round-trip per PR. As a free proxy we treat the
        # PR's own creationDate as the first commit time — most teams open
        # the PR within minutes of pushing the branch, so the error is
        # bounded. Callers that *do* want true commit time can pass
        # ``first_commit_at`` explicitly.
        effective_first_commit = first_commit_at or created_at_ext

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
            first_commit_at=effective_first_commit,
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
            first_commit_at=stmt.inserted.first_commit_at,
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
