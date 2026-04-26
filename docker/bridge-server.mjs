/**
 * CLI Bridge — HTTP server that runs codex/claude CLI for Docker workers.
 * Listens on port 9876.
 */
import { createServer } from 'http';
import { execFile, execSync, spawn } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, createReadStream, existsSync } from 'fs';
import { join } from 'path';

import { homedir } from 'os';

const execFileAsync = promisify(execFile);
const PORT = 9876;
const HOME = homedir();

function findBin(name) {
  try {
    return execSync(`which ${name}`, { encoding: 'utf8' }).trim() || null;
  } catch { return null; }
}

const codexBin = findBin('codex');
const claudeBin = findBin('claude');

console.log(`CLI Bridge starting on port ${PORT}...`);
console.log(`  codex: ${codexBin || 'NOT FOUND'}`);
console.log(`  claude: ${claudeBin || 'NOT FOUND'}`);

// Track active stream processes by repo_path for cancellation
const activeStreams = new Map(); // repo_path → { proc, cli }

// Load saved API key from credentials file on startup (persists across container restarts)
try {
  const cred = JSON.parse(readFileSync(`${HOME}/.claude/.credentials.json`, 'utf8'));
  if (cred.claudeAiOauth?.accessToken && !process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = cred.claudeAiOauth.accessToken;
    console.log('  claude: loaded API key from credentials file');
  }
} catch {}

async function detectClaudeAuth() {
  if (!claudeBin) return false;
  // 1) CLI OAuth (keychain / native auth)
  try {
    const { stdout } = await execFileAsync(claudeBin, ['auth', 'status', '--json'], {
      env: { ...process.env, NO_COLOR: '1' },
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const parsed = JSON.parse((stdout || '{}').trim() || '{}');
    if (parsed.loggedIn) return true;
  } catch {}
  // 2) Credentials file (written by /claude/auth endpoint)
  for (const p of [`${HOME}/.claude/.credentials.json`, `${HOME}/.claude/credentials.json`]) {
    try {
      if (existsSync(p)) {
        const cred = JSON.parse(readFileSync(p, 'utf8'));
        if (cred.claudeAiOauth?.accessToken || cred.apiKey) return true;
      }
    } catch {}
  }
  // 3) Environment variable
  if (process.env.ANTHROPIC_API_KEY) return true;
  return false;
}

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Proxy auth callback to codex/claude login server (handle common OAuth callback paths)
  if (req.method === 'GET' && (url.pathname === '/auth/callback' || url.pathname === '/oauth/callback' || url.pathname === '/callback') && activeCallbackPort > 0) {
    const proxyUrl = `http://127.0.0.1:${activeCallbackPort}${url.pathname}${url.search}`;
    console.log(`[proxy] Forwarding callback to ${proxyUrl}`);
    try {
      const proxyReq = httpRequest(proxyUrl, { method: 'GET', timeout: 10000 }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', (e) => {
        console.log(`[proxy] Callback forward error: ${e.message}`);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Login tamamlandi!</h2><p>Bu sekmeyi kapatabilirsiniz.</p><script>window.close()</script></body></html>');
      });
      proxyReq.end();
    } catch {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h2>Login tamamlandi!</h2><p>Bu sekmeyi kapatabilirsiniz.</p></body></html>');
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    const codexAuth = existsSync(`${HOME}/.codex/auth.json`) || !!process.env.OPENAI_API_KEY;
    const claudeAuth = await detectClaudeAuth();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      codex: !!codexBin,
      claude: !!claudeBin,
      codex_auth: codexAuth,
      claude_auth: claudeAuth,
    }));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }

  let body = '';
  for await (const chunk of req) body += chunk;
  const data = JSON.parse(body || '{}');

  // Kill active stream by task_id (preferred) or repo_path
  if (url.pathname === '/kill-stream') {
    const { repo_path, task_id } = JSON.parse(body || '{}');
    const taskKey = task_id ? `task:${task_id}` : null;
    const entry = taskKey ? activeStreams.get(taskKey) : (repo_path ? activeStreams.get(repo_path) : null);
    if (entry) {
      try { entry.proc.kill('SIGTERM'); } catch {}
      // Also hard-kill after 2s if still alive
      setTimeout(() => { try { entry.proc.kill('SIGKILL'); } catch {} }, 2000);
      // Clean both keys if present
      if (entry.task_id) activeStreams.delete(`task:${entry.task_id}`);
      if (entry.repo_path) activeStreams.delete(entry.repo_path);
      if (taskKey) activeStreams.delete(taskKey);
      if (repo_path) activeStreams.delete(repo_path);
      console.log(`[kill] Killed ${entry.cli} stream (task_id=${entry.task_id || task_id || '-'}, repo=${entry.repo_path || repo_path || '-'})`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'killed', task_id: task_id || null, repo_path: repo_path || null }));
    } else if (!task_id && !repo_path) {
      // Kill all active streams if no selector provided
      let killed = 0;
      for (const [rp, e] of activeStreams) {
        try { e.proc.kill('SIGTERM'); killed++; } catch {}
        activeStreams.delete(rp);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: killed > 0 ? 'killed_all' : 'none_active', killed }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'not_found', task_id: task_id || null, repo_path: repo_path || null }));
    }
    return;
  }

  let result;
  if (url.pathname === '/codex/stream') {
    await runCodexStream(codexBin, data, res);
    return;
  } else if (url.pathname === '/codex') {
    result = await runCLI(codexBin, 'codex', data);
  } else if (url.pathname === '/claude/stream') {
    await runCLIStream(claudeBin, 'claude', data, res);
    return;
  } else if (url.pathname === '/claude') {
    result = await runCLI(claudeBin, 'claude', data);
  } else if (url.pathname === '/codex/auth') {
    result = await setAuth('codex', data);
  } else if (url.pathname === '/claude/auth') {
    result = await setAuth('claude', data);
  } else if (url.pathname === '/codex/logout') {
    result = await clearAuth('codex');
  } else if (url.pathname === '/claude/logout') {
    result = await clearAuth('claude');
  } else if (url.pathname === '/codex/login') {
    result = await startLogin('codex');
  } else if (url.pathname === '/codex/device-login') {
    result = await startLogin('codex', true);
  } else if (url.pathname === '/claude/login') {
    result = await startLogin('claude');
  } else if (url.pathname === '/claude/login/code') {
    result = await submitLoginCode('claude', data);
  } else {
    res.writeHead(404);
    res.end();
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
});

