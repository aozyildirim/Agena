"""Claude CLI service — runs Claude Code via CLI bridge or local binary."""
from __future__ import annotations

import asyncio
import os
import shutil
from pathlib import Path
from typing import Awaitable, Callable


LogCallback = Callable[[str], Awaitable[None]]


class ClaudeCLIService:
    EXEC_TIMEOUT_SEC = 600

    async def generate_file_markdown(
        self,
        *,
        repo_path: str,
        task_title: str,
        task_description: str,
        model: str | None = None,
        log_callback: LogCallback | None = None,
    ) -> str:
        prompt = (
            'Implement the task in the CURRENT repository and return ONLY markdown file blocks:\n'
            '**File: relative/path.ext**\n'
            '```language\n...content...\n```\n\n'
            'Rules:\n'
            '- Use repository-relative file paths only.\n'
            '- Prefer editing existing files.\n'
            '- Keep changes minimal.\n'
            '- Do not output explanations, only file blocks.\n\n'
            f'Task title: {task_title}\n'
            f'Task description:\n{task_description}\n'
        )

        claude_bin = shutil.which('claude')
        if claude_bin:
            return await self._run_local(claude_bin, repo_path, prompt, model, log_callback)
        return await self._run_bridge(repo_path, prompt, model, log_callback)

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
                        if line and log_line_count < 50:
                            preview = line[:200] + ('...' if len(line) > 200 else '')
                            if line.startswith('**File:') or line.startswith('```'):
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
        import httpx

        bridge_url = os.getenv('CLI_BRIDGE_URL', 'http://cli-bridge:9876')
        async with httpx.AsyncClient(timeout=self.EXEC_TIMEOUT_SEC + 10) as client:
            resp = await client.post(
                f'{bridge_url}/claude',
                json={
                    'repo_path': repo_path,
                    'prompt': prompt,
                    'model': model or '',
                    'timeout': self.EXEC_TIMEOUT_SEC,
                },
            )
            data = resp.json()

        if data.get('status') != 'ok':
            raise RuntimeError(f'claude bridge error: {data.get("message", data.get("stderr", "unknown"))}')

        content = (data.get('stdout') or '').strip()
        if not content:
            raise RuntimeError('claude bridge returned empty output')
        return content
