#!/usr/bin/env python3
"""CLI Bridge — HTTP server that runs codex/claude CLI on host for Docker workers.

Usage: python3 cli_bridge.py
Listens on port 9876. Docker worker calls this to execute CLI tools.
"""
import asyncio
import json
import os
import subprocess
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

PORT = 9876


class BridgeHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length > 0 else {}

        if self.path == '/codex':
            result = self._run_codex(body)
        elif self.path == '/claude':
            result = self._run_claude(body)
        elif self.path == '/codex/logout':
            result = self._logout_codex()
        elif self.path == '/claude/logout':
            result = self._logout_claude()
        elif self.path == '/health':
            result = {'status': 'ok', 'codex': bool(self._which('codex')), 'claude': bool(self._which('claude'))}
        else:
            self.send_response(404)
            self.end_headers()
            return

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(result, ensure_ascii=False).encode())

    def _run_codex(self, body: dict) -> dict:
        repo_path = body.get('repo_path', '')
        prompt = body.get('prompt', '')
        model = body.get('model', '')
        timeout = body.get('timeout', 300)

        codex_bin = self._which('codex')
        if not codex_bin:
            return {'status': 'error', 'message': 'codex binary not found on host'}

        # Check auth token validity before running
        auth_error = self._check_codex_auth()
        if auth_error:
            return {'status': 'error', 'message': auth_error}

        # Auto-trust the repo path so codex doesn't block on interactive prompt
        self._ensure_codex_trust(repo_path)

        # codex exec mode: non-interactive, writes output to stdout
        cmd = [codex_bin, 'exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-C', repo_path]
        if model:
            cmd.extend(['-m', model])
        cmd.append(prompt)

        env = {**os.environ, 'NO_COLOR': '1'}

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True,
                timeout=timeout, env=env,
            )
            stderr = result.stderr or ''
            # Detect expired/missing auth from output
            if result.returncode != 0:
                if '401' in stderr or 'Unauthorized' in stderr or 'Missing bearer' in stderr:
                    return {'status': 'error', 'message': 'Codex CLI session expired. Run `codex auth login` on the host to re-authenticate.'}
                if 'trust' in stderr.lower() or 'untrusted' in stderr.lower():
                    return {'status': 'error', 'message': f'Codex CLI does not trust repo: {repo_path}. Run `codex` once in that directory to trust it.'}
            return {
                'status': 'ok' if result.returncode == 0 else 'error',
                'stdout': result.stdout,
                'stderr': stderr,
                'returncode': result.returncode,
            }
        except subprocess.TimeoutExpired:
            return {'status': 'error', 'message': f'codex timed out after {timeout}s'}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}

    def _logout_codex(self) -> dict:
        auth_path = Path.home() / '.codex' / 'auth.json'
        try:
            if auth_path.exists():
                auth_path.unlink()
                print('[bridge] Codex auth.json removed')
            return {'status': 'ok', 'message': 'Codex session cleared. Run `codex auth login` to re-authenticate.'}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}

    def _logout_claude(self) -> dict:
        import shutil as _shutil
        claude_dirs = [
            Path.home() / '.claude',
            Path.home() / 'Library' / 'Application Support' / 'Claude',
        ]
        cleared = []
        for d in claude_dirs:
            creds = d / 'credentials.json'
            if creds.exists():
                try:
                    creds.unlink()
                    cleared.append(str(creds))
                except Exception:
                    pass
        if cleared:
            return {'status': 'ok', 'message': f'Claude session cleared: {", ".join(cleared)}'}
        return {'status': 'ok', 'message': 'No Claude session found to clear.'}

    def _check_codex_auth(self) -> str | None:
        """Return an error message if codex auth.json is missing or token is expired, else None."""
        import datetime
        auth_path = Path.home() / '.codex' / 'auth.json'
        if not auth_path.exists():
            return 'Codex CLI not authenticated. Run `codex auth login` on the host.'
        try:
            data = json.loads(auth_path.read_text())
            last_refresh = data.get('last_refresh', '')
            if last_refresh:
                # Tokens typically expire after ~7 days
                refreshed_at = datetime.datetime.fromisoformat(last_refresh.replace('Z', '+00:00'))
                age_days = (datetime.datetime.now(datetime.timezone.utc) - refreshed_at).days
                if age_days > 6:
                    return (
                        f'Codex CLI session expired ({age_days} days old). '
                        'Run `codex auth login` on the host to re-authenticate.'
                    )
            tokens = data.get('tokens', {})
            if not tokens.get('access_token'):
                return 'Codex CLI session missing access token. Run `codex auth login` on the host.'
        except Exception:
            pass
        return None

    def _ensure_codex_trust(self, repo_path: str) -> None:
        """Add repo_path to codex config.toml as trusted if not already present."""
        config_path = Path.home() / '.codex' / 'config.toml'
        if not config_path.exists() or not repo_path:
            return
        try:
            content = config_path.read_text()
            key = f'[projects."{repo_path}"]'
            if key not in content:
                addition = f'\n{key}\ntrust_level = "trusted"\n'
                config_path.write_text(content + addition)
                print(f'[bridge] Auto-trusted repo: {repo_path}')
        except Exception as e:
            print(f'[bridge] Could not update config.toml: {e}')

    def _run_claude(self, body: dict) -> dict:
        repo_path = body.get('repo_path', '')
        prompt = body.get('prompt', '')
        model = body.get('model', '')
        timeout = body.get('timeout', 300)

        claude_bin = self._which('claude')
        if not claude_bin:
            return {'status': 'error', 'message': 'claude binary not found on host'}

        cmd = [claude_bin, '--print', '--dangerously-skip-permissions']
        if model:
            cmd.extend(['--model', model])
        cmd.extend(['--prompt', prompt])

        try:
            result = subprocess.run(
                cmd, cwd=repo_path, capture_output=True, text=True,
                timeout=timeout, env={**os.environ, 'NO_COLOR': '1'},
            )
            return {
                'status': 'ok' if result.returncode == 0 else 'error',
                'stdout': result.stdout,
                'stderr': result.stderr,
                'returncode': result.returncode,
            }
        except subprocess.TimeoutExpired:
            return {'status': 'error', 'message': f'claude timed out after {timeout}s'}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}

    def _which(self, name: str) -> str | None:
        import shutil
        return shutil.which(name)

    def log_message(self, format, *args):
        print(f'[bridge] {args[0]}')


if __name__ == '__main__':
    print(f'CLI Bridge starting on port {PORT}...')
    import shutil
    print(f'  codex: {shutil.which("codex") or "NOT FOUND"}')
    print(f'  claude: {shutil.which("claude") or "NOT FOUND"}')
    server = HTTPServer(('0.0.0.0', PORT), BridgeHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nBridge stopped.')
