"""Claude CLI service — runs Claude Code via CLI bridge or local binary."""
from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Awaitable, Callable


LogCallback = Callable[[str], Awaitable[None]]


class ClaudeCLIService:
    EXEC_TIMEOUT_SEC = 600

    # ── Worktree helpers ─────────────────────────────────────────────────
    @staticmethod
    def _create_worktree(repo_path: str, task_id: str = '') -> str | None:
        """Create a git worktree from main so each task works on a clean copy."""
        repo = Path(repo_path).expanduser().resolve()
        if not (repo / '.git').exists():
            return None
        wt_name = f'.worktree-agena-{task_id or uuid.uuid4().hex[:8]}'
        wt_path = repo.parent / wt_name
        if wt_path.exists():
            # Reuse existing worktree
            return str(wt_path)
        try:
            # Determine base branch
            base = subprocess.run(
                ['git', 'symbolic-ref', 'refs/remotes/origin/HEAD'],
                cwd=str(repo), capture_output=True, text=True, timeout=10,
            ).stdout.strip().replace('refs/remotes/origin/', '') or 'main'
            subprocess.run(
                ['git', 'worktree', 'add', str(wt_path), base],
                cwd=str(repo), capture_output=True, text=True, timeout=30,
                check=True,
            )
            return str(wt_path)
        except Exception:
            return None

    @staticmethod
    def _remove_worktree(repo_path: str, wt_path: str) -> None:
        """Remove a worktree after task completes."""
        try:
            subprocess.run(
                ['git', 'worktree', 'remove', '--force', wt_path],
                cwd=repo_path, capture_output=True, text=True, timeout=15,
            )
        except Exception:
            pass

    async def generate_file_markdown(
        self,
        *,
        repo_path: str,
        task_title: str,
        task_description: str,
        model: str | None = None,
        log_callback: LogCallback | None = None,
        task_id: str = '',
    ) -> str:
        prompt = (
            'Implement the following task in the CURRENT repository.\n\n'
            'WORKFLOW:\n'
            '1. Read the relevant source files to understand the existing code.\n'
            '2. Use the Edit or Write tools to make changes directly in the repo.\n'
            '3. Keep changes minimal and focused on the task.\n'
            '4. After all edits are done, output a short summary listing every file you changed.\n\n'
            'RULES:\n'
            '- Actually edit the files using tools — do NOT just output code blocks.\n'
            '- If a file is large, read it first, then make targeted edits.\n'
            '- Do NOT try to compile, build, test, or run the code.\n'
            '- Do NOT search for compilers, runtimes, or tools (go, node, python, etc.).\n'
            '- Do NOT install packages or dependencies.\n'
            '- Do NOT run any commands other than reading/editing files.\n'
            '- Stop immediately after editing and summarizing — do not do extra work.\n'
            '- If an IMPLEMENTATION PLAN is provided, follow it exactly — edit every file listed.\n\n'
            f'Task title: {task_title}\n'
            f'Task description:\n{task_description}\n'
        )

        # Create worktree so each task works on a clean main copy
        wt_path = self._create_worktree(repo_path, task_id)
        effective_path = wt_path or repo_path
        if wt_path and log_callback:
            await log_callback(f'Worktree created: {wt_path}')

        # Store worktree info so orchestration_service can find the right path
        self.last_worktree_path = wt_path
        self.last_effective_path = effective_path

        try:
            claude_bin = shutil.which('claude')
            if claude_bin:
                return await self._run_local(claude_bin, effective_path, prompt, model, log_callback)
            return await self._run_bridge(effective_path, prompt, model, log_callback)
        finally:
            # Keep worktree alive — orchestration_service collects changes via git diff
            # then calls cleanup_worktree() after PR creation
            pass

    def cleanup_worktree(self, repo_path: str) -> None:
        """Remove the last worktree after changes have been collected."""
        wt = getattr(self, 'last_worktree_path', None)
        if wt:
            self._remove_worktree(repo_path, wt)
            self.last_worktree_path = None

    async def _run_local(self, claude_bin: str, repo_path: str, prompt: str, model: str | None, log_callback: LogCallback | None = None) -> str:
        cmd = [claude_bin, '--print', '--dangerously-skip-permissions']
        if model:
            cmd.extend(['--model', model])
        cmd.extend(['--prompt', prompt])

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=repo_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        collected: list[str] = []
        line_buffer = ''
        log_line_count = 0

        async def _stream_stdout() -> None:
            nonlocal line_buffer, log_line_count
            assert proc.stdout
            while True:
                chunk = await proc.stdout.read(4096)
                if not chunk:
                    break
                text = chunk.decode('utf-8', errors='ignore')
                collected.append(text)
                if log_callback:
                    line_buffer += text
                    while '\n' in line_buffer:
                        line, line_buffer = line_buffer.split('\n', 1)
                        line = line.strip()
                        if not line:
                            continue
                        if log_line_count >= 200:
                            continue
                        preview = line[:300] + ('...' if len(line) > 300 else '')
                        await log_callback(f'CLI: {preview}')
                        log_line_count += 1

        try:
            await asyncio.wait_for(_stream_stdout(), timeout=self.EXEC_TIMEOUT_SEC)
            await proc.wait()
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError(f'claude timed out after {self.EXEC_TIMEOUT_SEC}s')

        if proc.returncode != 0:
            err = await proc.stderr.read() if proc.stderr else b''
            msg = err.decode('utf-8', errors='ignore').strip() or ''.join(collected).strip()
            raise RuntimeError(f'claude failed: {msg[:300]}')

        content = ''.join(collected).strip()
        if not content:
            raise RuntimeError('claude returned empty output')
        return content

    async def _run_bridge(self, repo_path: str, prompt: str, model: str | None, log_callback: LogCallback | None = None) -> str:
        import json as _json
        import httpx

        bridge_url = os.getenv('CLI_BRIDGE_URL', 'http://cli-bridge:9876')
        # Fail fast with a clear message when Claude CLI session is not authenticated.
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10, connect=5)) as client:
                health = await client.get(f'{bridge_url}/health')
                if health.status_code >= 400:
                    raise RuntimeError(f'CLI bridge health check failed ({health.status_code})')
                h = health.json() if health.content else {}
                if not bool((h or {}).get('claude', False)):
                    raise RuntimeError('Claude CLI not installed on host bridge')
                if not bool((h or {}).get('claude_auth', False)):
                    raise RuntimeError('Claude CLI not authenticated (claude_auth=false)')
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError(f'CLI bridge health check failed: {exc}')

        # Stream endpoint — real-time logs via SSE (bridge uses --output-format stream-json)
        try:
            collected_text: list[str] = []
            log_line_count = 0
            async with httpx.AsyncClient(timeout=httpx.Timeout(self.EXEC_TIMEOUT_SEC + 10, connect=10)) as client:
                async with client.stream(
                    'POST',
                    f'{bridge_url}/claude/stream',
                    json={
                        'repo_path': repo_path,
                        'prompt': prompt,
                        'model': model or '',
                        'timeout': self.EXEC_TIMEOUT_SEC,
                    },
                ) as resp:
                    error_msg = None
                    async for raw_line in resp.aiter_lines():
                        if not raw_line.startswith('data: '):
                            continue
                        try:
                            event = _json.loads(raw_line[6:])
                        except (ValueError, TypeError):
                            continue

                        etype = event.get('type', '')
                        if etype == 'text':
                            # Partial text delta from Claude
                            text = event.get('text', '')
                            if text:
                                collected_text.append(text)
                        elif etype == 'tool':
                            # Tool usage event — log it for live display
                            summary = event.get('summary', '')
                            if log_callback and summary and log_line_count < 200:
                                await log_callback(summary)
                                log_line_count += 1
                        elif etype == 'line':
                            # Fallback raw line
                            text = event.get('text', '')
                            if text:
                                collected_text.append(text + '\n')
                            if log_callback and log_line_count < 200 and text.strip():
                                preview = text[:300] + ('...' if len(text) > 300 else '')
                                await log_callback(f'CLI: {preview}')
                                log_line_count += 1
                        elif etype == 'result':
                            text = event.get('text', '')
                            if text:
                                # result contains the final assembled output — use it
                                # as primary content if we haven't collected much text
                                if not collected_text or sum(len(t) for t in collected_text) < len(text):
                                    collected_text.clear()
                                    collected_text.append(text)
                            if log_callback and text:
                                await log_callback(f'CLI result: {text[:200]}')
                        elif etype == 'event':
                            pass  # other lifecycle events
                        elif etype == 'stderr':
                            pass
                        elif etype == 'error':
                            error_msg = event.get('message', 'unknown error')
                        elif etype == 'done':
                            if event.get('code', 0) != 0 and not collected_text:
                                error_msg = error_msg or 'claude exited with non-zero code'

                    if error_msg and not collected_text:
                        raise RuntimeError(f'claude bridge error: {error_msg}')

            # Log summary of what was collected
            if log_callback:
                total_chars = sum(len(t) for t in collected_text)
                await log_callback(f'CLI completed: {total_chars} chars output')

            content = ''.join(collected_text).strip()
            if not content:
                raise RuntimeError('claude bridge returned empty output')
            return content

        except httpx.ConnectError:
            raise RuntimeError(f'CLI bridge unreachable at {bridge_url} — is the cli-bridge service running?')
        except httpx.TimeoutException:
            raise RuntimeError(f'CLI bridge request timed out after {self.EXEC_TIMEOUT_SEC}s')
        except RuntimeError:
            raise
        except (httpx.RequestError, Exception) as exc:
            raise RuntimeError(f'CLI bridge request failed: {exc}')
