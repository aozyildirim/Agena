"""Deep repo scanner — extracts file tree, signatures, dependencies for agents.md generation."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

SOURCE_EXTS = {
    '.go', '.py', '.ts', '.tsx', '.js', '.jsx', '.java', '.rs', '.rb', '.cs',
    '.php', '.swift', '.kt', '.scala', '.c', '.cpp', '.h', '.hpp', '.vue',
    '.svelte', '.dart', '.ex', '.exs', '.lua', '.sql', '.graphql', '.proto',
}
CONFIG_FILES = {
    'go.mod', 'go.sum', 'package.json', 'tsconfig.json', 'pyproject.toml',
    'requirements.txt', 'Pipfile', 'pom.xml', 'build.gradle', 'build.gradle.kts',
    'Cargo.toml', 'composer.json', 'Gemfile', 'Makefile', 'Dockerfile',
    'docker-compose.yml', 'docker-compose.yaml', '.env.example',
}
IGNORE_DIRS = {
    'vendor', 'node_modules', '.git', 'dist', 'build', '__pycache__', '.next',
    '.idea', '.vscode', 'target', 'bin', 'obj', '.gradle', 'Pods', 'coverage',
    '.cache', '.turbo', '.nuxt', '.output',
}


def scan_repo(local_path: str) -> dict[str, Any]:
    """Scan a local repo and return structured data for agents.md generation."""
    root = Path(local_path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError(f'Repo path not reachable: {local_path}')

    result: dict[str, Any] = {
        'root': str(root),
        'file_tree': [],
        'source_files': [],
        'config_files': [],
        'signatures': [],
        'dependencies': {},
        'stats': {'total_files': 0, 'total_lines': 0, 'languages': {}},
    }

    all_files: list[tuple[Path, str]] = []  # (path, relative)
    for f in sorted(root.rglob('*')):
        if not f.is_file():
            continue
        try:
            rel = str(f.relative_to(root))
        except ValueError:
            continue
        parts = f.relative_to(root).parts
        if any(p in IGNORE_DIRS for p in parts):
            continue
        all_files.append((f, rel))

    # File tree
    for _f, rel in all_files:
        result['file_tree'].append(rel)

    # Config files — read full content
    for f, rel in all_files:
        if f.name in CONFIG_FILES:
            try:
                content = f.read_text(errors='replace')[:5000]
                result['config_files'].append({'path': rel, 'content': content})
            except Exception:
                pass

    # Source files — extract signatures
    for f, rel in all_files:
        if f.suffix not in SOURCE_EXTS:
            continue
        try:
            size = f.stat().st_size
            if size > 500000:
                continue
            content = f.read_text(errors='replace')
            lines = content.count('\n') + 1
            lang = _detect_lang(f.suffix)

            result['stats']['total_files'] += 1
            result['stats']['total_lines'] += lines
            result['stats']['languages'][lang] = result['stats']['languages'].get(lang, 0) + 1

            sigs = _extract_signatures(content, lang, rel)
            if sigs:
                result['signatures'].extend(sigs)
            result['source_files'].append({
                'path': rel,
                'lang': lang,
                'lines': lines,
                'size': size,
            })
        except Exception:
            continue

    # Dependencies
    result['dependencies'] = _extract_dependencies(root)

    return result


def _detect_lang(suffix: str) -> str:
    m = {
        '.go': 'go', '.py': 'python', '.ts': 'typescript', '.tsx': 'typescript',
        '.js': 'javascript', '.jsx': 'javascript', '.java': 'java', '.rs': 'rust',
        '.rb': 'ruby', '.cs': 'csharp', '.php': 'php', '.swift': 'swift',
        '.kt': 'kotlin', '.scala': 'scala', '.c': 'c', '.cpp': 'cpp',
        '.h': 'c', '.hpp': 'cpp', '.vue': 'vue', '.svelte': 'svelte',
        '.dart': 'dart', '.ex': 'elixir', '.exs': 'elixir', '.lua': 'lua',
        '.proto': 'protobuf', '.graphql': 'graphql', '.sql': 'sql',
    }
    return m.get(suffix, 'unknown')


def _extract_signatures(content: str, lang: str, file_path: str) -> list[dict[str, str]]:
    """Extract type/struct/class/function/interface signatures from source code."""
    sigs: list[dict[str, str]] = []
    lines = content.splitlines()

    if lang == 'go':
        for i, line in enumerate(lines):
            s = line.strip()
            # type X struct/interface
            m = re.match(r'^type\s+(\w+)\s+(struct|interface)\s*\{', s)
            if m:
                # Capture fields for structs (next lines until closing brace)
                fields = _capture_block(lines, i, max_lines=40)
                sigs.append({'file': file_path, 'kind': m.group(2), 'name': m.group(1), 'line': i + 1, 'body': fields})
                continue
            # func (receiver) Name(params) returns
            m = re.match(r'^func\s+(\([^)]+\)\s+)?(\w+)\s*\(([^)]*)\)', s)
            if m:
                recv = (m.group(1) or '').strip()
                name = m.group(2)
                params = m.group(3).strip()
                sig = f'func {recv + " " if recv else ""}{name}({params})'
                # Capture return type
                rest = s[m.end():]
                ret = rest.strip().rstrip('{').strip()
                if ret:
                    sig += f' {ret}'
                sigs.append({'file': file_path, 'kind': 'func', 'name': name, 'line': i + 1, 'signature': sig})

    elif lang == 'python':
        for i, line in enumerate(lines):
            s = line.strip()
            m = re.match(r'^class\s+(\w+)(\([^)]*\))?\s*:', s)
            if m:
                sigs.append({'file': file_path, 'kind': 'class', 'name': m.group(1), 'line': i + 1, 'signature': s})
                continue
            m = re.match(r'^(\s*)def\s+(\w+)\s*\(([^)]*)\)', s)
            if m:
                indent = len(line) - len(line.lstrip())
                kind = 'method' if indent > 0 else 'function'
                sigs.append({'file': file_path, 'kind': kind, 'name': m.group(2), 'line': i + 1, 'signature': s.rstrip(':')})

    elif lang in ('typescript', 'javascript'):
        for i, line in enumerate(lines):
            s = line.strip()
            # export interface/type/class
            m = re.match(r'^(?:export\s+)?(?:default\s+)?(interface|type|class|abstract\s+class)\s+(\w+)', s)
            if m:
                sigs.append({'file': file_path, 'kind': m.group(1).strip(), 'name': m.group(2), 'line': i + 1, 'signature': s[:120]})
                continue
            # function/const arrow
            m = re.match(r'^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]', s)
            if m:
                sigs.append({'file': file_path, 'kind': 'function', 'name': m.group(1), 'line': i + 1, 'signature': s[:120]})

    elif lang == 'java' or lang == 'kotlin':
        for i, line in enumerate(lines):
            s = line.strip()
            m = re.match(r'^(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?(class|interface|enum)\s+(\w+)', s)
            if m:
                sigs.append({'file': file_path, 'kind': m.group(1), 'name': m.group(2), 'line': i + 1, 'signature': s[:120]})
                continue
            m = re.match(r'^(?:\s*)(?:public|private|protected)?\s*(?:static\s+)?(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(', s)
            if m and not s.startswith('//') and not s.startswith('*'):
                sigs.append({'file': file_path, 'kind': 'method', 'name': m.group(1), 'line': i + 1, 'signature': s[:120]})

    elif lang == 'php':
        for i, line in enumerate(lines):
            s = line.strip()
            m = re.match(r'^(?:abstract\s+)?(?:final\s+)?(class|interface|trait|enum)\s+(\w+)', s)
            if m:
                sigs.append({'file': file_path, 'kind': m.group(1), 'name': m.group(2), 'line': i + 1, 'signature': s[:120]})
                continue
            m = re.match(r'^(?:\s*)(?:public|private|protected)?\s*(?:static\s+)?function\s+(\w+)\s*\(', s)
            if m:
                sigs.append({'file': file_path, 'kind': 'function', 'name': m.group(1), 'line': i + 1, 'signature': s[:120]})

    elif lang == 'rust':
        for i, line in enumerate(lines):
            s = line.strip()
            m = re.match(r'^pub\s+(?:async\s+)?fn\s+(\w+)', s)
            if m:
                sigs.append({'file': file_path, 'kind': 'fn', 'name': m.group(1), 'line': i + 1, 'signature': s[:120]})
            m = re.match(r'^(?:pub\s+)?struct\s+(\w+)', s)
            if m:
                sigs.append({'file': file_path, 'kind': 'struct', 'name': m.group(1), 'line': i + 1, 'signature': s[:120]})
            m = re.match(r'^(?:pub\s+)?trait\s+(\w+)', s)
            if m:
                sigs.append({'file': file_path, 'kind': 'trait', 'name': m.group(1), 'line': i + 1, 'signature': s[:120]})

    elif lang == 'csharp':
        for i, line in enumerate(lines):
            s = line.strip()
            m = re.match(r'^(?:public|private|internal|protected)?\s*(?:static\s+)?(?:partial\s+)?(?:abstract\s+)?(class|interface|struct|enum|record)\s+(\w+)', s)
            if m:
                sigs.append({'file': file_path, 'kind': m.group(1), 'name': m.group(2), 'line': i + 1, 'signature': s[:120]})

    return sigs


def _capture_block(lines: list[str], start: int, max_lines: int = 40) -> str:
    """Capture a block from start line until closing brace."""
    result = []
    depth = 0
    for i in range(start, min(start + max_lines, len(lines))):
        line = lines[i]
        result.append(line)
        depth += line.count('{') - line.count('}')
        if depth <= 0 and i > start:
            break
    return '\n'.join(result)


def _extract_dependencies(root: Path) -> dict[str, Any]:
    """Extract dependency info from config files."""
    deps: dict[str, Any] = {}

    # Go
    gomod = root / 'go.mod'
    if gomod.is_file():
        try:
            content = gomod.read_text(errors='replace')
            module_match = re.search(r'^module\s+(.+)', content, re.MULTILINE)
            if module_match:
                deps['go_module'] = module_match.group(1).strip()
            requires = re.findall(r'^\s+(\S+)\s+v[\d.]+', content, re.MULTILINE)
            deps['go_requires'] = requires[:30]
        except Exception:
            pass

    # Node
    pkg = root / 'package.json'
    if pkg.is_file():
        try:
            import json
            data = json.loads(pkg.read_text(errors='replace'))
            deps['node_name'] = data.get('name', '')
            deps['node_deps'] = list(data.get('dependencies', {}).keys())[:30]
            deps['node_dev_deps'] = list(data.get('devDependencies', {}).keys())[:20]
        except Exception:
            pass

    # Python
    for pyfile in ['requirements.txt', 'pyproject.toml']:
        p = root / pyfile
        if p.is_file():
            try:
                content = p.read_text(errors='replace')[:3000]
                deps[f'python_{pyfile}'] = content
            except Exception:
                pass

    return deps


def generate_agents_md(scan_data: dict[str, Any], repo_name: str) -> str:
    """Generate agents.md content from scan data — this is the LOCAL version (no LLM needed)."""
    lines: list[str] = []
    lines.append(f'# {repo_name} — Repository Guide for AI Agents')
    lines.append('')
    lines.append('> Auto-generated repository analysis. AI agents use this document to understand the codebase.')
    lines.append('')

    # Stats
    stats = scan_data.get('stats', {})
    langs = stats.get('languages', {})
    lines.append('## Overview')
    lines.append(f'- **Total source files:** {stats.get("total_files", 0)}')
    lines.append(f'- **Total lines:** {stats.get("total_lines", 0):,}')
    lines.append(f'- **Languages:** {", ".join(f"{k} ({v})" for k, v in sorted(langs.items(), key=lambda x: -x[1]))}')
    lines.append('')

    # Dependencies
    deps = scan_data.get('dependencies', {})
    if deps:
        lines.append('## Dependencies')
        if 'go_module' in deps:
            lines.append(f'- **Go module:** `{deps["go_module"]}`')
            if deps.get('go_requires'):
                lines.append(f'- **Key packages:** {", ".join(f"`{r}`" for r in deps["go_requires"][:15])}')
        if 'node_name' in deps:
            lines.append(f'- **Package:** `{deps["node_name"]}`')
            if deps.get('node_deps'):
                lines.append(f'- **Dependencies:** {", ".join(f"`{d}`" for d in deps["node_deps"][:15])}')
        lines.append('')

    # File tree (grouped by directory)
    file_tree = scan_data.get('file_tree', [])
    if file_tree:
        lines.append('## File Tree')
        lines.append('```')
        for f in file_tree[:200]:
            lines.append(f)
        if len(file_tree) > 200:
            lines.append(f'... and {len(file_tree) - 200} more files')
        lines.append('```')
        lines.append('')

    # Source files summary
    source_files = scan_data.get('source_files', [])
    if source_files:
        lines.append('## Source Files')
        lines.append('| File | Language | Lines | Size |')
        lines.append('|------|----------|-------|------|')
        for sf in source_files:
            lines.append(f'| `{sf["path"]}` | {sf["lang"]} | {sf["lines"]} | {sf["size"]:,}B |')
        lines.append('')

    # Signatures — package index only (details in separate files)
    sigs = scan_data.get('signatures', [])
    if sigs:
        by_pkg = _group_by_package(sigs)
        lines.append('## Packages')
        lines.append('| Package | Files | Structs | Functions |')
        lines.append('|---------|-------|---------|-----------|')
        for pkg, pkg_sigs in sorted(by_pkg.items()):
            files = len(set(s['file'] for s in pkg_sigs))
            structs = sum(1 for s in pkg_sigs if s.get('kind') in ('struct', 'interface', 'class', 'type'))
            funcs = sum(1 for s in pkg_sigs if s.get('kind') in ('func', 'function', 'method', 'fn'))
            lines.append(f'| `{pkg}` | {files} | {structs} | {funcs} |')
        lines.append('')
        lines.append('> Detailed signatures are in separate package files. The planner loads only relevant packages.')

    return '\n'.join(lines)


def generate_package_mds(scan_data: dict[str, Any]) -> dict[str, str]:
    """Generate per-package markdown files from scan data.

    Returns dict mapping package_name -> markdown content.
    """
    sigs = scan_data.get('signatures', [])
    if not sigs:
        return {}

    by_pkg = _group_by_package(sigs)
    result: dict[str, str] = {}

    for pkg, pkg_sigs in sorted(by_pkg.items()):
        lines: list[str] = []
        lines.append(f'# Package: {pkg}')
        lines.append('')

        # Group by file within package
        by_file: dict[str, list[dict]] = {}
        for s in pkg_sigs:
            by_file.setdefault(s['file'], []).append(s)

        for file_path, file_sigs in sorted(by_file.items()):
            lines.append(f'### `{file_path}`')
            for s in file_sigs:
                kind = s.get('kind', '')
                name = s.get('name', '')
                line_no = s.get('line', '')
                sig = s.get('signature', '')
                body = s.get('body', '')

                if body:
                    lines.append('```')
                    lines.append(body)
                    lines.append('```')
                elif sig:
                    lines.append(f'- **{kind}** `{sig}` (line {line_no})')
                else:
                    lines.append(f'- **{kind}** `{name}` (line {line_no})')
            lines.append('')

        result[pkg] = '\n'.join(lines)

    return result


def _group_by_package(sigs: list[dict]) -> dict[str, list[dict]]:
    """Group signatures by their top-level package directory."""
    by_pkg: dict[str, list[dict]] = {}
    for s in sigs:
        parts = s['file'].split('/')
        # Use first directory as package, or 'root' for top-level files
        pkg = parts[0] if len(parts) > 1 else '_root'
        # For deeper nesting like pkg/esindexer/file.go, use first two dirs
        if len(parts) > 2:
            pkg = '/'.join(parts[:2])
        by_pkg.setdefault(pkg, []).append(s)
    return by_pkg
