"""Claude CLI service — runs Claude Code via CLI bridge or local binary."""
from __future__ import annotations

import asyncio
import os
import shutil
from pathlib import Path


class ClaudeCLIService:
    EXEC_TIMEOUT_SEC = 300

    async def generate_file_markdown(
        self,
        *,
        repo_path: str,
        task_title: str,
        task_description: str,
        model: str | None = None,
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
            return await self._run_local(claude_bin, repo_path, prompt, model)
        return await self._run_bridge(repo_path, prompt, model)

    async def _run_local(self, claude_bin: str, repo_path: str, prompt: str, model: str | None) -> str:
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
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=self.EXEC_TIMEOUT_SEC)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError(f'claude timed out after {self.EXEC_TIMEOUT_SEC}s')

        if proc.returncode != 0:
            msg = err.decode('utf-8', errors='ignore').strip() or out.decode('utf-8', errors='ignore').strip()
            raise RuntimeError(f'claude failed: {msg[:300]}')

        content = out.decode('utf-8', errors='ignore').strip()
        if not content:
            raise RuntimeError('claude returned empty output')
        return content

    async def _run_bridge(self, repo_path: str, prompt: str, model: str | None) -> str:
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
