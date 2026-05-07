"""MCP Agent Engine — tool-use based code generation.

Instead of the CrewAI pipeline (PM → Developer → Reviewer) that dumps the
entire repo into a single prompt, the MCP agent *interactively* explores
the codebase via tools, reads only what it needs, and writes targeted
changes — similar to how a human developer works with an IDE.

Usage::

    engine = MCPAgentEngine(provider='openai', api_key='...', model='gpt-4o')
    result = await engine.run(
        task_title='Add dark mode toggle',
        task_description='...',
        workspace_path='/repos/my-app',
    )
    file_changes = result['file_changes']  # [{path, content, is_new}]
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Callable, Awaitable

import httpx
from openai import AsyncOpenAI

from agena_agents.agents.tools.executor import TOOL_SCHEMAS, ToolExecutor
from agena_core.settings import get_settings

logger = logging.getLogger(__name__)

# ---- Defaults ----
MAX_ITERATIONS = 40
MAX_OUTPUT_TOKENS = 16_384
TOOL_RESULT_LIMIT = 10_000          # truncate tool results beyond this
CONTEXT_COMPRESS_THRESHOLD = 40_000  # compress old messages when total chars exceed this
COMPRESSED_TOOL_RESULT_LEN = 150     # keep this many chars from old tool results

DEFAULT_SYSTEM_PROMPT = """\
You are a senior software engineer.  You receive a task and must deliver \
production-ready code changes against a real codebase.  You have tools to \
explore, search, read, edit, and test the code.

Follow the five phases below **in order**.  Do not skip phases.

────────────────────────────────────────────
PHASE 1 · DISCOVER
────────────────────────────────────────────
Goal: Build a mental map of the project before touching anything.

1. list_directory (root, depth 2-3) — understand the project layout, \
   identify key directories (src/, lib/, tests/, etc.).
2. Look for configuration files that reveal conventions:
   - read_file: package.json, pyproject.toml, tsconfig.json, .eslintrc, \
     setup.cfg, Makefile, Dockerfile, or similar.
   - These tell you: language version, lint rules, test framework, build \
     tool, dependency list.
3. Look for a README.md, CONTRIBUTING.md, or agents.md — read them; they \
   often describe architecture and conventions.
4. Identify the test framework and how to run tests \
   (e.g. pytest, jest, vitest, go test).

After this phase you should know:
  → project language & framework
  → directory structure
  → how to run tests / lint
  → where the relevant code likely lives

────────────────────────────────────────────
PHASE 2 · UNDERSTAND
────────────────────────────────────────────
Goal: Read the specific files related to the task and understand the \
existing patterns deeply.

1. search_code for keywords from the task (function names, class names, \
   route paths, error messages, UI labels).  ALWAYS use the glob \
   parameter to filter by file extension (e.g. "*.go", "*.py", "*.ts") — \
   this dramatically improves search accuracy.  Run multiple searches \
   with different keywords if the first search returns no results.
2. read_file each relevant hit — read the FULL file, not just the match.
2b. Study the file tree carefully — identify ALL files that could be \
   related to the task based on their names and directory structure. \
   If a file's name strongly suggests it's relevant (e.g. "data.go" \
   for a data-related task), read it even if search didn't find it.
3. For every file you plan to change, also read:
   - Its imports → follow them one level deep to understand interfaces.
   - Its tests → know what is already tested.
   - Files that import IT → understand callers / dependents.
4. Pay close attention to:
   - Naming style (camelCase vs snake_case, prefixes, suffixes).
   - Import ordering (stdlib → third-party → local, grouped or flat).
   - Error handling pattern (exceptions, Result types, error codes).
   - Indentation (tabs vs spaces, 2 vs 4).
   - Existing patterns for the SAME kind of change (e.g. if adding a \
     new API route, read 2-3 existing routes to see the pattern).

After this phase you should know:
  → exactly which files need changes
  → the existing patterns to follow
  → what tests exist and what's missing

────────────────────────────────────────────
PHASE 3 · PLAN
────────────────────────────────────────────
Goal: Decide the precise set of changes BEFORE writing any code.

