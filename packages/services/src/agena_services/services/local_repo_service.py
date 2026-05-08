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
        is_revision: bool = False,
    ) -> tuple[bool, str]:
        root = Path(repo_path).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError(f'Local repo path does not exist: {repo_path}')

        git_dir = root / '.git'
        if not git_dir.exists():
            raise ValueError(f'Not a git repository: {repo_path}')

        # Stash any uncommitted changes (preserves user's WIP) so the agent
        # sees a clean working tree.
        await self._run_git(root, ['stash', '--include-untracked'], allow_fail=True)

        # Save current branch to restore later
        original_branch = (await self._run_git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).strip()

        remote_target = self._build_remote_target(remote_url, remote_pat) if remote_url else 'origin'

        if is_revision:
            # Revision flow: build on top of the EXISTING feature branch
            # so the new commit is a child of the original PR commit
            # and a normal fast-forward push lands cleanly. Rebuilding
            # from base (the non-revision path) would orphan the
            # original commit, the lease check would reject the push,
            # and the fallback non-force push would non-fast-forward
            # reject too — leaving the worker telling the user "pushed"
            # when nothing reached the remote.
            feature_fetched = False
            try:
                await self._run_git(root, ['fetch', remote_target, branch_name])
                feature_fetched = True
            except Exception:
                pass
            if feature_fetched:
                # Hard-reset the local branch to remote so prior
                # failed-push leftovers don't poison the new commit.
                await self._run_git(root, ['checkout', '-B', branch_name, 'FETCH_HEAD'])
            else:
                # Remote branch missing (deleted? renamed?) — fall back
                # to the base branch and treat this run like a fresh
                # PR push so we still produce something useful.
                try:
                    await self._run_git(root, ['fetch', remote_target, base_branch])
                    await self._run_git(root, ['checkout', '-B', branch_name, 'FETCH_HEAD'])
                except Exception:
                    await self._run_git(root, ['checkout', '-B', branch_name], allow_fail=True)
        else:
            # Fresh-PR flow: rebuild the feature branch on top of base.
            # Throws away any stale local feature-branch state so a
            # previous failed run can't bleed into this one — the
            # follow-up force-push updates the remote to match.
            base_fetched = False
            try:
                await self._run_git(root, ['fetch', remote_target, base_branch])
                base_fetched = True
            except Exception:
                pass
            start_ref = 'FETCH_HEAD' if base_fetched else base_branch
            try:
                await self._run_git(root, ['checkout', '-B', branch_name, start_ref], allow_fail=True)
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

            # Push. For revisions a normal fast-forward is what we want
            # (we built on top of the remote tip). For fresh PRs we
            # need force so a stale prior-run feature branch on the
            # remote gets overwritten. Either way, surface a real
            # error instead of silently swallowing — the previous
            # behaviour was the bug behind "pushed but nothing on the
            # remote." Try a non-force first when revising; fall
            # back to force-with-lease only if the upstream raced.
            if is_revision:
                try:
                    await self._run_git(root, ['push', '-u', remote_target, branch_name])
                except Exception:
                    # Upstream advanced under us — fast-forward isn't
                    # possible. Force with lease so we at least don't
                    # clobber commits we've never seen.
                    await self._run_git(root, ['push', '-u', '--force-with-lease', remote_target, branch_name])
            else:
                try:
                    await self._run_git(root, ['push', '-u', '--force-with-lease', remote_target, branch_name])
                except Exception:
                    await self._run_git(root, ['push', '-u', '--force', remote_target, branch_name])

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
