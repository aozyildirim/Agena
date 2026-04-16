from __future__ import annotations

import asyncio
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import quote, urlparse, urlunparse

from agena_models.schemas.github import GitHubFileChange


class LocalRepoService:
    GIT_COMMAND_TIMEOUT_SEC = 300

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

        # Stash any uncommitted changes first
        await self._run_git(root, ['stash', '--include-untracked'], allow_fail=True)

        # Save current branch to restore later
        original_branch = (await self._run_git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).strip()

        if remote_url:
            # PR flow: create/checkout feature branch
            remote_target = self._build_remote_target(remote_url, remote_pat)
            try:
                await self._run_git(root, ['fetch', remote_target, base_branch])
            except Exception:
                pass

            # If the branch already exists remotely, continue on top of it.
            branch_exists = False
            try:
                await self._run_git(root, ['fetch', remote_target, branch_name])
                branch_exists = True
            except Exception:
                pass

            if branch_exists:
                await self._run_git(root, ['checkout', '-B', branch_name, 'FETCH_HEAD'], allow_fail=True)
            else:
                try:
                    await self._run_git(root, ['checkout', '-B', branch_name, base_branch], allow_fail=True)
                except Exception:
                    await self._run_git(root, ['checkout', '-B', branch_name])
        else:
            remote_target = 'origin'
            # No explicit remote URL — still create branch for PR flow
            try:
                await self._run_git(root, ['fetch', remote_target, base_branch])
            except Exception:
                pass
            try:
                await self._run_git(root, ['checkout', '-B', branch_name, base_branch], allow_fail=True)
            except Exception:
                await self._run_git(root, ['checkout', '-B', branch_name])

        try:
            # Write files directly to the repo
            for file_change in files:
                target = self._safe_target(root, file_change.path)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(file_change.content, encoding='utf-8')

            await self._run_git(root, ['add', '-A'])
            has_changes = await self._has_staged_changes(root)
            if not has_changes:
                await self._run_git(root, ['checkout', original_branch], allow_fail=True)
                await self._run_git(root, ['stash', 'pop'], allow_fail=True)
                return False, branch_name

            await self._run_git(
                root,
                ['-c', 'user.name=AI Agent', '-c', 'user.email=ai-agent@local',
                 'commit', '-m', commit_message],
            )

            # Push in PR flow
            try:
                await self._run_git(root, ['push', '-u', '--force-with-lease', remote_target, branch_name])
            except Exception:
                await self._run_git(root, ['push', '-u', remote_target, branch_name], allow_fail=True)

            return True, branch_name
        except Exception:
            # On failure, restore original branch
            await self._run_git(root, ['checkout', original_branch], allow_fail=True)
            await self._run_git(root, ['stash', 'pop'], allow_fail=True)
            raise

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

    async def _run_git(self, repo: Path, args: list[str], allow_fail: bool = False) -> str:
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
                'GIT_TERMINAL_PROMPT': '0',
            },
        )
        try:
            out, err = await asyncio.wait_for(
                proc.communicate(),
                timeout=self.GIT_COMMAND_TIMEOUT_SEC,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            raise RuntimeError(
                f"git {' '.join(args)} timed out after {self.GIT_COMMAND_TIMEOUT_SEC}s"
            )
        if proc.returncode != 0:
            msg = (err.decode('utf-8', errors='ignore') or out.decode('utf-8', errors='ignore')).strip()
            if allow_fail:
                return msg
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