Think through (do NOT call any write tools yet):
1. List every file that needs to change and what the change is.
2. Order them: dependencies first, dependents after.
3. Consider edge cases the task description may not mention.
4. Decide whether each change is a surgical edit (edit_file) or a new \
   file / full rewrite (write_file).
5. If the task requires changes in multiple files, plan so that each \
   intermediate state still compiles / passes lint.

────────────────────────────────────────────
PHASE 4 · IMPLEMENT
────────────────────────────────────────────
Goal: Make the changes — precisely, following every convention.

Rules for writing code:
- **edit_file** for modifying existing files.  CRITICAL: the old_text \
  parameter must be copied EXACTLY from the read_file output — never \
  type it from memory or guess.  Include 3-5 lines of surrounding \
  context so the match is unique.  If edit_file fails because old_text \
  is not found, ALWAYS re-read the file first, then copy the exact \
  text from the fresh read output.  Never retry with the same old_text.
- For large changes (>50% of file), prefer **write_file** with the \
  complete new content — it is more reliable than multiple edit_file calls.
- **write_file** only for brand-new files or complete rewrites.
- Match the EXACT style of surrounding code:
  · Same indentation (if the file uses 2 spaces, you use 2 spaces).
  · Same quote style (single vs double).
  · Same trailing commas, semicolons, line endings.
  · Same comment style and density — if the file has no comments, \
    don't add any.  If it has JSDoc on every function, add JSDoc.
- Do NOT add comments like "// Added for task X" or "# MCP agent change".
- Do NOT add type annotations, docstrings, or comments to code you \
  did not write or change.
- Do NOT refactor, rename, or "improve" unrelated code.
- Do NOT import modules that are not already in the project's \
  dependencies unless the task specifically requires a new dependency.
- Write COMPLETE implementations — no "TODO", no "...", no "pass", \
  no placeholder functions.
- If adding to a list / enum / dict that has a specific order or \
  convention, follow it.
- If the project uses i18n, add strings to ALL locale files.

────────────────────────────────────────────
PHASE 5 · VERIFY
────────────────────────────────────────────
Goal: Confirm the changes work before finishing.

1. If you found the test command in Phase 1, run it:
   - run_command("pytest tests/ -x") or run_command("npm test") etc.
   - If tests fail, read the error, fix the code, re-run.
   - Iterate up to 3 times.  If still failing after 3 attempts, \
     call task_complete with a note about which tests fail and why.
2. If there is a linter, run it:
   - run_command("npm run lint") or run_command("flake8 src/") etc.
   - Fix lint errors before finishing.
3. If no test/lint commands are available, at minimum re-read your \
   changed files to visually verify correctness.
4. Call task_complete with a concise summary of:
   - What was changed and why.
   - Which files were modified / created.
   - Test results (pass / fail / not available).

────────────────────────────────────────────
CRITICAL RULES
────────────────────────────────────────────
- NEVER skip Phase 1 and Phase 2.  Reading code is cheaper than \
  writing wrong code.
- NEVER guess file paths or function signatures — always verify by \
  reading first.
- If a task is ambiguous, implement the most reasonable interpretation \
  and note your assumption in the task_complete summary.
- If you realize mid-implementation that the task requires changes \
  beyond your tools (e.g. database migrations, external service \
  configuration), implement what you can and document the remaining \
  manual steps in task_complete.
- You have a maximum number of tool calls.  Be efficient — don't \
  read the same file twice unless it was modified.
- You MUST produce code changes.  Do not just analyze — implement.  \
  If you have spent more than 10 tool calls reading without writing, \
  you are over-researching.  Start writing code.
- After reading 3-5 relevant files, you should have enough context \
  to begin implementation.  Do NOT read every file in the repo.
