from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from pathlib import Path


class CodexCLIService:
    FALLBACK_MODEL = 'gpt-4o'
    EXEC_TIMEOUT_SEC = 180
    TRANSIENT_RETRIES = 3

    async def generate_file_markdown(
        self,
        *,
        repo_path: str,
        task_title: str,
        task_description: str,
        model: str | None = None,
        api_key: str | None = None,
        api_base_url: str | None = None,
    ) -> str:
        codex_bin = shutil.which('codex')
        if not codex_bin:
            # Try CLI bridge on host
            return await self._generate_via_bridge(
                cli='codex',
                repo_path=repo_path,
                task_title=task_title,
                task_description=task_description,
                model=model,
                api_key=api_key,
                api_base_url=api_base_url,
            )

        repo = Path(repo_path).expanduser().resolve()
        if not repo.exists() or not repo.is_dir():
            raise ValueError(f'Local repo path does not exist: {repo_path}')

        prompt = (
            'Implement the task in the CURRENT repository and return ONLY markdown file blocks in this format:\n'
            '**File: relative/path.ext**\n'
            '```language\n'
            '...content...\n'
            '```\n\n'
            'Hard rules:\n'
            '- Use ONLY repository-relative file paths (never absolute paths like /Users/... or C:\\...).\n'
            '- Prefer editing existing files; do not invent a new framework/stack unless task explicitly requires it.\n'
            '- Keep changes minimal and directly tied to the task title/description.\n'
            '- Do not output explanations, only file blocks.\n\n'
            f'Task title: {task_title}\n'
            f'Task description:\n{task_description}\n'
        )

        with tempfile.NamedTemporaryFile(prefix='codex-last-', suffix='.txt', delete=False) as tmp:
            output_file = tmp.name

        requested_model = (model or '').strip() or None
        effective_model = self._normalize_model_for_chatgpt(requested_model)
        effective_api_key = api_key

        out, err, code = await self._run_codex_with_retry(
            codex_bin=codex_bin,
            repo=str(repo),
            model=effective_model,
            prompt=prompt,
            output_file=output_file,
            api_key=effective_api_key,
            api_base_url=api_base_url,
        )
        if code != 0:
            msg = (err.decode('utf-8', errors='ignore') or out.decode('utf-8', errors='ignore')).strip()
            if effective_api_key and self._is_api_key_scope_error(msg):
                effective_api_key = None
                out, err, code = await self._run_codex_with_retry(
                    codex_bin=codex_bin,
                    repo=str(repo),
                    model=effective_model,
                    prompt=prompt,
                    output_file=output_file,
                    api_key=effective_api_key,
                    api_base_url=api_base_url,
                )
                if code != 0:
                    msg = (err.decode('utf-8', errors='ignore') or out.decode('utf-8', errors='ignore')).strip()
            if code != 0 and self._is_unsupported_model_error(msg) and effective_model != self.FALLBACK_MODEL:
                out, err, code = await self._run_codex_with_retry(
                    codex_bin=codex_bin,
                    repo=str(repo),
                    model=self.FALLBACK_MODEL,
                    prompt=prompt,
                    output_file=output_file,
                    api_key=effective_api_key,
                    api_base_url=api_base_url,
                )
                if code != 0:
                    msg = (err.decode('utf-8', errors='ignore') or out.decode('utf-8', errors='ignore')).strip()
            if code != 0:
                raise RuntimeError(f'codex exec failed: {msg}')

        content = Path(output_file).read_text(encoding='utf-8').strip()
        if not content:
            raise RuntimeError('codex exec finished but returned empty output')
        return content

    async def _run_codex_exec(
        self,
        *,
        codex_bin: str,
        repo: str,
        model: str | None,
        prompt: str,
        output_file: str,
        api_key: str | None,
        api_base_url: str | None,
    ) -> tuple[bytes, bytes, int]:
        cmd = [codex_bin, 'exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-C', repo]
        if model:
            cmd.extend(['-m', model])
        cmd.extend(['-o', output_file, prompt])

        env = dict(os.environ)
        if api_key:
            env['OPENAI_API_KEY'] = api_key
        else:
            env.pop('OPENAI_API_KEY', None)
        if api_base_url:
            env['OPENAI_BASE_URL'] = api_base_url
            env['OPENAI_API_BASE'] = api_base_url
        else:
            env.pop('OPENAI_BASE_URL', None)
            env.pop('OPENAI_API_BASE', None)

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=self.EXEC_TIMEOUT_SEC)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError(f'codex exec timed out after {self.EXEC_TIMEOUT_SEC}s')
        return out, err, int(proc.returncode or 0)

    async def _run_codex_with_retry(
        self,
        *,
        codex_bin: str,
        repo: str,
        model: str | None,
        prompt: str,
        output_file: str,
        api_key: str | None,
        api_base_url: str | None,
    ) -> tuple[bytes, bytes, int]:
        last: tuple[bytes, bytes, int] | None = None
        for attempt in range(1, self.TRANSIENT_RETRIES + 1):
            out, err, code = await self._run_codex_exec(
                codex_bin=codex_bin,
                repo=repo,
                model=model,
                prompt=prompt,
                output_file=output_file,
                api_key=api_key,
                api_base_url=api_base_url,
            )
            last = (out, err, code)
            if code == 0:
                return last
            msg = (err.decode('utf-8', errors='ignore') or out.decode('utf-8', errors='ignore')).strip()
            if not self._is_transient_error(msg) or attempt >= self.TRANSIENT_RETRIES:
                return last
            await asyncio.sleep(min(2 ** (attempt - 1), 4))
        return last or (b'', b'', 1)

    def _is_unsupported_model_error(self, message: str) -> bool:
        lowered = message.lower()
        return 'is not supported when using codex with a chatgpt account' in lowered

    def _is_api_key_scope_error(self, message: str) -> bool:
        lowered = message.lower()
        return 'insufficient permissions for this operation' in lowered or 'missing scopes:' in lowered

    def _normalize_model_for_chatgpt(self, model: str | None) -> str | None:
        """Normalize model name for Codex CLI ChatGPT login mode.

        ChatGPT login mode only supports specific model slugs.
        Unknown or invalid names fall back to a safe default.
        """
        if not model:
            return None
        lowered = model.strip().lower()
        # Valid models for Codex CLI ChatGPT login mode
        VALID = {'gpt-4o', 'gpt-4o-mini', 'o1', 'o3', 'o3-mini', 'o4-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-5.1-codex-mini'}
        if lowered in VALID:
            return model.strip()
        # Anything else (gpt-5.4-mini, werdsfsdf, etc.) → safe fallback
        return self.FALLBACK_MODEL

    def _is_transient_error(self, message: str) -> bool:
        lowered = message.lower()
        return (
            '500 internal server error' in lowered
            or "currently experiencing high demand" in lowered
            or 'timed out' in lowered
            or 'failed to connect to websocket' in lowered
            or '401 unauthorized' in lowered
            or 'reconnecting' in lowered
        )

    async def _generate_via_bridge(
        self,
        cli: str,
        repo_path: str,
        task_title: str,
        task_description: str,
        model: str | None = None,
        api_key: str | None = None,
        api_base_url: str | None = None,
    ) -> str:
        """Call CLI bridge HTTP server running on host."""
        import httpx

        bridge_url = os.getenv('CLI_BRIDGE_URL', 'http://cli-bridge:9876')
        prompt = (
            'Implement the task in the CURRENT repository and return ONLY markdown file blocks in this format:\n'
            '**File: relative/path.ext**\n'
            '```language\n'
            '...content...\n'
            '```\n\n'
            'Hard rules:\n'
            '- Use ONLY repository-relative file paths.\n'
            '- Prefer editing existing files.\n'
            '- Keep changes minimal.\n'
            '- Do not output explanations, only file blocks.\n\n'
            f'Task title: {task_title}\n'
            f'Task description:\n{task_description}\n'
        )

        payload: dict = {
            'repo_path': repo_path,
            'prompt': prompt,
            'model': model or '',
            'timeout': self.EXEC_TIMEOUT_SEC,
        }
        if api_key:
            payload['api_key'] = api_key
        if api_base_url:
            payload['api_base_url'] = api_base_url

        try:
            async with httpx.AsyncClient(timeout=300) as client:
                resp = await client.post(f'{bridge_url}/{cli}', json=payload)
                data = resp.json()
        except httpx.ConnectError:
            raise RuntimeError(f'CLI bridge unreachable at {bridge_url} — is the cli-bridge service running?')
        except httpx.TimeoutException:
            raise RuntimeError(f'CLI bridge request timed out after {self.EXEC_TIMEOUT_SEC}s')
        except (httpx.RequestError, ValueError) as exc:
            raise RuntimeError(f'CLI bridge request failed: {exc}')

        if data.get('status') != 'ok':
            raise RuntimeError(f'{cli} bridge error: {data.get("message", data.get("stderr", "unknown"))}')

        content = (data.get('stdout') or '').strip()
        if not content:
            raise RuntimeError(f'{cli} bridge returned empty output')
        return content
