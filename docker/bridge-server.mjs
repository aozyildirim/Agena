/**
 * CLI Bridge — HTTP server that runs codex/claude CLI for Docker workers.
 * Listens on port 9876.
 */
import { createServer } from 'http';
import { execFile, execSync, spawn } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, createReadStream, existsSync } from 'fs';
import { join } from 'path';

const execFileAsync = promisify(execFile);
const PORT = 9876;

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
    const codexAuth = existsSync('/root/.codex/auth.json') || !!process.env.OPENAI_API_KEY;
    const claudeAuth = existsSync('/root/.claude/.credentials.json') || existsSync('/root/.claude/credentials.json');
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
  } else if (url.pathname === '/claude/login') {
    result = await startLogin('claude');
  } else {
    res.writeHead(404);
    res.end();
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
});

async function runCLI(bin, name, data) {
  if (!bin) return { status: 'error', message: `${name} binary not found in container` };

  const { repo_path, prompt, model, timeout = 300 } = data;
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
    // Load API key from auth file if not in env
    let apiKey = process.env.OPENAI_API_KEY || '';
    if (!apiKey && name === 'codex') {
      try {
        const auth = JSON.parse(readFileSync('/root/.codex/auth.json', 'utf8'));
        apiKey = auth.api_key || auth.OPENAI_API_KEY || '';
      } catch {}
    }

    const result = await new Promise((resolve, reject) => {
      const proc = spawn(bin, args, {
        cwd: repo_path,
        env: { ...process.env, NO_COLOR: '1', NODE_EXTRA_CA_CERTS: '/etc/ssl/certs/ca-certificates.crt', ...(apiKey ? { OPENAI_API_KEY: apiKey } : {}) },
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
const loginProxies = {};

// Track callback port for proxying through bridge
let activeCallbackPort = 0;

async function startLogin(cli) {
  const bin = cli === 'codex' ? codexBin : claudeBin;
  if (!bin) return { status: 'error', message: `${cli} not installed` };

  // Kill previous login process
  if (loginProcesses[cli]) {
    try { loginProcesses[cli].kill(); } catch {}
    delete loginProcesses[cli];
  }

  return new Promise((resolve) => {
    let output = '';
    let loginUrl = '';
    const args = cli === 'codex' ? ['login'] : ['login'];

    console.log(`[${cli}] starting login: ${bin} ${args.join(' ')}`);
    const proc = spawn(bin, args, {
      env: { ...process.env, NO_COLOR: '1', BROWSER: 'echo' },
    });
    loginProcesses[cli] = proc;

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      console.log(`[${cli} login stdout] ${text.trim()}`);
      // Extract URL from output
      // Prefer https:// URLs over localhost
      const httpsMatch = text.match(/(https:\/\/[^\s]+)/);
      if (httpsMatch) { loginUrl = httpsMatch[1]; }
      else if (!loginUrl) { const httpMatch = text.match(/(http:\/\/[^\s]+)/); if (httpMatch) loginUrl = httpMatch[1]; }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      console.log(`[${cli} login stderr] ${text.trim()}`);
      // Prefer https:// URLs over localhost
      const httpsMatch = text.match(/(https:\/\/[^\s]+)/);
      if (httpsMatch) { loginUrl = httpsMatch[1]; }
      else if (!loginUrl) { const httpMatch = text.match(/(http:\/\/[^\s]+)/); if (httpMatch) loginUrl = httpMatch[1]; }
    });

    // Return URL as soon as found, start callback proxy
    let resolved = false;
    const checkUrl = setInterval(() => {
      if (resolved) return;
      if (loginUrl) {
        resolved = true;
        clearInterval(checkUrl);
        // Save callback port for proxying
        const portMatch = output.match(/localhost:(\d+)/);
        if (portMatch) {
          activeCallbackPort = parseInt(portMatch[1]);
          console.log(`[login] Callback port: ${activeCallbackPort}`);
        }
        // Don't rewrite URL — OpenAI only accepts registered redirect_uri
        // Instead, Docker must forward the callback port
        resolve({ status: 'ok', login_url: loginUrl, callback_port: activeCallbackPort, message: `Open this URL to login` });
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
      mkdirSync('/root/.codex', { recursive: true });
      writeFileSync('/root/.codex/auth.json', JSON.stringify({ api_key: api_key.trim() }));
      // Also set env for current process
      process.env.OPENAI_API_KEY = api_key.trim();
      console.log('[codex] API key saved');
      return { status: 'ok', message: 'Codex API key saved' };
    }

    if (cli === 'claude') {
      // Claude uses ~/.claude/.credentials.json
      mkdirSync('/root/.claude', { recursive: true });
      writeFileSync('/root/.claude/.credentials.json', JSON.stringify({
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
      const authPath = '/root/.codex/auth.json';
      if (existsSync(authPath)) unlinkSync(authPath);
      delete process.env.OPENAI_API_KEY;
      return { status: 'ok', message: 'Codex session cleared' };
    }

    if (cli === 'claude') {
      const paths = ['/root/.claude/.credentials.json', '/root/.claude/credentials.json'];
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
