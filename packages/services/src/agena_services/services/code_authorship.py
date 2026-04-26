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


async def _load_team_members(db: AsyncSession, user_id: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Pull the user's saved `my_team` lists (Azure + Jira) so author
    emails can be linked back to a real member id. Returns
    `(azure_members, jira_members)`. Both lists are best-effort: an
    empty preferences row yields empty lists."""
    import json as _json
    try:
        from agena_models.models.user_preference import UserPreference
        pref = (await db.execute(
            select(UserPreference).where(UserPreference.user_id == user_id)
        )).scalar_one_or_none()
        if pref is None:
            return [], []
        # Azure team is stored either in legacy my_team_json or
        # profile_settings.my_team_by_source.azure.
        legacy: list[dict[str, Any]] = []
        try:
            legacy = _json.loads(pref.my_team_json or '[]') or []
        except Exception:
            legacy = []
        ps_raw = pref.profile_settings_json or '{}'
        try:
            ps = _json.loads(ps_raw) or {}
        except Exception:
            ps = {}
        by_source = ps.get('my_team_by_source') if isinstance(ps, dict) else None
        azure_team = legacy
        jira_team: list[dict[str, Any]] = []
        if isinstance(by_source, dict):
            azure_team = by_source.get('azure') or azure_team
            jira_team = by_source.get('jira') or []
        return (
            [m for m in azure_team if isinstance(m, dict)],
            [m for m in jira_team if isinstance(m, dict)],
        )
    except Exception as exc:
        logger.info('Could not load team members for user %s: %s', user_id, exc)
        return [], []


def _match_email_to_member(
    email: str,
    name: str,
    azure_team: list[dict[str, Any]],
    jira_team: list[dict[str, Any]],
) -> tuple[str, str, str, str]:
    """Best-effort match of a git-author email/name to a saved team
    member. Returns `(id, display_name, unique_name, source)` or all
    blanks. Email beats name; case-insensitive on both."""
    email_lc = (email or '').strip().lower()
    name_lc = (name or '').strip().lower()
    if not email_lc and not name_lc:
        return '', '', '', ''
    for source, team in (('azure', azure_team), ('jira', jira_team)):
        for m in team:
            unique = str(m.get('uniqueName') or m.get('emailAddress') or m.get('email') or '').strip().lower()
            disp = str(m.get('displayName') or m.get('name') or '').strip().lower()
            if email_lc and unique and email_lc == unique:
                return (
                    str(m.get('id') or ''),
                    str(m.get('displayName') or m.get('name') or ''),
                    str(m.get('uniqueName') or m.get('emailAddress') or m.get('email') or ''),
                    source,
                )
        # Fallback: name match if email didn't hit.
        if name_lc:
            for m in team:
                disp = str(m.get('displayName') or m.get('name') or '').strip().lower()
                if disp and disp == name_lc:
                    return (
                        str(m.get('id') or ''),
                        str(m.get('displayName') or m.get('name') or ''),
                        str(m.get('uniqueName') or m.get('emailAddress') or m.get('email') or ''),
                        source,
                    )
    return '', '', '', ''


async def resolve_authorship_for_files(
    db: AsyncSession,
    organization_id: int,
    file_paths: list[str],
    *,
    since: str = '6.months.ago',
    top_n: int = 3,
    user_id: int | None = None,
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
    azure_team: list[dict[str, Any]] = []
    jira_team: list[dict[str, Any]] = []
    if user_id is not None:
        azure_team, jira_team = await _load_team_members(db, user_id)
    authors: list[RecommendedAuthor] = []
    for b in ranked:
        member_id, member_disp, member_unique, member_source = _match_email_to_member(
            str(b['email'] or ''), str(b['name'] or ''),
            azure_team, jira_team,
        )
        authors.append(RecommendedAuthor(
            name=str(b['name']),
            email=str(b['email'] or ''),
            commit_count=int(b['commits']),
            files_touched=len(b['files']),
            reason=(
                f"{b['commits']} commits across {len(b['files'])} touched file(s) "
                f'in last {since.replace(".", " ").replace("ago", "ago")}'
            ),
            member_id=member_id,
            member_display_name=member_disp,
            member_unique_name=member_unique,
            member_source=member_source,
        ))
    return touched, authors
