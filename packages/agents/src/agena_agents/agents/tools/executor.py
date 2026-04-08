"""Tool definitions and executor for MCP agent mode.

The ToolExecutor provides a virtual filesystem overlay on top of a real
workspace directory.  Reads go through to disk; writes are captured in
memory so the original repo is never mutated.  After the agent finishes,
call ``get_file_changes()`` to retrieve the precise set of modifications
for PR creation.
"""

from __future__ import annotations

import asyncio
import fnmatch
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ---- Limits ----
MAX_READ_SIZE = 500_000       # 500 KB per file
MAX_SEARCH_RESULTS = 50
MAX_DIR_ENTRIES = 500
DEFAULT_CMD_TIMEOUT = 60      # seconds
MAX_CMD_TIMEOUT = 300         # seconds

BLOCKED_COMMANDS = frozenset({
    'rm -rf /', 'rm -rf /*', 'mkfs', 'dd if=/dev/zero',
    'chmod -R 777 /', ':(){:|:&};:',
})

# ---- OpenAI function-calling tool schemas ----

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        'type': 'function',
        'function': {
            'name': 'read_file',
            'description': (
                'Read a file and return its contents with line numbers.  '
                'ALWAYS read a file before editing it — never guess content.  '
                'Use start_line/end_line for large files (>500 lines): '
                'first read without range to see total lines, then read '
                'specific sections.  Returns format: "line_number\\tcontent".'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'path': {'type': 'string', 'description': 'File path relative to repo root (e.g. "src/auth/login.py")'},
                    'start_line': {'type': 'integer', 'description': 'First line to read (1-based).  Omit to start from beginning.'},
                    'end_line': {'type': 'integer', 'description': 'Last line to read (1-based).  Omit to read to end.'},
                },
                'required': ['path'],
                'additionalProperties': False,
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'list_directory',
            'description': (
                'Show the file/directory tree.  Use this FIRST to understand '
                'project layout.  Start with the root (path="") at depth 2-3, '
                'then drill into specific directories.  Skips node_modules, '
                '.git, __pycache__, dist, build automatically.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'path': {'type': 'string', 'description': 'Directory path relative to repo root.  Empty string = repo root.'},
                    'max_depth': {'type': 'integer', 'description': 'How deep to traverse (default: 3).  Use 1-2 for broad overview, 4+ for deep dive.'},
                },
                'required': [],
                'additionalProperties': False,
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'search_code',
            'description': (
                'Search for a regex pattern across ALL source files.  Use to '
                'find: function/class definitions, import usages, string '
                'literals, route paths, error messages, variable names.  '
                'Returns "filepath:line_number: matching_line".  '
                'Tips: use glob to narrow scope (e.g. "*.py"), use simple '
                'patterns first (literal strings), use regex only when needed.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'pattern': {'type': 'string', 'description': 'Regex pattern.  For literal search, escape special chars.  Case-insensitive.'},
                    'glob': {'type': 'string', 'description': "Filter by filename pattern: '*.py', '*.ts', '*.tsx', 'tests/**/*.py', etc."},
                    'max_results': {'type': 'integer', 'description': 'Max matches to return (default: 30, max: 50).  Use lower values for broad patterns.'},
                },
                'required': ['pattern'],
                'additionalProperties': False,
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'write_file',
            'description': (
                'Create a NEW file or COMPLETELY REPLACE an existing file.  '
                'Only use for: (1) brand new files, (2) complete rewrites '
                'where >50%% of the file changes.  For small edits to '
                'existing files, use edit_file instead — it is more precise '
                'and less error-prone.  Content must be the COMPLETE file.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'path': {'type': 'string', 'description': 'File path relative to repo root.  Parent directories are created automatically.'},
                    'content': {'type': 'string', 'description': 'The COMPLETE file content to write.  Must include all imports, all functions, everything.'},
                },
                'required': ['path', 'content'],
                'additionalProperties': False,
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'edit_file',
            'description': (
                'Make a TARGETED edit in an existing file by replacing text.  '
                'Preferred over write_file for modifying existing files.  '
                'old_text must match EXACTLY (whitespace, indentation, etc.).  '
                'Include 2-5 lines of surrounding context to ensure a unique '
                'match.  If the tool reports "not found", re-read the file — '
                'the content may differ from what you expect.  For multiple '
                'edits in one file, call edit_file multiple times.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'path': {'type': 'string', 'description': 'File path relative to repo root.  Must be an existing file.'},
                    'old_text': {'type': 'string', 'description': 'Exact text to find.  Include enough context (2-5 surrounding lines) for a unique match.'},
                    'new_text': {'type': 'string', 'description': 'Replacement text.  Must maintain the same indentation style as the original.'},
                },
                'required': ['path', 'old_text', 'new_text'],
                'additionalProperties': False,
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'run_command',
            'description': (
                'Execute a shell command in the repo directory.  Use for: '
                '(1) running tests — pytest, jest, go test, etc.  '
                '(2) linting — eslint, flake8, ruff, etc.  '
                '(3) type-checking — tsc --noEmit, mypy, etc.  '
                '(4) building — npm run build, make, etc.  '
                '(5) checking dependencies — pip list, npm ls, etc.  '
                'Output is truncated to last 5KB.  If a test fails, read '
                'the error carefully and fix the code before retrying.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'command': {'type': 'string', 'description': 'Shell command to run (e.g. "pytest tests/ -x --tb=short", "npm test", "npm run lint")'},
                    'timeout': {'type': 'integer', 'description': 'Timeout in seconds (default: 60, max: 300).  Use longer for builds/full test suites.'},
                },
                'required': ['command'],
                'additionalProperties': False,
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'task_complete',
            'description': (
                'Signal that you are DONE.  Call this after ALL changes are '
                'implemented and verified.  Include a clear summary of what '
                'was changed, which files were modified/created, and test '
                'results.  If something could not be completed, explain why '
                'and what manual steps remain.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'summary': {
                        'type': 'string',
                        'description': (
                            'Summary of changes: what was done, which files '
                            'changed, test results, any notes for the reviewer.'
                        ),
                    },
                },
                'required': ['summary'],
                'additionalProperties': False,
            },
        },
    },
]