"""


class MCPAgentEngine:
    """Run a tool-use agent loop for code generation tasks."""

    # Provider → OpenAI-compatible base URL mapping
    _PROVIDER_BASE_URLS: dict[str, str] = {
        'openai': 'https://api.openai.com/v1',
        'gemini': 'https://generativelanguage.googleapis.com/v1beta/openai/',
        'google': 'https://generativelanguage.googleapis.com/v1beta/openai/',
        'anthropic': 'https://api.anthropic.com/v1/',
    }

    # Google OAuth2 token endpoint for refresh token → access token exchange
    _GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
    # Default client ID/secret for "Google Auth Library" (public, used by gcloud CLI)
    _GOOGLE_CLIENT_ID = '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com'
    _GOOGLE_CLIENT_SECRET = 'd-FL95Q19q7MQmFpd7hHD0Ty'

    @staticmethod
    def _exchange_google_refresh_token(refresh_token: str) -> str:
        """Exchange a Google OAuth2 refresh token for an access token."""
        import urllib.request
        import urllib.parse
        data = urllib.parse.urlencode({
            'grant_type': 'refresh_token',
            'refresh_token': refresh_token,
            'client_id': MCPAgentEngine._GOOGLE_CLIENT_ID,
            'client_secret': MCPAgentEngine._GOOGLE_CLIENT_SECRET,
        }).encode()
        req = urllib.request.Request(MCPAgentEngine._GOOGLE_TOKEN_URL, data=data,
                                     headers={'Content-Type': 'application/x-www-form-urlencoded'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            import json as _json
            body = _json.loads(resp.read())
            return body['access_token']

    def __init__(
        self,
        provider: str = 'openai',
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        *,
        vertex_project: str | None = None,
        vertex_region: str | None = None,
    ) -> None:
        settings = get_settings()
        self.provider = (provider or 'openai').strip().lower()
        self._is_vertex = False

        # Resolve API key per provider
        if self.provider in ('gemini', 'google'):
            self.api_key = (api_key or os.getenv('GEMINI_API_KEY', '') or settings.openai_api_key or '').strip()
        elif self.provider == 'anthropic':
            self.api_key = (api_key or os.getenv('ANTHROPIC_API_KEY', '') or '').strip()
        else:
            self.api_key = (api_key or settings.openai_api_key or '').strip()

        # Detect Vertex AI: refresh tokens start with common OAuth prefixes,
        # API keys start with AIza
        _is_refresh_token = (
            self.provider in ('gemini', 'google')
            and self.api_key
            and not self.api_key.startswith('AIza')
        )

        if _is_refresh_token:
            self._is_vertex = True
            # Exchange refresh token for access token
            try:
                access_token = self._exchange_google_refresh_token(self.api_key)
                logger.info('Vertex AI: exchanged refresh token for access token')
            except Exception as exc:
                logger.error('Failed to exchange Google refresh token: %s', exc)
                raise ValueError(
                    f'Google refresh token exchange failed: {exc}. '
                    'Ensure the token is valid or use an AIzaSy... API key instead.'
                ) from exc
            self.api_key = access_token
            # Vertex AI OpenAI-compat endpoint
            _region = (vertex_region or os.getenv('VERTEX_REGION', '') or 'us-central1').strip()
            _project = (vertex_project or os.getenv('VERTEX_PROJECT', '') or '').strip()
            if not _project:
                # Try to extract project from base_url if provided
                _bu = (base_url or '').strip()
                if 'projects/' in _bu:
                    _project = _bu.split('projects/')[1].split('/')[0]
            if not _project:
                raise ValueError(
                    'Vertex AI requires a Google Cloud Project ID. '
                    'Set it in the Gemini integration Base URL field as: '
                    'https://{region}-aiplatform.googleapis.com/v1beta1/projects/{PROJECT_ID}/locations/{region}/endpoints/openapi'
                )
            self.base_url = (
                f'https://{_region}-aiplatform.googleapis.com/v1beta1/'
                f'projects/{_project}/locations/{_region}/endpoints/openapi'
            )
        else:
            # Standard provider base URL resolution
            default_base = self._PROVIDER_BASE_URLS.get(self.provider, self._PROVIDER_BASE_URLS['openai'])
            self.base_url = (base_url or '').strip()
            if self.base_url and 'generativelanguage.googleapis.com' in self.base_url and '/openai' not in self.base_url:
                self.base_url = self._PROVIDER_BASE_URLS['gemini']
            if not self.base_url:
                self.base_url = default_base

        self.model = (model or settings.llm_large_model or 'gpt-4o').strip()

        _ssl_verify = os.getenv('SSL_VERIFY', 'true').strip().lower() not in ('false', '0', 'no')
        # All providers (including Gemini OpenAI-compat) use standard
        # Authorization: Bearer header — no special headers needed.
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            http_client=httpx.AsyncClient(verify=_ssl_verify),
        )
        logger.info('MCPAgentEngine initialized: provider=%s, model=%s, base_url=%s, vertex=%s',
                     self.provider, self.model, self.base_url, self._is_vertex)

    # ------------------------------------------------------------------ #
    #                         Public entry point                          #
    # ------------------------------------------------------------------ #

    async def run(
        self,
        task_title: str,
        task_description: str,
        workspace_path: str | None = None,
        *,
        executor: ToolExecutor | None = None,
        system_prompt: str | None = None,
        repo_context: str | None = None,
        playbook: str | None = None,
        allow_commands: bool = True,
        max_iterations: int = MAX_ITERATIONS,
        on_tool_call: Callable[..., Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        """Run the agent and return a state dict compatible with OrchestrationService.

        Either ``workspace_path`` (local) or ``executor`` (remote) must be
        provided.  For remote repos, pass a pre-built RemoteToolExecutor.

        Returns
        -------
        dict with keys:
            spec, generated_code, reviewed_code, final_code,
            usage, model_usage, file_changes, completion_summary,
            tool_calls_count, iterations
        """
        if executor is None:
            if workspace_path is None:
                raise ValueError('Either workspace_path or executor must be provided')
            executor = ToolExecutor(workspace_path=workspace_path, allow_commands=allow_commands)
        is_remote = not isinstance(executor, ToolExecutor)

        # ---- Tools: filter out run_command for remote repos ----
        tools = TOOL_SCHEMAS
        if is_remote:
            tools = [t for t in TOOL_SCHEMAS if t['function']['name'] != 'run_command']

        # ---- System prompt (includes static context to avoid repeating per iteration) ----
        sys_prompt = (system_prompt or DEFAULT_SYSTEM_PROMPT).strip()
        if playbook:
            sys_prompt += f'\n\n## Project Playbook\n\n{playbook}'
        if repo_context:
            # Put repo guide in system prompt — it's static, doesn't need to be
            # in user message where it gets re-sent every iteration
            sys_prompt += f'\n\n## Repository Guide\n\n{repo_context}'

        # ---- Pre-fetch file tree so agent doesn't waste a call on list_directory ----
        initial_context = ''
        if is_remote and hasattr(executor, '_file_tree') and executor._file_tree:
            initial_context = f'\n\n## File Tree (pre-loaded)\n\n{executor._file_tree}'
        elif not is_remote and workspace_path:
            # For local: quick tree via executor
            try:
                tree = executor.execute('list_directory', {'path': '', 'max_depth': 2})
                if tree and len(tree) < 8000:
                    initial_context = f'\n\n## File Tree (pre-loaded)\n\n{tree}'
            except Exception:
                pass

        # ---- User message (kept minimal — context is in system prompt) ----
        user_parts: list[str] = [f'# Task: {task_title}']
        if task_description:
            user_parts.append(f'\n## Description\n\n{task_description}')
        if initial_context:
            user_parts.append(initial_context)
        user_parts.append(
            '\n\nThe file tree is provided above. Start by reading the most '
            'relevant files, then implement the changes.'
        )
        user_message = '\n'.join(user_parts)

        messages: list[dict[str, Any]] = [
            {'role': 'system', 'content': sys_prompt},
            {'role': 'user', 'content': user_message},
        ]

        total_usage = {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0, 'cached_input_tokens': 0}
        tool_calls_count = 0
        iteration = 0
        started = time.perf_counter()

        # ---- Agent loop ----
        for iteration in range(1, max_iterations + 1):
            # Compress old tool results to save tokens
            self._compress_messages(messages)

            try:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    tools=tools,
                    tool_choice='auto' if not executor.is_completed else 'none',
                    max_tokens=MAX_OUTPUT_TOKENS,
                )
            except Exception as exc:
                logger.error('MCP agent LLM call failed (iter %d): %s %s', iteration, type(exc).__name__, exc)
                # Store error for completion summary
                if not executor.is_completed:
                    executor._completed = True
                    executor._completion_summary = f'LLM call failed: {type(exc).__name__}: {exc}'
                break

            # Accumulate usage. OpenAI's response model exposes
            # prompt_tokens / completion_tokens / total_tokens, but
            # the *Anthropic compat* endpoint returns input_tokens /
            # output_tokens / cache_read_input_tokens /
            # cache_creation_input_tokens via model_extra. When the
            # backing provider is Anthropic, prompt_tokens often comes
            # back as 0 and the standard fields miss the cached
            # context entirely — that's why a 6-min run logged ~900
            # tokens instead of ~50–500k. Fall back to the Anthropic
            # field names + cache totals so the run record reflects
            # what actually got billed.
            if response.usage:
                u = response.usage
                _prompt = u.prompt_tokens or 0
                _completion = u.completion_tokens or 0
                _total = u.total_tokens or 0
                _extra = getattr(u, 'model_extra', None) or {}
                if not _prompt and (_extra.get('input_tokens') is not None):
                    _prompt = int(_extra.get('input_tokens') or 0)
                if not _completion and (_extra.get('output_tokens') is not None):
                    _completion = int(_extra.get('output_tokens') or 0)
                # Fold cache_read + cache_creation into the prompt
                # bucket — they're real tokens the provider charged
                # for, even if discounted, and most cost dashboards
                # group them with input.
                _cache_read = int(_extra.get('cache_read_input_tokens') or 0)
                _cache_creation = int(_extra.get('cache_creation_input_tokens') or 0)
                _prompt += _cache_read + _cache_creation
                if not _total:
                    _total = _prompt + _completion
                total_usage['prompt_tokens'] += _prompt
                total_usage['completion_tokens'] += _completion
                total_usage['total_tokens'] += _total
                # cache_read is the only piece that gets the discount —
                # cache_creation is full-rate (we paid to populate it).
                total_usage['cached_input_tokens'] += _cache_read

            choice = response.choices[0]
            msg = choice.message

            # Append assistant turn
            messages.append(msg.model_dump(exclude_none=True))

            if not msg.tool_calls:
                # Agent is done or stopped generating
                if executor.is_completed or choice.finish_reason == 'stop':
                    break
                continue

            # Execute each tool call
            for tc in msg.tool_calls:
                tool_name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}

                tool_calls_count += 1
                logger.info('MCP tool call #%d: %s(%s)', tool_calls_count, tool_name,
                            json.dumps(args, ensure_ascii=False)[:200])

                # Remote executor is always async; local is async for run_command only
                if is_remote or tool_name == 'run_command':
                    result = await executor.execute_async(tool_name, args)
                else:
                    result = executor.execute(tool_name, args)

                # Truncate oversized output
                if len(result) > TOOL_RESULT_LIMIT:
                    result = result[:TOOL_RESULT_LIMIT] + '\n\n... (output truncated)'

                # Callback for logging
                if on_tool_call:
                    try:
                        await on_tool_call(tool_name, args, result)
                    except Exception:
                        pass

                messages.append({
                    'role': 'tool',
                    'tool_call_id': tc.id,
                    'content': result,
                })

                if executor.is_completed:
                    break

            if executor.is_completed:
                break

            # Nudge: push the agent to start writing if it's only been reading
            _has_writes = bool(executor.get_file_changes())
            if not _has_writes and not executor.is_completed:
                if iteration == int(max_iterations * 0.25):
                    messages.append({
                        'role': 'user',
                        'content': (
                            'You have read enough files to understand the codebase. '
                            'Stop exploring and START IMPLEMENTING NOW. Use edit_file '
                            'to modify existing files or write_file to create new ones. '
                            'Do not read any more files unless absolutely necessary.\n\n'
                            'IMPORTANT: Before calling edit_file, ALWAYS re-read the '
                            'exact section you want to change. Copy the old_text '
                            'EXACTLY from the read output — never type it from memory.'
                        ),
                    })
                elif iteration == int(max_iterations * 0.45):
                    messages.append({
                        'role': 'user',
                        'content': (
                            'WARNING: You are running out of iterations and have NOT '
                            'made any changes yet. You MUST call edit_file or write_file '
                            'RIGHT NOW. If the task is impossible, call task_complete '
                            'with an explanation. Do NOT continue reading files.'
                        ),
                    })
                elif iteration == max_iterations - 3:
                    messages.append({
                        'role': 'user',
                        'content': (
                            'FINAL WARNING: 3 iterations left. Call edit_file/write_file '
                            'immediately or call task_complete. No more exploration.'
                        ),
                    })

        elapsed = round(time.perf_counter() - started, 2)
        logger.info(
            'MCP agent finished: %d iterations, %d tool calls, %.1fs, %d tokens',
            iteration, tool_calls_count, elapsed, total_usage['total_tokens'],
        )

        # ---- Build output ----
        file_changes = executor.get_file_changes()
        logger.info('MCP agent file_changes: %d files, completed=%s, summary=%s',
                     len(file_changes), executor.is_completed,
                     (executor.completion_summary or '')[:200])
        for fc in file_changes:
            logger.info('  changed: %s (%d lines, is_new=%s)',
                         fc['path'], len(fc['content'].splitlines()), fc.get('is_new'))
        final_code = self._build_final_code(file_changes)

        return {
            'spec': {
                'goal': f'mcp_agent: {task_title}',
                'requirements': [],
                'acceptance_criteria': [],
            },
            'generated_code': final_code,
            'reviewed_code': final_code,
            'final_code': final_code,
            'usage': total_usage,
            'model_usage': [f'{self.provider}:{self.model}'],
            'file_changes': file_changes,
            'completion_summary': executor.completion_summary,
            'tool_calls_count': tool_calls_count,
            'iterations': iteration,
            'duration_sec': elapsed,
        }

    # ------------------------------------------------------------------ #
    #                         Helpers                                      #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _compress_messages(messages: list[dict[str, Any]]) -> None:
        """Shrink old tool-result messages to save context tokens.

        Strategy: keep the last 6 messages intact (agent needs recent context).
        For older tool-result messages, replace the full content with a short
        summary (first ~200 chars).  System and user messages are never touched.

        This reduces repeated token cost from O(iterations²) to roughly
        O(iterations).
        """
        total_chars = sum(len(str(m.get('content', ''))) for m in messages)
        if total_chars < CONTEXT_COMPRESS_THRESHOLD:
            return

        # Keep system(0), user(1), and last 6 messages untouched
        protect_tail = 6
        compressible_end = max(2, len(messages) - protect_tail)

        for i in range(2, compressible_end):
            m = messages[i]
            if m.get('role') != 'tool':
                continue
            content = m.get('content', '')
            if len(content) <= COMPRESSED_TOOL_RESULT_LEN + 50:
                continue  # already short
            # Build a short summary: first N chars + truncation notice
            short = content[:COMPRESSED_TOOL_RESULT_LEN].rstrip()
            m['content'] = short + '\n\n... [compressed — full output was read earlier]'

    @staticmethod
    def _build_final_code(file_changes: list[dict[str, Any]]) -> str:
        """Format file changes into the **File: path** format expected by
        ``_build_pr_payload`` in OrchestrationService."""
        parts: list[str] = []
        for fc in file_changes:
            ext = fc['path'].rsplit('.', 1)[-1] if '.' in fc['path'] else ''
            parts.append(f'**File: {fc["path"]}**')
            parts.append(f'```{ext}')
            parts.append(fc['content'])
            parts.append('```')
            parts.append('')
        return '\n'.join(parts)
