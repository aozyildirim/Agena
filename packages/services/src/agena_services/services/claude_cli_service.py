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


def _read_timeout_env(default: int = 3600) -> int:
    raw = (os.getenv('AGENA_CLI_TIMEOUT_SEC') or '').strip()
    if not raw:
        return default
    try:
        v = int(raw)
        return v if v > 0 else default
    except ValueError:
        return default


class ClaudeCLIService:
    # 60 min default. Long CRUD-style tasks (state machine + form +
    # menu + notifications across many files) routinely need more than
    # 30 min — task 92 burned 20+ min in research alone before writing a
    # line. Override via AGENA_CLI_TIMEOUT_SEC for shorter caps.
    EXEC_TIMEOUT_SEC = _read_timeout_env(3600)

    # ── Worktree helpers ─────────────────────────────────────────────────
    @staticmethod
    def _create_worktree(
        repo_path: str,
        task_id: str = '',
        *,
        base_ref: str | None = None,
    ) -> str | None:
        """Create a git worktree so each task works on a clean copy.

        `base_ref` controls which ref the worktree branches from:
          - None   → origin/HEAD (main / master). Default for fresh runs.
          - <name> → origin/<name>. Used by the /tasks/{id}/revise flow
                     so the worker re-checks-out the existing feature
                     branch and pushes an additional commit, instead of
                     starting from main and producing a NEW branch.
        """
        repo = Path(repo_path).expanduser().resolve()
        if not (repo / '.git').exists():
            return None
        wt_name = f'.worktree-agena-{task_id or uuid.uuid4().hex[:8]}'
        wt_path = repo.parent / wt_name
        if wt_path.exists():
            # Reuse existing worktree
            return str(wt_path)
        try:
            if base_ref:
                # Revision flow: pull the latest copy of the existing
                # feature branch before basing the worktree on it so we
                # don't push stale tips and trigger force-push surprises.
                subprocess.run(
                    ['git', 'fetch', 'origin', base_ref],
                    cwd=str(repo), capture_output=True, text=True, timeout=30,
                )
                subprocess.run(
                    ['git', 'worktree', 'add', str(wt_path), f'origin/{base_ref}'],
                    cwd=str(repo), capture_output=True, text=True, timeout=30,
                    check=True,
                )
            else:
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
        base_ref: str | None = None,
        candidate_files: list[str] | None = None,
    ) -> str:
        candidate_section = ''
        if candidate_files:
            bullets = '\n'.join(f'- {p}' for p in candidate_files[:10])
            candidate_section = (
                '\nCANDIDATE FILES (semantic match on this task — start by Reading these, '
                'do NOT grep the whole repo first):\n'
                f'{bullets}\n'
                'If none of these turn out to be relevant after a quick Read, then you may '
                'fall back to a narrow Grep — but stay within the 5-read HARD LIMIT below.\n'
            )

        prompt = (
            'Implement the following task in the CURRENT repository.\n\n'
            'WORKFLOW:\n'
            '1. If the task includes ATTACHMENTS / SCREENSHOTS, Read each one FIRST — they are the design spec.\n'
            '2. Skim 1–3 existing files in the repo that already solve a similar problem (the task usually names a reference module). Treat THEM as the source of truth, not the framework internals.\n'
            '3. Use the Edit or Write tools to make changes directly in the repo.\n'
            '4. Cover every Acceptance Criterion the task lists. Partial implementation is a failure.\n'
            '5. After all edits are done, output a short summary listing every file you changed.\n\n'
            'RULES:\n'
            '- Actually edit the files using tools — do NOT just output code blocks.\n'
            '- CRITICAL — PRESERVE EXISTING CONTENT: For any file that already exists, ALWAYS Read it first, then use Edit (or MultiEdit) to make targeted changes. NEVER use Write to overwrite an existing file unless the task explicitly asks you to delete and recreate it. Migration files, list-style files (Upgrade.php, schema dump, route registries, enum lists, changelogs) are APPEND-ONLY by default — add your new entry to the end, do not touch existing entries.\n'
            '- If you find yourself about to call Write on an existing file, STOP and switch to Edit. Write replaces the entire file content; Edit keeps everything around your patch intact.\n'
            '- Implement EVERY part the task asks for: schema, controllers, views, state machines, menu entries, validations, notifications — whatever the task and Acceptance Criteria require.\n'
            '- Do not invent extra unrelated work. The bar is "complete the task as specified", not "as little as possible" and not "rewrite the codebase".\n'
            '- STAY OUT OF vendor/, node_modules/, dist/, build/, .venv/, framework internals. Reading framework source is almost never necessary — if the task description or a similar existing module already shows the pattern, USE that pattern instead of grepping for how the framework resolves it under the hood. Budget at most 1 vendor read in the entire run, and only when an existing repo example does not answer the question.\n'
            '- Prefer the reference module called out in the task (e.g. "use travel_requests as the reference") over searching the whole repo.\n'
            '- HARD LIMIT — token budget: at most 5 read/grep/find/glob calls TOTAL before your first Edit/Write. If you hit that ceiling without a target file picked, stop exploring and pick the closest reference you have already seen. Token cost grows linearly with discovery turns; the ceiling is firm, not advisory.\n'
            '- After you start editing, keep reads strictly to "open the file you are about to Edit". Re-reads of already-seen files for context are wasted tokens.\n'
            '- If a file is large, read it first, then make targeted edits.\n'
            '- Do NOT try to compile, build, test, or run the code.\n'
            '- Do NOT search for compilers, runtimes, or tools (go, node, python, etc.).\n'
            '- Do NOT install packages or dependencies.\n'
            '- Do NOT run any commands other than reading/editing files (or short read-only shell commands needed to find existing patterns).\n'
            '- Stop only after every acceptance criterion is implemented and you have summarized.\n'
            '- If an IMPLEMENTATION PLAN is provided, follow it exactly — edit every file listed.\n\n'
            f'Task title: {task_title}\n'
            f'Task description:\n{task_description}\n'
            f'{candidate_section}'
        )

        # Create worktree so each task works on a clean copy. For
        # revision runs `base_ref` is the existing feature branch so
        # we land an additional commit on the same PR instead of
        # branching from main again.
        wt_path = self._create_worktree(repo_path, task_id, base_ref=base_ref)
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
            return await self._run_bridge(effective_path, prompt, model, log_callback, task_id=task_id)
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

    async def _run_bridge(self, repo_path: str, prompt: str, model: str | None, log_callback: LogCallback | None = None, task_id: str = '') -> str:
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
            # Bridge forwards Claude's final result event with real
            # input/output/cache token counts. We stash it on `self`
            # so the orchestration layer can pull it off after
            # generate_file_markdown returns and store accurate
            # usage on the run record (instead of the old len/4 estimate).
            self.last_usage: dict | None = None
            self.last_cost_usd: float | None = None
            self.last_num_turns: int | None = None
            self.last_duration_ms: int | None = None
            async with httpx.AsyncClient(timeout=httpx.Timeout(self.EXEC_TIMEOUT_SEC + 10, connect=10)) as client:
                async with client.stream(
                    'POST',
                    f'{bridge_url}/claude/stream',
                    json={
                        'repo_path': repo_path,
                        'prompt': prompt,
                        'model': model or '',
                        'timeout': self.EXEC_TIMEOUT_SEC,
                        'task_id': task_id,
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
                            # Capture real usage / cost / turns from
                            # Claude's final result event (bridge
                            # forwards them since the JSON-output patch).
                            usage_blob = event.get('usage')
                            if isinstance(usage_blob, dict):
                                self.last_usage = usage_blob
                            cost = event.get('cost_usd')
                            if isinstance(cost, (int, float)):
                                self.last_cost_usd = float(cost)
                            num_turns = event.get('num_turns')
                            if isinstance(num_turns, int):
                                self.last_num_turns = num_turns
                            dur_ms = event.get('duration_ms')
                            if isinstance(dur_ms, int):
                                self.last_duration_ms = dur_ms
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
            if 'Failed to authenticate' in content and 'API Error: 401' in content:
                raise RuntimeError('Claude CLI authentication failed (401). Reconnect Claude from Integrations and try again.')
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

    async def generate_text(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        model: str | None = None,
        timeout_sec: int = 120,
    ) -> str:
        """Lightweight text-in / text-out wrapper around the CLI bridge.

        Intended for short one-shot generations (e.g. a nudge comment) —
        does NOT touch a repo, does NOT create a worktree, and short-circuits
        on the first `result` frame the bridge emits. Uses the bridge's
        /claude/stream endpoint with /tmp as a harmless working dir.
        """
        import json as _json
        import httpx

        bridge_url = os.getenv('CLI_BRIDGE_URL', 'http://cli-bridge:9876')
        async with httpx.AsyncClient(timeout=httpx.Timeout(10, connect=5)) as client:
            try:
                health = await client.get(f'{bridge_url}/health')
            except Exception as exc:
                raise RuntimeError(f'CLI bridge unreachable: {exc}')
            if health.status_code >= 400:
                raise RuntimeError(f'CLI bridge health check failed ({health.status_code})')
            h = health.json() if health.content else {}
            if not bool((h or {}).get('claude', False)):
                raise RuntimeError('Claude CLI is not installed on the host bridge')
            if not bool((h or {}).get('claude_auth', False)):
                raise RuntimeError('Claude CLI is not authenticated on the host bridge')

        # Compose prompt (Claude CLI has no system/user split on the CLI
        # side — merge into one instruction block).
        full_prompt = (
            f'{system_prompt.strip()}\n\n---\n{user_prompt.strip()}\n\n'
            'Respond with ONLY the comment text. No preamble, no code blocks, no markdown — plain text only.'
        )

        collected: list[str] = []
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_sec + 10, connect=10)) as client:
            async with client.stream(
                'POST',
                f'{bridge_url}/claude/stream',
                json={
                    'repo_path': '/tmp',
                    'prompt': full_prompt,
                    'model': model or 'sonnet',
                    'timeout': timeout_sec,
                    'task_id': '',
                },
            ) as resp:
                async for raw in resp.aiter_lines():
                    if not raw.startswith('data: '):
                        continue
                    try:
                        event = _json.loads(raw[6:])
                    except (ValueError, TypeError):
                        continue
                    etype = event.get('type', '')
                    if etype == 'text':
                        txt = event.get('text', '')
                        if txt:
                            collected.append(txt)
                    elif etype == 'result':
                        txt = event.get('text', '')
                        if txt:
                            collected.clear()
                            collected.append(txt)
        out = ''.join(collected).strip()
        if not out:
            raise RuntimeError('Claude CLI returned empty output')
        return out