class ToolExecutor:
    """Execute MCP agent tools against a local workspace.

    File writes are captured in a virtual overlay — the actual repo
    files are **never** modified.  After the agent finishes, call
    :meth:`get_file_changes` to retrieve all modifications.
    """

    SKIP_DIRS = frozenset({
        '.git', 'node_modules', '__pycache__', '.next', 'dist', 'build',
        '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache',
        '.eggs', '*.egg-info',
    })

    def __init__(
        self,
        workspace_path: str,
        allow_commands: bool = True,
    ) -> None:
        self.workspace = Path(workspace_path).resolve()
        self.allow_commands = allow_commands
        # Virtual overlay
        self._writes: dict[str, str] = {}              # rel → new content
        self._originals: dict[str, str | None] = {}    # rel → original (None = new file)
        self._read_count: dict[str, int] = {}          # rel → read count (dedup tracker)
        self._completed = False
        self._completion_summary = ''

    # ---- Public API ----

    @property
    def is_completed(self) -> bool:
        return self._completed

    @property
    def completion_summary(self) -> str:
        return self._completion_summary

    def execute(self, tool_name: str, arguments: dict[str, Any]) -> str:
        """Execute a tool synchronously and return the result string."""
        handler = getattr(self, f'_tool_{tool_name}', None)
        if handler is None:
            return f'Error: Unknown tool "{tool_name}"'
        try:
            return handler(**arguments)
        except Exception as exc:
            logger.warning('Tool %s failed: %s', tool_name, exc)
            return f'Error: {type(exc).__name__}: {exc}'

    async def execute_async(self, tool_name: str, arguments: dict[str, Any]) -> str:
        """Execute a tool, using async for run_command."""
        if tool_name == 'run_command':
            return await self._tool_run_command_async(**arguments)
        return self.execute(tool_name, arguments)

    def get_file_changes(self) -> list[dict[str, Any]]:
        """Return ``[{path, content, is_new}, ...]`` for PR creation."""
        return [
            {'path': p, 'content': c, 'is_new': self._originals.get(p) is None}
            for p, c in self._writes.items()
        ]

    # ---- Path helpers ----

    def _clean(self, rel_path: str) -> str:
        cleaned = os.path.normpath(rel_path).replace('\\', '/').lstrip('/')
        if cleaned.startswith('..'):
            raise ValueError(f'Path traversal not allowed: {rel_path}')
        return cleaned

    def _resolve(self, rel_path: str) -> Path:
        cleaned = self._clean(rel_path)
        full = self.workspace / cleaned
        if not str(full.resolve()).startswith(str(self.workspace)):
            raise ValueError(f'Path outside workspace: {rel_path}')
        return full

    def _read_content(self, rel_path: str) -> str:
        """Read a file, checking virtual overlay first."""
        cleaned = self._clean(rel_path)
        if cleaned in self._writes:
            return self._writes[cleaned]
        full = self._resolve(rel_path)
        if not full.is_file():
            raise FileNotFoundError(f'File not found: {rel_path}')
        if full.stat().st_size > MAX_READ_SIZE:
            raise ValueError(f'File too large ({full.stat().st_size:,} bytes)')
        return full.read_text(errors='replace')

    def _should_skip(self, name: str) -> bool:
        return name in self.SKIP_DIRS

    # ---- Tool implementations ----

    def _tool_read_file(
        self, path: str, start_line: int | None = None, end_line: int | None = None,
    ) -> str:
        cleaned = self._clean(path)
        content = self._read_content(path)
        lines = content.splitlines()
        total = len(lines)
        s = max(1, start_line or 1)
        e = min(total, end_line or total)

        # Track reads — if full file re-read without range and not modified, return short notice
        is_full_read = (start_line is None and end_line is None)
        prev_reads = self._read_count.get(cleaned, 0)
        self._read_count[cleaned] = prev_reads + 1
        if is_full_read and prev_reads > 0 and cleaned not in self._writes:
            return (
                f'# {path} ({total} lines) — already read previously, content unchanged.\n'
                f'Use start_line/end_line to re-read specific sections if needed.'
            )

        # Auto-cap large files when no range specified to save tokens
        MAX_AUTO_LINES = 300
        truncated = False
        if is_full_read and total > MAX_AUTO_LINES:
            e = MAX_AUTO_LINES
            truncated = True
        if s > total:
            return f'File has {total} lines; requested start_line={s} is beyond end.'
        selected = lines[s - 1 : e]
        numbered = '\n'.join(f'{i}\t{ln}' for i, ln in enumerate(selected, start=s))
        header = f'# {path} (lines {s}-{e} of {total})'
        if truncated:
            header += f'\n# NOTE: Large file — showing first {MAX_AUTO_LINES} lines. Use start_line/end_line for specific sections.'
        return f'{header}\n{numbered}'

    def _tool_list_directory(self, path: str = '', max_depth: int = 3) -> str:
        target = self._resolve(path or '.')
        if not target.is_dir():
            return f'Error: Not a directory: {path or "."}'
        lines: list[str] = []
        count = 0

        def _walk(d: Path, prefix: str, depth: int) -> None:
            nonlocal count
            if depth > max_depth or count >= MAX_DIR_ENTRIES:
                return
            try:
                entries = sorted(d.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
            except PermissionError:
                return
            for entry in entries:
                if count >= MAX_DIR_ENTRIES:
                    lines.append(f'{prefix}... (truncated)')
                    return
                if entry.is_dir():
                    if self._should_skip(entry.name):
                        continue
                    lines.append(f'{prefix}{entry.name}/')
                    count += 1
                    _walk(entry, prefix + '  ', depth + 1)
                else:
                    lines.append(f'{prefix}{entry.name}')
                    count += 1

        _walk(target, '', 1)
        return '\n'.join(lines) if lines else '(empty directory)'

    def _tool_search_code(
        self, pattern: str, glob: str | None = None, max_results: int = 30,
    ) -> str:
        max_results = min(max_results, MAX_SEARCH_RESULTS)
        try:
            regex = re.compile(pattern, re.IGNORECASE)
        except re.error as exc:
            return f'Error: Invalid regex: {exc}'
        results: list[str] = []
        for root, dirs, files in os.walk(self.workspace):
            dirs[:] = [d for d in dirs if not self._should_skip(d)]
            for fname in files:
                fpath = os.path.join(root, fname)
                rel = os.path.relpath(fpath, self.workspace).replace('\\', '/')
                if glob:
                    if not fnmatch.fnmatch(fname, glob) and not fnmatch.fnmatch(rel, glob):
                        continue
                try:
                    cleaned = self._clean(rel)
                    if cleaned in self._writes:
                        content = self._writes[cleaned]
                    else:
                        if os.path.getsize(fpath) > MAX_READ_SIZE:
                            continue
                        with open(fpath, 'r', errors='replace') as fh:
                            content = fh.read()
                except (PermissionError, OSError):
                    continue
                for lno, line in enumerate(content.splitlines(), 1):
                    if regex.search(line):
                        results.append(f'{rel}:{lno}: {line.rstrip()[:200]}')
                        if len(results) >= max_results:
                            break
                if len(results) >= max_results:
                    break
        if not results:
            return f'No matches found for: {pattern}'
        return f'Found {len(results)} match(es):\n' + '\n'.join(results)

    def _tool_write_file(self, path: str, content: str) -> str:
        cleaned = self._clean(path)
        if cleaned not in self._originals:
            full = self.workspace / cleaned
            try:
                self._originals[cleaned] = full.read_text(errors='replace') if full.is_file() else None
            except Exception:
                self._originals[cleaned] = None
        self._writes[cleaned] = content
        action = 'Created' if self._originals[cleaned] is None else 'Updated'
        return f'{action} {path} ({len(content.splitlines())} lines)'

    def _tool_edit_file(self, path: str, old_text: str, new_text: str) -> str:
        try:
            content = self._read_content(path)
        except FileNotFoundError:
            return f'Error: File not found: {path}'
        count = content.count(old_text)
        if count == 0:
            return (
                f'Error: old_text not found in {path}. '
                'Ensure the text matches exactly including whitespace and indentation.'
            )
        if count > 1:
            return (
                f'Warning: old_text found {count} times in {path}. '
                'Replacing first occurrence only. Provide more surrounding context for a unique match.'
            )
        cleaned = self._clean(path)
        if cleaned not in self._originals:
            self._originals[cleaned] = content
        self._writes[cleaned] = content.replace(old_text, new_text, 1)
        return f'Edited {path}: replaced {len(old_text)} chars with {len(new_text)} chars'

    def _tool_run_command(self, command: str, timeout: int = DEFAULT_CMD_TIMEOUT) -> str:
        if not self.allow_commands:
            return 'Error: Command execution is disabled for this task.'
        for blocked in BLOCKED_COMMANDS:
            if blocked in command.strip().lower():
                return f'Error: Command blocked for safety.'
        timeout = min(timeout, MAX_CMD_TIMEOUT)
        try:
            result = subprocess.run(
                command, shell=True, cwd=str(self.workspace),
                capture_output=True, text=True, timeout=timeout,
            )
            parts: list[str] = []
            if result.stdout.strip():
                parts.append(result.stdout.strip()[-5000:])
            if result.stderr.strip():
                parts.append(f'STDERR:\n{result.stderr.strip()[-2000:]}')
            output = '\n'.join(parts) or '(no output)'
            tag = 'OK' if result.returncode == 0 else f'FAILED (exit {result.returncode})'
            return f'[{tag}]\n{output}'
        except subprocess.TimeoutExpired:
            return f'Error: Command timed out after {timeout}s'

    async def _tool_run_command_async(
        self, command: str, timeout: int = DEFAULT_CMD_TIMEOUT,
    ) -> str:
        if not self.allow_commands:
            return 'Error: Command execution is disabled for this task.'
        for blocked in BLOCKED_COMMANDS:
            if blocked in command.strip().lower():
                return 'Error: Command blocked for safety.'
        timeout = min(timeout, MAX_CMD_TIMEOUT)
        try:
            proc = await asyncio.create_subprocess_shell(
                command, cwd=str(self.workspace),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            parts: list[str] = []
            out = stdout.decode(errors='replace').strip()
            err = stderr.decode(errors='replace').strip()
            if out:
                parts.append(out[-5000:])
            if err:
                parts.append(f'STDERR:\n{err[-2000:]}')
            output = '\n'.join(parts) or '(no output)'
            tag = 'OK' if proc.returncode == 0 else f'FAILED (exit {proc.returncode})'
            return f'[{tag}]\n{output}'
        except asyncio.TimeoutError:
            return f'Error: Command timed out after {timeout}s'

    def _tool_task_complete(self, summary: str) -> str:
        self._completed = True
        self._completion_summary = summary
        return 'Task marked as complete.'
