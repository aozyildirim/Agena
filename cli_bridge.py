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

        cmd = [codex_bin, '--quiet', '--full-auto']
        if model:
            cmd.extend(['--model', model])
        cmd.append(prompt)

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
            return {'status': 'error', 'message': f'codex timed out after {timeout}s'}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}

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
