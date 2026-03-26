/**
 * CLI Bridge — HTTP server that runs codex/claude CLI for Docker workers.
 * Listens on port 9876.
 */
import { createServer } from 'http';
import { execFile, execSync, spawn } from 'child_process';
import { promisify } from 'util';

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
    const { existsSync } = await import('fs');
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
  let args;

  if (name === 'codex') {
    args = ['--quiet', '--full-auto'];
    if (model) args.push('--model', model);
    args.push(prompt);
  } else {
    args = ['--print', '--dangerously-skip-permissions'];
    if (model) args.push('--model', model);
    args.push('--prompt', prompt);
  }

  console.log(`[${name}] running in ${repo_path} (model=${model || 'default'}, timeout=${timeout}s)`);

  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd: repo_path,
      timeout: timeout * 1000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' },
    });
    console.log(`[${name}] done — ${stdout.length} chars output`);
    return { status: 'ok', stdout, stderr };
  } catch (e) {
    console.log(`[${name}] error: ${e.message.slice(0, 200)}`);
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
  const { writeFileSync, mkdirSync } = await import('fs');
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CLI Bridge ready on :${PORT}`);
});