async function runCLIStream(bin, name, data, res) {
  if (!bin) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ type: 'error', message: `${name} binary not found` })}\n\n`);
    res.end();
    return;
  }
  const { repo_path, prompt, model, timeout = 300, task_id = '' } = data;
  if (repo_path && !existsSync(repo_path)) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ type: 'error', message: `repo path not found: ${repo_path}` })}\n\n`);
    res.end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Use --output-format stream-json for real-time streaming (requires --verbose)
  const args = ['--print', '--dangerously-skip-permissions', '--verbose', '--output-format', 'stream-json'];
  if (model) args.push('--model', model);
  args.push('-p', prompt.slice(0, 10000));

  console.log(`[${name} stream] running in ${repo_path} (model=${model || 'default'}, timeout=${timeout}s)`);

  const cliEnv = { ...process.env, NO_COLOR: '1', NODE_EXTRA_CA_CERTS: '/etc/ssl/certs/ca-certificates.crt' };
  if (name === 'claude') {
    // Prefer OAuth when available; otherwise keep API key for Docker environments without keychain
    let oauthOk = false;
    try {
      const { stdout } = await execFileAsync(claudeBin, ['auth', 'status', '--json'], {
        env: { ...process.env, NO_COLOR: '1' }, timeout: 3000, maxBuffer: 1024 * 1024,
      });
      oauthOk = !!JSON.parse((stdout || '{}').trim() || '{}').loggedIn;
    } catch {}
    if (oauthOk) {
      delete cliEnv.ANTHROPIC_API_KEY;
      delete cliEnv.CLAUDE_API_KEY;
    }
  }

  const proc = spawn(bin, args, {
    cwd: repo_path,
    env: cliEnv,
  });
  activeStreams.set(repo_path, { proc, cli: 'claude', task_id });
  if (task_id) activeStreams.set(`task:${task_id}`, { proc, cli: 'claude', repo_path, task_id });

  let fullText = '';
  let lineBuffer = '';

  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    lineBuffer += text;
    // stream-json outputs one JSON object per line
    while (lineBuffer.includes('\n')) {
      const idx = lineBuffer.indexOf('\n');
      const line = lineBuffer.slice(0, idx).trim();
      lineBuffer = lineBuffer.slice(idx + 1);
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        const eventType = event.type;
        // assistant message with content delta
        if (eventType === 'content_block_delta') {
          const delta = event.delta?.text || '';
          if (delta) {
            fullText += delta;
            res.write(`data: ${JSON.stringify({ type: 'text', text: delta })}\n\n`);
          }
        } else if (eventType === 'assistant') {
          // Full assistant message — extract text content
          const content = event.message?.content || [];
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              fullText += block.text;
              res.write(`data: ${JSON.stringify({ type: 'text', text: block.text })}\n\n`);
            } else if (block.type === 'tool_use') {
              const toolName = block.name || 'unknown';
              const toolInput = block.input || {};
              // Send tool usage info for live display
              let toolSummary = `[Tool: ${toolName}]`;
              if (toolName === 'Edit' || toolName === 'Write') {
                toolSummary = `[${toolName}: ${toolInput.file_path || toolInput.path || ''}]`;
              } else if (toolName === 'Read') {
                toolSummary = `[Read: ${toolInput.file_path || ''}]`;
              } else if (toolName === 'Bash') {
                const cmd = (toolInput.command || '').slice(0, 150);
                toolSummary = `[Bash: ${cmd}]`;
              } else if (toolName === 'Grep') {
                toolSummary = `[Grep: ${toolInput.pattern || ''}]`;
              }
              res.write(`data: ${JSON.stringify({ type: 'tool', tool: toolName, summary: toolSummary })}\n\n`);
            }
          }
        } else if (eventType === 'result') {
          // Final result
          const resultText = event.result || '';
          if (resultText && !fullText.includes(resultText.slice(0, 100))) {
            fullText += resultText;
          }
          res.write(`data: ${JSON.stringify({ type: 'result', text: resultText.slice(0, 500) })}\n\n`);
        } else {
          // Forward other events (system, tool_result, etc.) as-is for visibility
          res.write(`data: ${JSON.stringify({ type: 'event', event_type: eventType })}\n\n`);
        }
      } catch {
        // Not JSON — forward as raw line (fallback)
        if (line) {
          fullText += line + '\n';
          res.write(`data: ${JSON.stringify({ type: 'line', text: line })}\n\n`);
        }
      }
    }
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      res.write(`data: ${JSON.stringify({ type: 'stderr', text })}\n\n`);
    }
  });

  const timer = setTimeout(() => {
    proc.kill();
    res.write(`data: ${JSON.stringify({ type: 'error', message: `timed out after ${timeout}s` })}\n\n`);
    res.end();
  }, timeout * 1000);

  proc.on('close', (code) => {
    clearTimeout(timer);
    activeStreams.delete(repo_path);
    if (lineBuffer.trim()) {
      fullText += lineBuffer.trim();
      res.write(`data: ${JSON.stringify({ type: 'line', text: lineBuffer.trim() })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'done', code, stdout_length: fullText.length })}\n\n`);
    res.end();
  });

  proc.on('error', (e) => {
    clearTimeout(timer);
    res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
    res.end();
  });

  proc.stdin.end();
}

