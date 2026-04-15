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

async function detectClaudeAuth() {
  if (!claudeBin) return false;
  try {
    const { stdout } = await execFileAsync(claudeBin, ['auth', 'status', '--json'], {
      env: { ...process.env, NO_COLOR: '1' },
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const parsed = JSON.parse((stdout || '{}').trim() || '{}');
    return !!parsed.loggedIn;
  } catch {
    // Fallback for older/newer CLI variants
    return existsSync(`${HOME}/.claude/.credentials.json`) || existsSync(`${HOME}/.claude/credentials.json`);
  }
}

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Proxy auth callback to codex/claude login server
  if (req.method === 'GET' && url.pathname === '/auth/callback' && activeCallbackPort > 0) {
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

  let result;
  if (url.pathname === '/codex') {
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
  const { repo_path, prompt, model, timeout = 300 } = data;
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
    // Force Claude CLI to use OAuth session when available; stale API keys in env can cause 401.
    delete cliEnv.ANTHROPIC_API_KEY;
    delete cliEnv.CLAUDE_API_KEY;
  }

  const proc = spawn(bin, args, {
    cwd: repo_path,
    env: cliEnv,
  });

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

async function submitLoginCode(cli, data) {
  const code = String((data || {}).code || '').trim();
  if (!code) return { status: 'error', message: 'code is required' };
  const proc = loginProcesses[cli];
  if ((!proc || proc.killed) && cli === 'claude') {
    // Fallback: recover from lost in-memory session by running a fresh code-flow login.
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
      const writeTimer = setTimeout(() => { try { p.stdin.write(`${code}\n`); } catch {} }, 1200);
      const killTimer = setTimeout(() => {
        try { p.kill('SIGTERM'); } catch {}
        resolve({ status: 'error', message: 'Login timed out while submitting code' });
      }, 120000);
      p.on('close', async () => {
        clearTimeout(writeTimer);
        clearTimeout(killTimer);
        const authed = await detectClaudeAuth();
        if (authed) resolve({ status: 'ok', message: 'Code submitted. Login completed.' });
        else resolve({ status: 'error', message: (out || 'Code was not accepted').slice(-400) });
      });
    });
  }
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

  const { repo_path, prompt, model, timeout = 300 } = data;
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
    args = ['exec', '--skip-git-repo-check', '-C', repo_path, '--full-auto', '--sandbox', 'workspace-write'];
    if (model) args.push('-m', model);
    args.push('-o', promptFile + '.out');
    args.push('-');  // read prompt from stdin
  } else {
    args = ['--print', '--dangerously-skip-permissions'];
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

    const result = await new Promise((resolve, reject) => {
      const cliEnv = {
        ...process.env,
        NO_COLOR: '1',
        NODE_EXTRA_CA_CERTS: '/etc/ssl/certs/ca-certificates.crt',
        ...(apiKey ? { OPENAI_API_KEY: apiKey } : {}),
        ...(data.api_base_url ? { OPENAI_BASE_URL: data.api_base_url } : {}),
      };
      if (name === 'claude') {
        // Prefer interactive OAuth session; invalid env API keys produce auth 401.
        delete cliEnv.ANTHROPIC_API_KEY;
        delete cliEnv.CLAUDE_API_KEY;
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
      if (cli === 'claude') {
        // Claude login code flow requires a TTY; wrap with `script` to provide pseudo-tty in bridge mode.
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
          resolve({ status: 'ok', login_url: loginUrl, callback_port: activeCallbackPort, device_code: deviceCode || '', message: deviceCode ? `Enter code: ${deviceCode}` : `Open this URL to login` });
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
      // Claude uses ~/.claude/.credentials.json
      mkdirSync(`${HOME}/.claude`, { recursive: true });
      writeFileSync(`${HOME}/.claude/.credentials.json`, JSON.stringify({
        claudeAiOauth: { accessToken: api_key.trim(), expiresAt: '2099-01-01T00:00:00.000Z' }
      }));
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
      return { status: 'ok', message: 'Claude session cleared' };
    }

    return { status: 'error', message: `Unknown CLI: ${cli}` };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CLI Bridge ready on :${PORT}`);
});
