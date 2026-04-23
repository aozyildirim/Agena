import { Command } from 'commander';
import { loginCommand } from './login';

// Convenience wrapper: `agena setup` == `agena login` followed by
// `agena daemon start`. Once the Go rewrite ships it'll also bootstrap
// the keychain entry and auto-detect existing daemons.
export function setupCommand(): Command {
  return new Command('setup')
    .description('Configure + authenticate + start the daemon in one step')
    .option('--backend-url <url>', 'Backend base URL', (v) => v, '')
    .option('--tenant-slug <slug>', 'Tenant slug', (v) => v, '')
    .option('--jwt <token>', 'Paste JWT directly (skips browser step)', (v) => v, '')
    .action(async (opts) => {
      // Delegate to login's handler
      const login = loginCommand();
      await login.parseAsync(
        [
          ...(opts.backendUrl ? ['--backend-url', opts.backendUrl] : []),
          ...(opts.tenantSlug ? ['--tenant-slug', opts.tenantSlug] : []),
          ...(opts.jwt ? ['--jwt', opts.jwt] : []),
        ],
        { from: 'user' },
      );
      // Invoke the daemon command's `start` via a fresh process so the
      // login config is picked up from disk.
      const { spawnSync } = await import('child_process');
      const binPath = require.resolve('../../bin/agena.js');
      const r = spawnSync(process.execPath, [binPath, 'daemon', 'start'], { stdio: 'inherit' });
      process.exit(r.status ?? 0);
    });
}
