from __future__ import annotations

import asyncio
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import quote, urlparse, urlunparse

from schemas.github import GitHubFileChange


class LocalRepoService:
    async def apply_changes_and_push(
        self,
        repo_path: str,
        branch_name: str,
        base_branch: str,
        commit_message: str,
        files: list[GitHubFileChange],
        remote_url: str | None = None,
        remote_pat: str | None = None,
    ) -> tuple[bool, str]:
        root = Path(repo_path).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError(f'Local repo path does not exist: {repo_path}')

        git_dir = root / '.git'
        if not git_dir.exists():
            raise ValueError(f'Not a git repository: {repo_path}')

        remote_target = self._build_remote_target(remote_url, remote_pat)
        await self._run_git(root, ['fetch', remote_target, base_branch])
        fetched_commit = await self._run_git(root, ['rev-parse', 'FETCH_HEAD'])

        worktree_path = Path(tempfile.mkdtemp(prefix='ai-agent-worktree-'))
        try:
            await self._run_git(root, ['worktree', 'add', '--detach', str(worktree_path), fetched_commit])
            await self._run_git(worktree_path, ['checkout', '-B', branch_name, fetched_commit])

            for file_change in files:
                target = self._safe_target(worktree_path, file_change.path)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(file_change.content, encoding='utf-8')

            await self._run_git(worktree_path, ['add', '-A'])
            has_changes = await self._has_staged_changes(worktree_path)
            if not has_changes:
                return False, branch_name

            await self._run_git(
                worktree_path,
                [
                    '-c',
                    'user.name=AI Agent',
                    '-c',
                    'user.email=ai-agent@local',
                    'commit',
                    '-m',
                    commit_message,
                ],
            )
            await self._run_git(worktree_path, ['push', '-u', remote_target, branch_name])
            return True, branch_name
        finally:
            try:
                await self._run_git(root, ['worktree', 'remove', '--force', str(worktree_path)])
            except Exception:
                # Non-fatal cleanup issue; main flow already completed/failed.
                pass

    async def _has_staged_changes(self, repo: Path) -> bool:
        proc = await asyncio.create_subprocess_exec(
            'git',
            '-C',
            str(repo),
            'diff',
            '--cached',
            '--quiet',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
        # --quiet returns 1 when changes exist, 0 when clean
        return proc.returncode == 1

    async def _run_git(self, repo: Path, args: list[str]) -> str:
        proc = await asyncio.create_subprocess_exec(
            'git',
            '-C',
            str(repo),
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={
                **os.environ,
                'LC_ALL': 'C',
                'GIT_SSH_COMMAND': 'ssh -o StrictHostKeyChecking=accept-new',
            },
        )
        out, err = await proc.communicate()
        if proc.returncode != 0:
            msg = (err.decode('utf-8', errors='ignore') or out.decode('utf-8', errors='ignore')).strip()
            raise RuntimeError(f"git {' '.join(args)} failed: {msg}")
        return out.decode('utf-8', errors='ignore').strip()

    def _safe_target(self, root: Path, rel_path: str) -> Path:
        clean = rel_path.strip().replace('\\', '/')
        clean = re.sub(r'^/+', '', clean)
        target = (root / clean).resolve()
        if not str(target).startswith(str(root)):
            raise ValueError(f'Invalid file path outside repository: {rel_path}')
        return target

    def _build_remote_target(self, remote_url: str | None, remote_pat: str | None) -> str:
        if not remote_url:
            return 'origin'
        if not remote_pat:
            return remote_url
        parsed = urlparse(remote_url)
        if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
            return remote_url

        username = parsed.username or 'pat'
        host = parsed.hostname or parsed.netloc
        if parsed.port:
            host = f'{host}:{parsed.port}'
        netloc = f'{quote(username, safe="")}:{quote(remote_pat, safe="")}@{host}'
        return urlunparse((parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))
