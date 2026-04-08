"""Remote tool executor for MCP agent — reads files via GitHub/Azure API.

Works like ToolExecutor but without a local filesystem:
- read_file / list_directory / search_code → fetch via API
- write_file / edit_file → virtual overlay (in-memory)
- run_command → disabled (no local shell)
- get_file_changes() → returns modifications for PR creation
"""

from __future__ import annotations

import logging
import re
from typing import Any, Callable, Awaitable

logger = logging.getLogger(__name__)

MAX_READ_SIZE = 500_000
MAX_SEARCH_RESULTS = 50


class RemoteToolExecutor:
    """Execute MCP agent tools against a remote repository via API callbacks.

    Instead of filesystem access, this executor uses callback functions
    to read files and list directories from GitHub or Azure DevOps.
    Writes are captured in a virtual overlay — the remote repo is never
    mutated directly.
    """

    def __init__(
        self,
        *,
        read_file_fn: Callable[[str], Awaitable[str | None]],
        list_files_fn: Callable[[], Awaitable[list[str]]],
        file_tree: str | None = None,
    ) -> None:
        """
        Args:
            read_file_fn: async (path) -> file content or None if not found.
            list_files_fn: async () -> list of all file paths in the repo.
            file_tree: Pre-built file tree string (optional, for list_directory).
        """
        self._read_file_fn = read_file_fn
        self._list_files_fn = list_files_fn
        self._file_tree = file_tree
        # Cache of files read from remote
        self._remote_cache: dict[str, str] = {}
        # Virtual overlay
        self._writes: dict[str, str] = {}
        self._originals: dict[str, str | None] = {}
        self._read_count: dict[str, int] = {}
        self._completed = False
        self._completion_summary = ''
        # Cached file list
        self._all_files: list[str] | None = None

    @property
    def is_completed(self) -> bool:
        return self._completed

    @property
    def completion_summary(self) -> str:
        return self._completion_summary

    def execute(self, tool_name: str, arguments: dict[str, Any]) -> str:
        """Sync wrapper — not usable for remote reads. Use execute_async."""
        if tool_name == 'task_complete':
            return self._tool_task_complete(**arguments)
        if tool_name in ('write_file', 'edit_file'):
            # These only need already-cached data
            handler = getattr(self, f'_tool_{tool_name}', None)
            if handler:
                return handler(**arguments)
        return 'Error: Use execute_async for remote operations.'

    async def execute_async(self, tool_name: str, arguments: dict[str, Any]) -> str:
        handler = getattr(self, f'_tool_{tool_name}', None)
        if handler is None:
            return f'Error: Unknown tool "{tool_name}"'
        try:
            result = handler(**arguments)
            # If it's a coroutine (async method), await it
            if hasattr(result, '__await__'):
                return await result
            return result
        except Exception as exc:
            logger.warning('Remote tool %s failed: %s', tool_name, exc)
            return f'Error: {type(exc).__name__}: {exc}'

    def get_file_changes(self) -> list[dict[str, Any]]:
        return [
            {'path': p, 'content': c, 'is_new': self._originals.get(p) is None}
            for p, c in self._writes.items()
        ]

    # ---- Internal helpers ----

    async def _ensure_file_list(self) -> list[str]:
        if self._all_files is None:
            self._all_files = await self._list_files_fn()
        return self._all_files

    async def _read_content(self, path: str) -> str:
        cleaned = path.lstrip('/')
        if cleaned in self._writes:
            return self._writes[cleaned]
        if cleaned in self._remote_cache:
            return self._remote_cache[cleaned]
        content = await self._read_file_fn(cleaned)
        if content is None:
            raise FileNotFoundError(f'File not found: {path}')
        self._remote_cache[cleaned] = content
        return content

    # ---- Tool implementations ----

    async def _tool_read_file(
        self, path: str, start_line: int | None = None, end_line: int | None = None,
    ) -> str:
        cleaned = path.lstrip('/')
        content = await self._read_content(path)
        lines = content.splitlines()
        total = len(lines)
        s = max(1, start_line or 1)
        e = min(total, end_line or total)

        is_full_read = (start_line is None and end_line is None)
        prev_reads = self._read_count.get(cleaned, 0)
        self._read_count[cleaned] = prev_reads + 1
        if is_full_read and prev_reads > 0 and cleaned not in self._writes:
            return (
                f'# {path} ({total} lines) — already read previously, content unchanged.\n'
                f'Use start_line/end_line to re-read specific sections if needed.'
            )

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

    async def _tool_list_directory(self, path: str = '', max_depth: int = 3) -> str:
        if self._file_tree:
            if not path:
                return self._file_tree
            # Filter tree for sub-path
            prefix = path.rstrip('/') + '/'
            filtered = [l for l in self._file_tree.splitlines() if l.strip().startswith(prefix) or not l.strip()]
            return '\n'.join(filtered[:500]) if filtered else f'No files found under {path}/'

        files = await self._ensure_file_list()
        if not files:
            return '(empty repository)'

        prefix = path.rstrip('/') + '/' if path else ''
        tree_lines: list[str] = []
        seen_dirs: set[str] = set()

        for f in sorted(files):
            if prefix and not f.startswith(prefix):
                continue
            rel = f[len(prefix):] if prefix else f
            parts = rel.split('/')
            if len(parts) - 1 > max_depth:
                continue
            # Add directory entries
            for i in range(len(parts) - 1):
                d = '/'.join(parts[:i + 1])
                if d not in seen_dirs:
                    seen_dirs.add(d)
                    indent = '  ' * i
                    tree_lines.append(f'{indent}{parts[i]}/')
            # Add file
            indent = '  ' * (len(parts) - 1)
            tree_lines.append(f'{indent}{parts[-1]}')

            if len(tree_lines) >= 500:
                tree_lines.append('... (truncated)')
                break

        return '\n'.join(tree_lines) if tree_lines else f'(no files under {path or "root"})'

    async def _tool_search_code(
        self, pattern: str, glob: str | None = None, max_results: int = 30,
    ) -> str:
        """Search code in remote repo.

        To avoid downloading every file, we search in two passes:
        1. Search files already in cache (previously read).
        2. If glob is given, fetch up to 10 matching uncached files and search those.
        This keeps API calls bounded.
        """
        max_results = min(max_results, MAX_SEARCH_RESULTS)
        try:
            regex = re.compile(pattern, re.IGNORECASE)
        except re.error as exc:
            return f'Error: Invalid regex: {exc}'

        import fnmatch
        BINARY_EXT = {'png', 'jpg', 'jpeg', 'gif', 'ico', 'woff', 'woff2', 'ttf', 'eot', 'zip', 'tar', 'gz', 'pdf', 'bin', 'exe', 'dll', 'so', 'dylib'}
        results: list[str] = []

        def _matches_glob(fpath: str, fname: str) -> bool:
            if not glob:
                return True
            return fnmatch.fnmatch(fname, glob) or fnmatch.fnmatch(fpath, glob)

        def _is_binary(fname: str) -> bool:
            ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
            return ext in BINARY_EXT

        def _search_content(fpath: str, content: str) -> None:
            for lno, line in enumerate(content.splitlines(), 1):
                if regex.search(line):
                    results.append(f'{fpath}:{lno}: {line.rstrip()[:200]}')
                    if len(results) >= max_results:
                        return

        # Pass 1: search in already-cached files (free — no API calls)
        for fpath, content in {**self._remote_cache, **self._writes}.items():
            fname = fpath.rsplit('/', 1)[-1] if '/' in fpath else fpath
            if not _matches_glob(fpath, fname) or _is_binary(fname):
                continue
            _search_content(fpath, content)
            if len(results) >= max_results:
                break

        # Pass 2: if not enough results and glob is given, fetch a few matching files
        if len(results) < max_results and glob:
            files = await self._ensure_file_list()
            fetched = 0
            max_fetch = 10  # limit new API calls
            for fpath in files:
                if fpath in self._remote_cache or fpath in self._writes:
                    continue  # already searched in pass 1
                fname = fpath.rsplit('/', 1)[-1] if '/' in fpath else fpath
                if not _matches_glob(fpath, fname) or _is_binary(fname):
                    continue
                try:
                    content = await self._read_content(fpath)
                    fetched += 1
                except Exception:
                    continue
                _search_content(fpath, content)
                if len(results) >= max_results or fetched >= max_fetch:
                    break

        if not results:
            hint = ' (only searched cached + glob-matched files to save API calls)' if glob else ' (only searched previously-read files)'
            return f'No matches found for: {pattern}{hint}\nTip: use read_file to load specific files first, then search again.'
        return f'Found {len(results)} match(es):\n' + '\n'.join(results)

    def _tool_write_file(self, path: str, content: str) -> str:
        cleaned = path.lstrip('/')
        if cleaned not in self._originals:
            self._originals[cleaned] = self._remote_cache.get(cleaned) or (
                self._writes.get(cleaned)
            )
        self._writes[cleaned] = content
        action = 'Created' if self._originals[cleaned] is None else 'Updated'
        return f'{action} {path} ({len(content.splitlines())} lines)'

    def _tool_edit_file(self, path: str, old_text: str, new_text: str) -> str:
        cleaned = path.lstrip('/')
        # Must have been read before
        content = self._writes.get(cleaned) or self._remote_cache.get(cleaned)
        if content is None:
            return (
                f'Error: File {path} has not been read yet. '
                'Use read_file first, then edit_file.'
            )
        count = content.count(old_text)
        if count == 0:
            return (
                f'Error: old_text not found in {path}. '
                'Ensure the text matches exactly including whitespace and indentation.'
            )
        if count > 1:
            return (
                f'Warning: old_text found {count} times in {path}. '
                'Replacing first occurrence only.'
            )
        if cleaned not in self._originals:
            self._originals[cleaned] = content
        self._writes[cleaned] = content.replace(old_text, new_text, 1)
        return f'Edited {path}: replaced {len(old_text)} chars with {len(new_text)} chars'

    def _tool_run_command(self, command: str = '', timeout: int = 60) -> str:
        return (
            'Error: Shell commands are not available for remote repositories. '
            'Tests and linting must be run in CI/CD after the PR is created.'
        )

    def _tool_task_complete(self, summary: str) -> str:
        self._completed = True
        self._completion_summary = summary
        return 'Task marked as complete.'
