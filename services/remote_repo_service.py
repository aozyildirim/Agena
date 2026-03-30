"""Read repository tree and file contents via GitHub / Azure DevOps REST API.

Used when no local repo path is available (production / SaaS mode).
Returns the same format as the local repo scanner so orchestration_service
can use it transparently.
"""

from __future__ import annotations

import base64
import logging
import re
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# File extensions worth reading for LLM context
SOURCE_EXTS = {
    '.go', '.py', '.ts', '.tsx', '.js', '.jsx', '.java', '.rs', '.rb', '.cs',
    '.php', '.swift', '.kt', '.scala', '.c', '.cpp', '.h', '.hpp', '.vue',
    '.svelte', '.dart', '.ex', '.exs', '.lua', '.sql', '.graphql', '.proto',
    '.yaml', '.yml', '.json', '.toml', '.env.example', '.md',
}
IGNORE_DIRS = {
    'vendor', 'node_modules', '.git', 'dist', 'build', '__pycache__', '.next',
    '.idea', '.vscode', 'target', 'bin', 'obj', '.gradle', 'Pods', 'coverage',
}
IGNORE_FILES = {'go.sum', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'}
MAX_FILE_SIZE = 200_000  # skip files larger than 200KB
MAX_TOTAL_CHARS = 1_500_000


class RemoteRepoService:
    """Stateless service — pass credentials per call."""

    # ── GitHub ────────────────────────────────────────────────────────

    async def github_tree(
        self,
        owner: str,
        repo: str,
        token: str,
        branch: str = 'main',
    ) -> list[dict[str, Any]]:
        """Return flat list of {path, size, type} from the repo tree."""
        url = f'https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1'
        headers = {'Authorization': f'token {token}', 'Accept': 'application/vnd.github.v3+json'}
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url, headers=headers)
            r.raise_for_status()
        tree = r.json().get('tree', [])
        return [
            {'path': item['path'], 'size': item.get('size', 0), 'type': item['type']}
            for item in tree
        ]

    async def github_file_content(
        self,
        owner: str,
        repo: str,
        token: str,
        path: str,
        branch: str = 'main',
    ) -> str | None:
        """Return file content as string, or None if binary/too large."""
        url = f'https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={branch}'
        headers = {'Authorization': f'token {token}', 'Accept': 'application/vnd.github.v3+json'}
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(url, headers=headers)
            if r.status_code != 200:
                return None
        data = r.json()
        if data.get('size', 0) > MAX_FILE_SIZE:
            return None
        encoding = data.get('encoding', '')
        content = data.get('content', '')
        if encoding == 'base64' and content:
            try:
                return base64.b64decode(content).decode('utf-8', errors='replace')
            except Exception:
                return None
        return content or None

    async def github_repo_context(
        self,
        owner: str,
        repo: str,
        token: str,
        branch: str = 'main',
        task_title: str = '',
        task_description: str = '',
    ) -> str:
        """Build LLM-ready repo context string from GitHub API."""
        tree = await self.github_tree(owner, repo, token, branch)
        filtered = self._filter_tree(tree)
        relevant = self._rank_files(filtered, task_title, task_description)

        lines = [f'Remote Repo: github.com/{owner}/{repo} (branch: {branch})']
        lines.append(f'Total files: {len(tree)}, Relevant: {len(relevant)}')
        lines.append('')

        # File tree overview
        lines.append('=== FILE TREE ===')
        for item in filtered[:200]:
            lines.append(f'  {item["path"]}')
        if len(filtered) > 200:
            lines.append(f'  ... and {len(filtered) - 200} more files')
        lines.append('=== END FILE TREE ===')
        lines.append('')

        # Read relevant files
        lines.append('=== RELEVANT SOURCE FILES ===')
        total_chars = 0
        for item in relevant:
            if total_chars > MAX_TOTAL_CHARS:
                break
            content = await self.github_file_content(owner, repo, token, item['path'], branch)
            if content is None:
                continue
            lines.append(f'\n--- {item["path"]} ---')
            lines.append(content)
            total_chars += len(content)
        lines.append('=== END SOURCE FILES ===')
        lines.append('')
        lines.append('Return **File: path** blocks with code.')
        return '\n'.join(lines)

    # ── Azure DevOps ──────────────────────────────────────────────────

    async def azure_tree(
        self,
        org_url: str,
        project: str,
        repo_name: str,
        pat: str,
        branch: str = 'main',
    ) -> list[dict[str, Any]]:
        """Return flat list of {path, size, type} from Azure DevOps repo."""
        base = org_url.rstrip('/')
        url = (
            f'{base}/{project}/_apis/git/repositories/{repo_name}'
            f'/items?recursionLevel=full&versionDescriptor.version={branch}'
            f'&api-version=7.1-preview.1'
        )
        token = base64.b64encode(f':{pat}'.encode()).decode()
        headers = {'Authorization': f'Basic {token}', 'Content-Type': 'application/json'}
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url, headers=headers)
            r.raise_for_status()
        items = r.json().get('value', [])
        return [
            {
                'path': (item.get('path') or '').lstrip('/'),
                'size': item.get('contentMetadata', {}).get('size', 0) if isinstance(item.get('contentMetadata'), dict) else 0,
                'type': 'blob' if not item.get('isFolder') else 'tree',
            }
            for item in items
            if item.get('path')
        ]

    async def azure_file_content(
        self,
        org_url: str,
        project: str,
        repo_name: str,
        pat: str,
        path: str,
        branch: str = 'main',
    ) -> str | None:
        """Return file content as string from Azure DevOps."""
        base = org_url.rstrip('/')
        url = (
            f'{base}/{project}/_apis/git/repositories/{repo_name}'
            f'/items?path={path}&versionDescriptor.version={branch}'
            f'&api-version=7.1-preview.1'
        )
        token = base64.b64encode(f':{pat}'.encode()).decode()
        headers = {'Authorization': f'Basic {token}'}
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(url, headers=headers)
            if r.status_code != 200:
                return None
        try:
            return r.text
        except Exception:
            return None

    async def azure_repo_context(
        self,
        org_url: str,
        project: str,
        repo_name: str,
        pat: str,
        branch: str = 'main',
        task_title: str = '',
        task_description: str = '',
    ) -> str:
        """Build LLM-ready repo context string from Azure DevOps API."""
        tree = await self.azure_tree(org_url, project, repo_name, pat, branch)
        filtered = self._filter_tree(tree)
        relevant = self._rank_files(filtered, task_title, task_description)

        lines = [f'Remote Repo: {project}/{repo_name} (branch: {branch})']
        lines.append(f'Total files: {len(tree)}, Relevant: {len(relevant)}')
        lines.append('')

        lines.append('=== FILE TREE ===')
        for item in filtered[:200]:
            lines.append(f'  {item["path"]}')
        if len(filtered) > 200:
            lines.append(f'  ... and {len(filtered) - 200} more files')
        lines.append('=== END FILE TREE ===')
        lines.append('')

        lines.append('=== RELEVANT SOURCE FILES ===')
        total_chars = 0
        for item in relevant:
            if total_chars > MAX_TOTAL_CHARS:
                break
            content = await self.azure_file_content(org_url, project, repo_name, pat, item['path'], branch)
            if content is None:
                continue
            lines.append(f'\n--- {item["path"]} ---')
            lines.append(content)
            total_chars += len(content)
        lines.append('=== END SOURCE FILES ===')
        lines.append('')
        lines.append('Return **File: path** blocks with code.')
        return '\n'.join(lines)

    # ── Shared helpers ────────────────────────────────────────────────

    def _filter_tree(self, tree: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Filter tree to source files, skipping ignored dirs and files."""
        result = []
        for item in tree:
            if item['type'] != 'blob':
                continue
            path = item['path']
            parts = path.split('/')
            if any(p in IGNORE_DIRS for p in parts):
                continue
            filename = parts[-1]
            if filename in IGNORE_FILES:
                continue
            ext = '.' + filename.rsplit('.', 1)[-1] if '.' in filename else ''
            if ext.lower() not in SOURCE_EXTS and filename not in {'Dockerfile', 'Makefile', 'agents.md', 'AGENTS.md', 'README.md'}:
                continue
            result.append(item)
        return result

    def _rank_files(
        self,
        files: list[dict[str, Any]],
        task_title: str,
        task_description: str,
        limit: int = 40,
    ) -> list[dict[str, Any]]:
        """Rank files by relevance to task, return top N."""
        text = (task_title + ' ' + task_description).lower()
        keywords = set(re.findall(r'[a-z_][a-z0-9_]{2,}', text))

        def score(item: dict[str, Any]) -> int:
            path = item['path'].lower()
            s = 0
            # agents.md / README at top
            if 'agents.md' in path:
                s += 100
            if 'readme' in path:
                s += 50
            # Keyword match in path
            for kw in keywords:
                if kw in path:
                    s += 10
            # Config files
            if any(path.endswith(c) for c in ['.yaml', '.yml', '.toml', '.json']):
                if 'config' in path or 'setting' in path or 'env' in path:
                    s += 8
            # Entry points
            if any(n in path for n in ['main.', 'app.', 'index.', 'server.', 'routes/', 'api/']):
                s += 5
            # Shorter paths = more important
            s -= path.count('/')
            return s

        ranked = sorted(files, key=score, reverse=True)
        return ranked[:limit]