async function runCodexStream(bin, data, res) {
  if (!bin) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'codex binary not found' })}\n\n`);
    res.end();
    return;
  }
  const { repo_path, prompt, model, timeout = 1200, task_id = '' } = data;
  if (repo_path && !existsSync(repo_path)) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ type: 'error', message: `repo path not found: ${repo_path}` })}\n\n`);
    res.end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // codex exec with --json outputs JSONL events to stdout
  const args = ['exec', '--skip-git-repo-check', '-C', repo_path, '--full-auto', '--sandbox', 'workspace-write', '--json'];
  if (model) args.push('-m', model);
  args.push('-o', `/tmp/cli-bridge/codex-${Date.now()}.out`);
  args.push('-');  // read prompt from stdin

  console.log(`[codex stream] running in ${repo_path} (model=${model || 'default'}, timeout=${timeout}s)`);

  const proc = spawn(bin, args, {
    cwd: repo_path,
    env: { ...process.env, NO_COLOR: '1' },
  });
  activeStreams.set(repo_path, { proc, cli: 'codex', task_id });
  if (task_id) activeStreams.set(`task:${task_id}`, { proc, cli: 'codex', repo_path, task_id });

  let fullText = '';
  let lineBuffer = '';

  proc.stdout.on('data', (chunk) => {
    lineBuffer += chunk.toString();
    while (lineBuffer.includes('\n')) {
      const idx = lineBuffer.indexOf('\n');
      const line = lineBuffer.slice(0, idx).trim();
      lineBuffer = lineBuffer.slice(idx + 1);
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        const eventType = event.type || event.event;
        if (eventType === 'message' && event.role === 'assistant') {
          const content = event.content || '';
          if (content) {
            fullText += content;
            res.write(`data: ${JSON.stringify({ type: 'text', text: content })}\n\n`);
          }
        } else if (eventType === 'item.started') {
          const item = event.item || {};
          if (item.type === 'command_execution') {
            const cmd = (item.command || '').slice(0, 200);
            res.write(`data: ${JSON.stringify({ type: 'tool', tool: 'Bash', summary: `[Bash: ${cmd}]` })}\n\n`);
          } else if (item.type === 'file_edit' || item.type === 'file_write') {
            const path = item.path || item.file || '';
            res.write(`data: ${JSON.stringify({ type: 'tool', tool: item.type, summary: `[${item.type}: ${path}]` })}\n\n`);
          } else if (item.type === 'file_read') {
            const path = item.path || item.file || '';
            res.write(`data: ${JSON.stringify({ type: 'tool', tool: 'Read', summary: `[Read: ${path}]` })}\n\n`);
          }
        } else if (eventType === 'item.completed') {
          const item = event.item || {};
          const text = item.text || '';
          if (text && item.type === 'agent_message') {
            fullText += text;
            res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
          }
          if (item.type === 'command_execution') {
            const output = (item.aggregated_output || '').slice(0, 500);
            const code = item.exit_code;
            res.write(`data: ${JSON.stringify({ type: 'event', event_type: 'tool_result', exit_code: code, output_preview: output.slice(0, 200) })}\n\n`);
            if (text) {
              fullText += text;
              res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
            }
          }
        } else if (eventType === 'function_call' || eventType === 'tool_call') {
          const name = event.name || event.function?.name || 'tool';
          const toolArgs = event.arguments || event.function?.arguments || '';
          let summary = `[Tool: ${name}]`;
          try {
            const parsed = JSON.parse(toolArgs);
            if (parsed.command) summary = `[Bash: ${String(parsed.command).slice(0, 150)}]`;
            else if (parsed.path) summary = `[${name}: ${parsed.path}]`;
          } catch {}
          res.write(`data: ${JSON.stringify({ type: 'tool', tool: name, summary })}\n\n`);
        } else if (eventType === 'function_call_output' || eventType === 'tool_result') {
          res.write(`data: ${JSON.stringify({ type: 'event', event_type: 'tool_result' })}\n\n`);
        } else if (eventType === 'error' || eventType === 'turn.failed') {
          const errMsg = event.message || event.error?.message || event.error || 'unknown error';
          res.write(`data: ${JSON.stringify({ type: 'error', message: String(errMsg).slice(0, 500) })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ type: 'event', event_type: eventType || 'unknown' })}\n\n`);
        }
      } catch {
        if (line) {
          fullText += line + '\n';
          res.write(`data: ${JSON.stringify({ type: 'line', text: line })}\n\n`);
        }
      }
    }
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      // Surface unsupported model errors as proper error events
      if (text.includes('is not supported when using') || text.includes('ERROR:')) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: text.slice(0, 500) })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ type: 'stderr', text })}\n\n`);
    }
  });

  // Pipe prompt to stdin
  const promptText = prompt || '';
  proc.stdin.write(promptText);
  proc.stdin.end();

  const timer = setTimeout(() => {
    proc.kill();
    res.write(`data: ${JSON.stringify({ type: 'error', message: `timed out after ${timeout}s` })}\n\n`);
    res.end();
  }, timeout * 1000);

  proc.on('close', (code) => {
    clearTimeout(timer);
    if (lineBuffer.trim()) {
      fullText += lineBuffer.trim();
      res.write(`data: ${JSON.stringify({ type: 'line', text: lineBuffer.trim() })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'done', code, stdout_length: fullText.length })}\n\n`);
    res.end();
    activeStreams.delete(repo_path);
    console.log(`[codex stream] done — ${fullText.length} chars output`);
  });

  proc.on('error', (e) => {
    clearTimeout(timer);
    res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
    res.end();
  });
}

async function submitLoginCode(cli, data) {
  const raw = String((data || {}).code || '').trim();
  // Accept URL pasted variants. If raw token is pasted (including #state), keep it as-is.
  let code = raw;
  if (raw.includes('code=')) {
    try {
      const u = new URL(raw);
      code = (u.searchParams.get('code') || raw).trim();
    } catch {
      const m = raw.match(/[?&]code=([^&#]+)/);
      if (m) code = decodeURIComponent(m[1]);
    }
  }
  code = code.trim();
  if (!code) return { status: 'error', message: 'code is required' };

  if (cli === 'claude') {
    const active = loginProcesses[cli];
    // Prefer submitting code to the currently active login process.
    if (active && !active.killed && active.exitCode == null) {
      try {
        active.stdin.write(`${code}\n`);
        return { status: 'ok', message: 'Code submitted. Completing login...' };
      } catch {}
    }
    // Fallback to setup-token flow when no active session exists.
    if (!claudeBin) return { status: 'error', message: 'claude not installed' };
    const stripAnsi = (s) => (s || '')
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1B\][^\x07]*(\x07|\x1B\\)/g, '');
    return await new Promise((resolve) => {
      const p = spawn('script', ['-qec', `${claudeBin} setup-token`, '/dev/null'], {
        env: { ...process.env, NO_COLOR: '1', BROWSER: 'echo' },
      });
      let out = '';
      p.stdout.on('data', (d) => { out += stripAnsi(String(d)); });
      p.stderr.on('data', (d) => { out += stripAnsi(String(d)); });
      // Prompt timing varies; retry code submission a few times.
      let attempts = 0;
      const writer = setInterval(() => {
        attempts += 1;
        try { p.stdin.write(`${code}\n`); } catch {}
        if (attempts >= 8) clearInterval(writer);
      }, 1500);
      const killTimer = setTimeout(() => {
        try { p.kill('SIGTERM'); } catch {}
        resolve({ status: 'error', message: 'Login timed out while submitting code' });
      }, 35000);
      p.on('close', async () => {
        clearInterval(writer);
        clearTimeout(killTimer);
        const authed = await detectClaudeAuth();
        if (authed) resolve({ status: 'ok', message: 'Code submitted. Login completed.' });
        else resolve({ status: 'error', message: (out || 'Code was not accepted').slice(-400) });
      });
    });
  }

  const proc = loginProcesses[cli];
  if (!proc || proc.killed) {
    return { status: 'error', message: 'No active login session. Start login first.' };
  }
  try {
    proc.stdin.write(`${code}\n`);
    return { status: 'ok', message: 'Code submitted. Completing login...' };
  } catch (e) {
    return { status: 'error', message: e?.message || 'Failed to submit code' };
  }
}

async function runCLI(bin, name, data) {
  if (!bin) return { status: 'error', message: `${name} binary not found in container` };

  const { repo_path, prompt, model, timeout = 300, read_only = false } = data;
  // Validate repo path exists before spawning — otherwise Node gives a misleading ENOENT on the binary
  if (repo_path && !existsSync(repo_path)) {
    return { status: 'error', message: `repo path not found: ${repo_path}` };
  }
  // Write prompt to temp file to avoid E2BIG (arg too long)
  mkdirSync('/tmp/cli-bridge', { recursive: true });
  const promptFile = join('/tmp/cli-bridge', `${name}-${Date.now()}.txt`);
  writeFileSync(promptFile, prompt);

  // createReadStream already imported at top
  let args;
  if (name === 'codex') {
    // read_only flips the sandbox from workspace-write to read-only so
    // refinement-style analysis runs can't accidentally edit files.
    const sandbox = read_only ? 'read-only' : 'workspace-write';
    args = ['exec', '--skip-git-repo-check', '-C', repo_path, '--full-auto', '--sandbox', sandbox];
    if (model) args.push('-m', model);
    args.push('-o', promptFile + '.out');
    args.push('-');  // read prompt from stdin
  } else {
    if (read_only) {
      // Whitelist read-style tools only. Drop --dangerously-skip-permissions
      // so writes get refused even if the prompt asks for them.
      args = ['--print', '--allowedTools', 'Read,Grep,Glob,Bash(git:*),WebFetch'];
    } else {
      args = ['--print', '--dangerously-skip-permissions'];
    }
    if (model) args.push('--model', model);
    args.push('-p', prompt.slice(0, 10000));  // claude --prompt has limits, use shorter
  }

  console.log(`[${name}] running in ${repo_path} (model=${model || 'default'}, timeout=${timeout}s, prompt=${prompt.length} chars)`);

  try {
    // Use spawn for stdin piping
    // Load API key: payload > env > auth file
    let apiKey = data.api_key || process.env.OPENAI_API_KEY || '';
    if (!apiKey && name === 'codex') {
      try {
        const auth = JSON.parse(readFileSync(`${HOME}/.codex/auth.json`, 'utf8'));
        apiKey = auth.api_key || auth.OPENAI_API_KEY || '';
      } catch {}
    }

    // Check OAuth status before entering the Promise to avoid async-in-sync issues
    let claudeOauthOk = false;
    if (name === 'claude') {
      try {
        const { stdout: authOut } = await execFileAsync(claudeBin, ['auth', 'status', '--json'], {
          env: { ...process.env, NO_COLOR: '1' }, timeout: 3000, maxBuffer: 1024 * 1024,
        });
        claudeOauthOk = !!JSON.parse((authOut || '{}').trim() || '{}').loggedIn;
      } catch {}
    }

    const result = await new Promise((resolve, reject) => {
      const cliEnv = {
        ...process.env,
        NO_COLOR: '1',
        NODE_EXTRA_CA_CERTS: '/etc/ssl/certs/ca-certificates.crt',
        ...(apiKey ? { OPENAI_API_KEY: apiKey } : {}),
        ...(data.api_base_url ? { OPENAI_BASE_URL: data.api_base_url } : {}),
      };
      if (name === 'claude') {
        // Prefer OAuth when available; otherwise keep API key for Docker environments without keychain
        if (claudeOauthOk) {
          delete cliEnv.ANTHROPIC_API_KEY;
          delete cliEnv.CLAUDE_API_KEY;
        }
      }

      const proc = spawn(bin, args, {
        cwd: repo_path,
        env: cliEnv,
      });
      let stdout = '', stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      // Pipe prompt file to stdin for codex
      if (name === 'codex') {
        const stream = createReadStream(promptFile);
        stream.pipe(proc.stdin);
        stream.on('end', () => proc.stdin.end());
      } else {
        proc.stdin.end();
      }

      const timer = setTimeout(() => { proc.kill(); reject(new Error(`${name} timed out after ${timeout}s`)); }, timeout * 1000);
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (name === 'codex') {
          // Read output file
          try {
            const outContent = readFileSync(promptFile + '.out', 'utf8');
            if (outContent.trim()) stdout = outContent;
          } catch {}
        }
        resolve({ stdout, stderr, code });
      });
      proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    console.log(`[${name}] done — ${result.stdout.length} chars output`);
    try { unlinkSync(promptFile); } catch {}
    return { status: result.code === 0 ? 'ok' : 'error', stdout: result.stdout, stderr: result.stderr };
  } catch (e) {
    console.log(`[${name}] error: ${e.message.slice(0, 200)}`);
    try { unlinkSync(promptFile); } catch {}
    return { status: 'error', message: e.message, stderr: e.stderr || '', stdout: e.stdout || '' };
  }
}

import { createConnection, createServer as createTcpServer } from 'net';
import { request as httpRequest } from 'http';

// Active login processes and proxies
const loginProcesses = {};
const loginState = {};
const loginProxies = {};

// Track callback port for proxying through bridge
let activeCallbackPort = 0;

async function startLogin(cli, deviceAuth = false) {
  const bin = cli === 'codex' ? codexBin : claudeBin;
  if (!bin) return { status: 'error', message: `${cli} not installed` };

  // Reuse active login process to avoid resetting state/code challenge.
  const active = loginProcesses[cli];
  if (active && !active.killed && active.exitCode == null) {
    const st = loginState[cli] || {};
    return {
      status: 'ok',
      already_started: true,
      login_url: st.login_url || '',
      callback_port: activeCallbackPort,
      device_code: st.device_code || '',
      message: 'Login already in progress. Continue with the same code/session.',
    };
  }

  return new Promise((resolve) => {
    let output = '';
    let loginUrl = '';
    let deviceCode = '';
    const args = cli === 'codex'
      ? (deviceAuth ? ['login', '--device-auth'] : ['login'])
      : ['auth', 'login'];

    const spawnLogin = () => {
      let proc;
      if (cli === 'claude' && args[0] === 'setup-token') {
        // setup-token flow requires a TTY.
        const cmd = `${bin} ${args.join(' ')}`;
        console.log(`[${cli}] starting login (pty): script -qec "${cmd}" /dev/null`);
        proc = spawn('script', ['-qec', cmd, '/dev/null'], {
          env: { ...process.env, NO_COLOR: '1', BROWSER: 'echo' },
        });
      } else {
        console.log(`[${cli}] starting login: ${bin} ${args.join(' ')}`);
        proc = spawn(bin, args, {
          env: { ...process.env, NO_COLOR: '1', BROWSER: 'echo' },
        });
      }
      loginProcesses[cli] = proc;
      return proc;
    };

    const startAfterReset = async () => {
      // Claude can report loggedIn=true while token is stale; force clean re-login.
      if (cli === 'claude') {
        try {
          await execFileAsync(bin, ['auth', 'logout'], { env: { ...process.env, NO_COLOR: '1' }, timeout: 10000 });
        } catch {}
        for (const p of [`${HOME}/.claude/.credentials.json`, `${HOME}/.claude/credentials.json`]) {
          try { if (existsSync(p)) unlinkSync(p); } catch {}
        }
      }
      return spawnLogin();
    };

    let proc;

    function parseOutput(text) {
      // Strip ANSI escape/control sequences
      const clean = text
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1B\][^\x07]*(\x07|\x1B\\)/g, '');
      output += clean;
      console.log(`[${cli} login] ${clean.trim()}`);
      // Extract OAuth authorize URL reliably.
      const compact = clean.replace(/\s+/g, '');
      const oauthMatch = compact.match(/(https:\/\/[^ ]*oauth\/authorize[^ ]*)/i)
        || compact.match(/(https:\/\/[^ ]*\/cai\/oauth\/authorize[^ ]*)/i);
      if (oauthMatch) {
        loginUrl = oauthMatch[1].split('Pastecodehereifprompted')[0];
        loginState[cli] = { ...(loginState[cli] || {}), login_url: loginUrl };
      }
      else if (!loginUrl) {
        const httpsMatch = clean.match(/(https:\/\/[^\s]+)/);
        if (httpsMatch) loginUrl = httpsMatch[1];
      }
      // Extract device code (e.g. "XINP-1N30B" — alphanumeric with dash)
      const codeMatch = clean.match(/^\s+([A-Z0-9]{4,5}-[A-Z0-9]{4,5})\s*$/m);
      if (codeMatch) {
        deviceCode = codeMatch[1].trim();
        loginState[cli] = { ...(loginState[cli] || {}), device_code: deviceCode };
      }
    }

    Promise.resolve(startAfterReset()).then((p) => {
      proc = p;
      proc.stdout.on('data', (chunk) => parseOutput(chunk.toString()));
      proc.stderr.on('data', (chunk) => parseOutput(chunk.toString()));

      // Return URL as soon as found, start callback proxy
      let resolved = false;
      const checkUrl = setInterval(() => {
        if (resolved) return;
        if (loginUrl) {
          // For device auth, wait a bit longer for the device code to appear
          if (deviceAuth && !deviceCode) return;
          resolved = true;
          clearInterval(checkUrl);
          // Save callback port for proxying
          const portMatch = output.match(/(?:localhost|127\.0\.0\.1):(\d+)/);
          if (portMatch) {
            activeCallbackPort = parseInt(portMatch[1]);
            console.log(`[login] Callback port: ${activeCallbackPort}`);
          }
          // Rewrite OAuth URL to route callback through bridge port (9876)
          // so the browser redirect reaches the bridge even inside Docker.
          // The bridge proxies /auth/callback to the internal CLI port.
          let resolvedUrl = loginUrl;
          if (activeCallbackPort > 0 && activeCallbackPort !== PORT) {
            resolvedUrl = loginUrl
              .replace(`localhost%3A${activeCallbackPort}`, `localhost%3A${PORT}`)
              .replace(`localhost:${activeCallbackPort}`, `localhost:${PORT}`)
              .replace(`127.0.0.1%3A${activeCallbackPort}`, `127.0.0.1%3A${PORT}`)
              .replace(`127.0.0.1:${activeCallbackPort}`, `127.0.0.1:${PORT}`);
            if (resolvedUrl !== loginUrl) {
              console.log(`[login] Rewrote callback port ${activeCallbackPort} → ${PORT} in OAuth URL`);
            }
          }
          resolve({ status: 'ok', login_url: resolvedUrl, callback_port: activeCallbackPort, device_code: deviceCode || '', message: deviceCode ? `Enter code: ${deviceCode}` : `Open this URL to login` });
        }
      }, 500);

      // Timeout after 15 seconds if no URL found
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        clearInterval(checkUrl);
        if (output.includes('Already logged in') || output.includes('authenticated')) {
          resolve({ status: 'ok', message: 'Already logged in', already_auth: true });
        } else {
          resolve({ status: 'pending', output: output.trim(), message: 'Login started but no URL found' });
        }
      }, 15000);

      proc.on('close', (code) => {
        console.log(`[${cli} login] exited with code ${code}`);
        delete loginProcesses[cli];
        delete loginState[cli];
        if (!resolved) {
          resolved = true;
          clearInterval(checkUrl);
          if (code === 0) {
            resolve({ status: 'ok', message: 'Login completed successfully', already_auth: true });
          } else {
            resolve({ status: 'error', message: output.trim() || `Login exited with code ${code}` });
          }
        }
      });
    }).catch((e) => {
      resolve({ status: 'error', message: e?.message || 'Failed to start login' });
    });
  });
}

async function setAuth(cli, data) {
  // writeFileSync, mkdirSync already imported at top
  const { api_key } = data;

  if (!api_key || !api_key.trim()) {
    return { status: 'error', message: 'api_key is required' };
  }

  try {
    if (cli === 'codex') {
      // Codex uses OPENAI_API_KEY env or ~/.codex/auth.json
      mkdirSync(`${HOME}/.codex`, { recursive: true });
      writeFileSync(`${HOME}/.codex/auth.json`, JSON.stringify({ api_key: api_key.trim() }));
      // Also set env for current process
      process.env.OPENAI_API_KEY = api_key.trim();
      console.log('[codex] API key saved');
      return { status: 'ok', message: 'Codex API key saved' };
    }

    if (cli === 'claude') {
      // Claude uses ~/.claude/.credentials.json + ANTHROPIC_API_KEY env
      mkdirSync(`${HOME}/.claude`, { recursive: true });
      const key = api_key.trim();
      writeFileSync(`${HOME}/.claude/.credentials.json`, JSON.stringify({
        claudeAiOauth: { accessToken: key, expiresAt: '2099-01-01T00:00:00.000Z' }
      }));
      process.env.ANTHROPIC_API_KEY = key;
      console.log('[claude] API key saved');
      return { status: 'ok', message: 'Claude API key saved' };
    }

    return { status: 'error', message: `Unknown CLI: ${cli}` };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

async function clearAuth(cli) {
  try {
    if (cli === 'codex') {
      const authPath = `${HOME}/.codex/auth.json`;
      if (existsSync(authPath)) unlinkSync(authPath);
      delete process.env.OPENAI_API_KEY;
      return { status: 'ok', message: 'Codex session cleared' };
    }

    if (cli === 'claude') {
      // Ask CLI to clean its own auth state first (keychain/files), then remove known local files.
      if (claudeBin) {
        try {
          await execFileAsync(claudeBin, ['auth', 'logout'], { env: { ...process.env, NO_COLOR: '1' }, timeout: 10000 });
        } catch {}
      }
      const paths = [`${HOME}/.claude/.credentials.json`, `${HOME}/.claude/credentials.json`];
      for (const p of paths) {
        if (existsSync(p)) unlinkSync(p);
      }
      delete process.env.ANTHROPIC_API_KEY;
      return { status: 'ok', message: 'Claude session cleared' };
    }

    return { status: 'error', message: `Unknown CLI: ${cli}` };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

// -----------------------------------------------------------------------
// Agena runtime registration (opt-in via env vars).
//
// On startup, if AGENA_JWT + AGENA_TENANT_SLUG are set, the bridge
// enrolls itself as a Runtime on the backend and starts heartbeating
// every 30s. The returned runtime_token is persisted to
// ~/.agena/runtime.json so restarts are idempotent.
// -----------------------------------------------------------------------
const AGENA_BACKEND_URL = process.env.AGENA_BACKEND_URL || 'http://localhost:8010';
const AGENA_JWT = process.env.AGENA_JWT || '';
const AGENA_TENANT_SLUG = process.env.AGENA_TENANT_SLUG || '';
const AGENA_RUNTIME_NAME = process.env.AGENA_RUNTIME_NAME
  || `${process.env.USER || 'user'}'s ${process.platform === 'darwin' ? 'mac' : process.platform}`;
