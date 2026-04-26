"""Shared helper for resolving code authorship from file paths.

Used by refinement to pick recent committers as candidate assignees, and
also exposed for the PM analyze node / flow runner so any code that
produces a `file_changes` list can attach "who recently worked here"
metadata without duplicating the git-log + repo-mapping plumbing.
"""

from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.schemas.refinement import RecommendedAuthor, TouchedFile

logger = logging.getLogger(__name__)


async def resolve_authorship_for_files(
    db: AsyncSession,
    organization_id: int,
    file_paths: list[str],
    *,
    since: str = '6.months.ago',
    top_n: int = 3,
) -> tuple[list[TouchedFile], list[RecommendedAuthor]]:
    """For each path the LLM proposed, locate it inside one of the org's
    active repo mappings and aggregate `git log` authorship.

    Returns `(touched_files, recommended_authors)`. The function is
    best-effort: a missing checkout or unavailable git just yields the
    path list with no author info — never raises.
    """
    clean_paths = [str(p).strip() for p in file_paths if str(p or '').strip()]
    if not clean_paths:
        return [], []

    from agena_models.models.repo_mapping import RepoMapping

    rows = (await db.execute(
        select(RepoMapping).where(
            RepoMapping.organization_id == organization_id,
            RepoMapping.is_active.is_(True),
        )
    )).scalars().all()
    repos = [r for r in rows if (r.local_repo_path or '').strip()]
    if not repos:
        # No checkout we can grep — return paths as-is so the UI can still
        # show what the LLM thinks needs editing.
        return [TouchedFile(file=p) for p in clean_paths], []

    touched: list[TouchedFile] = []
    author_agg: dict[str, dict[str, Any]] = {}

    for raw_path in clean_paths:
        normalized = raw_path.lstrip('/')
        located = None
        for repo in repos:
            root = Path(repo.local_repo_path).expanduser().resolve()
            candidate = root / normalized
            if candidate.exists():
                located = (repo, root, str(candidate.relative_to(root)))
                break
        if not located:
            touched.append(TouchedFile(file=raw_path, action='modify'))
            continue
        repo, root, rel = located
        touched.append(TouchedFile(
            file=rel, action='modify',
            repo_mapping_name=f'{repo.provider}:{repo.owner}/{repo.repo_name}',
        ))
        try:
            env = {
                **os.environ,
                'GIT_CONFIG_COUNT': '1',
                'GIT_CONFIG_KEY_0': 'safe.directory',
                'GIT_CONFIG_VALUE_0': str(root),
            }
            result = subprocess.run(
                [
                    'git', '-C', str(root), 'log',
                    f'--since={since}', '--pretty=%aN\t%aE',
                    '--', rel,
                ],
                capture_output=True, text=True, timeout=10, env=env,
            )
            for line in (result.stdout or '').splitlines():
                parts = line.split('\t', 1)
                if not parts or not parts[0].strip():
                    continue
                name = parts[0].strip()
                email = (parts[1].strip() if len(parts) > 1 else '').lower()
                key = email or name
                bucket = author_agg.setdefault(key, {
                    'name': name, 'email': email, 'commits': 0, 'files': set(),
                })
                bucket['commits'] = int(bucket['commits']) + 1
                bucket['files'].add(rel)
        except Exception as exc:
            logger.info('git log failed for %s in %s: %s', rel, root, exc)
            continue

    ranked = sorted(
        author_agg.values(),
        key=lambda b: (b['commits'], len(b['files'])),
        reverse=True,
    )[:top_n]
    authors = [
        RecommendedAuthor(
            name=str(b['name']),
            email=str(b['email'] or ''),
            commit_count=int(b['commits']),
            files_touched=len(b['files']),
            reason=(
                f"{b['commits']} commits across {len(b['files'])} touched file(s) "
                f'in last {since.replace(".", " ").replace("ago", "ago")}'
            ),
        )
        for b in ranked
    ]
    return touched, authors
