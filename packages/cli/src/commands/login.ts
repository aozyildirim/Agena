import { exec } from 'child_process';
import * as readline from 'readline';
import { Command } from 'commander';
import { loadConfig, maskJwt, saveConfig } from '../config';
import { api } from '../http';

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
    .action(async (opts) => {
      const current = await loadConfig();
      const backendUrl = opts.backendUrl || current.backend_url || await prompt(`Backend URL [${current.backend_url || 'https://api.agena.dev'}]: `) || current.backend_url || 'https://api.agena.dev';
      const tenantSlug = opts.tenantSlug || current.tenant_slug || await prompt(`Tenant slug [${current.tenant_slug || 'test-org'}]: `) || current.tenant_slug || 'test-org';

      let jwt = opts.jwt;
      if (!jwt) {
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
