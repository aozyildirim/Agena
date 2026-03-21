from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from pathlib import Path


class CodexCLIService:
    FALLBACK_MODEL = 'gpt-5'
    EXEC_TIMEOUT_SEC = 180

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
            raise RuntimeError(
                'Preferred agent is codex_cli but `codex` binary is not available in worker runtime. '
                'Install Codex CLI where worker runs or switch to an OpenAI provider.'
            )

        repo = Path(repo_path).expanduser().resolve()
        if not repo.exists() or not repo.is_dir():
            raise ValueError(f'Local repo path does not exist: {repo_path}')

        prompt = (
            'Implement the task and return ONLY markdown file blocks in this format:\n'
            '**File: relative/path.ext**\n'
            '```language\n'
            '...content...\n'
            '```\n\n'
            f'Task title: {task_title}\n'
            f'Task description:\n{task_description}\n'
        )

        with tempfile.NamedTemporaryFile(prefix='codex-last-', suffix='.txt', delete=False) as tmp:
            output_file = tmp.name

        requested_model = (model or '').strip() or None
        effective_model = self._normalize_model_for_chatgpt(requested_model)
        effective_api_key = api_key

        out, err, code = await self._run_codex_exec(
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
                out, err, code = await self._run_codex_exec(
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
                out, err, code = await self._run_codex_exec(
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

    def _is_unsupported_model_error(self, message: str) -> bool:
        lowered = message.lower()
        return 'is not supported when using codex with a chatgpt account' in lowered

    def _is_api_key_scope_error(self, message: str) -> bool:
        lowered = message.lower()
        return 'insufficient permissions for this operation' in lowered or 'missing scopes:' in lowered

    def _normalize_model_for_chatgpt(self, model: str | None) -> str | None:
        if not model:
            return model
        lowered = model.lower()
        # codex CLI with ChatGPT account does not support legacy OpenAI API model ids.
        if lowered in {'codex', 'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'}:
            return self.FALLBACK_MODEL
        return model
