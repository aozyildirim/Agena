import { exec } from 'child_process';
import * as readline from 'readline';
import { Command } from 'commander';
import { loadConfig, maskJwt, saveConfig } from '../config';
import { api } from '../http';

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface DeviceTokenResponse {
  access_token: string;
  token_type: string;
  tenant_slug: string;
  organization_id: number;
}

async function deviceCodeLogin(backendUrl: string): Promise<{ jwt: string; tenant_slug: string } | null> {
  // 1) Ask backend for a code pair
  let code: DeviceCodeResponse;
  try {
    const resp = await fetch(`${backendUrl.replace(/\/$/, '')}/auth/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'agena-cli' }),
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    code = await resp.json() as DeviceCodeResponse;
  } catch (err) {
    console.error(`\n  Could not start device code flow: ${err instanceof Error ? err.message : err}`);
    console.error('  Falling back to JWT paste flow.\n');
    return null;
  }

  console.log('\n  📋 Visit this URL and confirm the code:');
  console.log(`     ${code.verification_uri_complete}`);
  console.log(`\n  User code: ${code.user_code}\n`);
  tryOpen(code.verification_uri_complete);

  // 2) Poll until approved or timed out
  const deadline = Date.now() + code.expires_in * 1000;
  const interval = Math.max(2, code.interval) * 1000;
  process.stdout.write('  Waiting for approval');
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    process.stdout.write('.');
    try {
      const resp = await fetch(`${backendUrl.replace(/\/$/, '')}/auth/device/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: code.device_code }),
      });
      if (resp.status === 428) continue;  // still pending
      if (resp.status === 410) {
        console.error('\n  Code expired. Try again.');
        return null;
      }
      if (resp.status === 403) {
        console.error('\n  Access denied.');
        return null;
      }
      if (!resp.ok) {
        console.error(`\n  Poll failed: ${resp.status} ${resp.statusText}`);
        return null;
      }
      const token = await resp.json() as DeviceTokenResponse;
      process.stdout.write(' ✓\n');
      return { jwt: token.access_token, tenant_slug: token.tenant_slug };
    } catch {
      // transient; keep polling
    }
  }
  console.error('\n  Timed out waiting for approval.');
  return null;
}

// For now `agena login` opens the dashboard in the user's browser and
// asks them to paste their JWT (visible in `localStorage.auth_token`).
// A proper OAuth device-code flow lands with the Go rewrite — this is
// the minimum viable that unblocks CLI usage today.
export function loginCommand(): Command {
  return new Command('login')
    .description('Authenticate against an Agena backend')
    .option('--backend-url <url>', 'Backend base URL', (v) => v, '')
    .option('--tenant-slug <slug>', 'Tenant slug (organization)', (v) => v, '')
    .option('--jwt <token>', 'Paste JWT directly (skips browser step)', (v) => v, '')
    .option('--no-browser', 'Skip the browser-based device flow — prompts for JWT directly')
    .action(async (opts) => {
      const current = await loadConfig();
      const backendUrl = opts.backendUrl || current.backend_url || await prompt(`Backend URL [${current.backend_url || 'https://api.agena.dev'}]: `) || current.backend_url || 'https://api.agena.dev';
      let tenantSlug = opts.tenantSlug || current.tenant_slug || '';

      let jwt = opts.jwt;
      // Primary path: device-code OAuth. Skip if the user passed --jwt or --no-browser.
      if (!jwt && opts.browser !== false) {
        const device = await deviceCodeLogin(backendUrl);
        if (device) {
          jwt = device.jwt;
          tenantSlug = device.tenant_slug || tenantSlug;
        }
      }
      // Fallback: manual paste (still useful in CI / headless shells).
      if (!jwt) {
        if (!tenantSlug) {
          tenantSlug = await prompt(`Tenant slug [${current.tenant_slug || 'test-org'}]: `) || current.tenant_slug || 'test-org';
        }
        const dashboard = backendUrl.replace(/\/api$/, '').replace(':8010', ':3010');
        console.log('\n  Open your dashboard to grab the JWT:');
        console.log(`    ${dashboard}/dashboard`);
        console.log('  In DevTools console run: localStorage.getItem("auth_token")');
        console.log('  Copy the token, paste below.\n');
        tryOpen(`${dashboard}/dashboard`);
        jwt = await prompt('Paste JWT: ');
      }
      jwt = (jwt || '').trim();
      if (!jwt) {
        console.error('No JWT provided.');
        process.exit(1);
      }

      let saved;
      try {
        saved = await saveConfig({
          backend_url: backendUrl,
          tenant_slug: tenantSlug,
          jwt,
        });
      } catch (err) {
        console.error(`\n  ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
      // Re-read so jwt_source + keychain-backed jwt are populated.
      saved = await loadConfig();

      // Smoke-test the creds by calling something cheap.
      try {
        await api(saved, '/preferences');
        console.log(`\n  ✅ Logged in`);
        console.log(`     backend: ${saved.backend_url}`);
        console.log(`     tenant:  ${saved.tenant_slug}`);
        console.log(`     jwt:     ${maskJwt(saved.jwt)}  (stored in ${saved.jwt_source})`);
        console.log(`\n  Next: run \`agena daemon start\` to enroll this machine as a Runtime.\n`);
      } catch (err) {
        console.error(`\n  ⚠  Saved config but authentication check failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

async function prompt(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => rl.question(q, (ans) => { rl.close(); resolve(ans); }));
}

function tryOpen(url: string): void {
  const cmd = process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => { /* best-effort */ });
}