const AGENA_CONFIG_DIR = join(HOME, '.agena');
const AGENA_RUNTIME_FILE = join(AGENA_CONFIG_DIR, 'runtime.json');

function loadPersistedRuntime() {
  try {
    return JSON.parse(readFileSync(AGENA_RUNTIME_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function persistRuntime(obj) {
  try {
    if (!existsSync(AGENA_CONFIG_DIR)) mkdirSync(AGENA_CONFIG_DIR, { recursive: true });
    writeFileSync(AGENA_RUNTIME_FILE, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.warn('  agena: could not persist runtime config:', err.message);
  }
}

function availableClisNow() {
  return [
    claudeBin ? 'claude' : null,
    codexBin ? 'codex' : null,
  ].filter(Boolean);
}

async function agenaRegister() {
  if (!AGENA_JWT || !AGENA_TENANT_SLUG) {
    console.log('  agena: skipping auto-register (set AGENA_JWT + AGENA_TENANT_SLUG to enable)');
    return null;
  }
  try {
    const body = {
      name: AGENA_RUNTIME_NAME,
      kind: 'local',
      available_clis: availableClisNow(),
      daemon_version: 'bridge-0.1',
      host: `${process.platform}@localhost`,
      description: 'Host CLI bridge (auto-registered)',
    };
    const resp = await fetch(`${AGENA_BACKEND_URL}/runtimes/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AGENA_JWT}`,
        'X-Tenant-Slug': AGENA_TENANT_SLUG,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.warn(`  agena: register failed ${resp.status}: ${text.slice(0, 200)}`);
      return null;
    }
    const data = await resp.json();
    persistRuntime({
      runtime_id: data.runtime_id,
      name: data.name,
      token: data.auth_token,
      tenant_slug: AGENA_TENANT_SLUG,
      backend_url: AGENA_BACKEND_URL,
      registered_at: new Date().toISOString(),
    });
    console.log(`  agena: registered as runtime #${data.runtime_id} (${data.name})`);
    return data;
  } catch (err) {
    console.warn('  agena: register crashed:', err.message);
    return null;
  }
}

async function agenaHeartbeat(runtimeId, token) {
  try {
    const resp = await fetch(`${AGENA_BACKEND_URL}/runtimes/${runtimeId}/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Runtime-Token': token,
      },
      body: JSON.stringify({
        available_clis: availableClisNow(),
        daemon_version: 'bridge-0.1',
        host: `${process.platform}@localhost`,
      }),
    });
    if (!resp.ok) {
      console.warn(`  agena: heartbeat failed ${resp.status}`);
    }
  } catch (err) {
    console.warn('  agena: heartbeat crashed:', err.message);
  }
}

async function bootAgenaAutoRegister() {
  // Prefer a freshly-registered record; fall back to persisted one.
  let runtime = await agenaRegister();
  if (!runtime) {
    const saved = loadPersistedRuntime();
    if (saved && saved.runtime_id && saved.token) {
      runtime = { runtime_id: saved.runtime_id, auth_token: saved.token };
      console.log(`  agena: using persisted runtime #${saved.runtime_id}`);
    }
  }
  if (!runtime) return;
  // Fire immediately + every 30s.
  const tick = () => agenaHeartbeat(runtime.runtime_id, runtime.auth_token);
  tick();
  setInterval(tick, 30_000);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CLI Bridge ready on :${PORT}`);
  void bootAgenaAutoRegister();
});
