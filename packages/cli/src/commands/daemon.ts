import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Command } from 'commander';
import { loadConfig, requireAuthed } from '../config';

// The daemon is the existing docker/bridge-server.mjs. `agena daemon start`
// launches it with AGENA_JWT + AGENA_TENANT_SLUG + AGENA_BACKEND_URL
// pre-filled from ~/.agena/config.json, so auto-enrollment just works.
//
// PID is tracked in ~/.agena/daemon.pid so `stop` and `status` don't have
// to grep ps(1). This is best-effort — if the pid file is stale we fall
// back gracefully.

const PID_PATH = path.join(os.homedir(), '.agena', 'daemon.pid');
const LOG_PATH = path.join(os.homedir(), '.agena', 'daemon.log');

export function daemonCommand(): Command {
  const cmd = new Command('daemon').description('Manage the local CLI bridge daemon');

  cmd
    .command('start')
    .description('Start the CLI bridge (auto-enrolls this machine as a Runtime)')
    .option('--bridge <path>', 'Path to bridge-server.mjs', defaultBridgePath())
    .option('--port <port>', 'Port the bridge listens on', '9876')
    .option('--foreground', 'Run in the foreground instead of detaching')
    .action(async (opts) => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg);
      if (!gate.ok) {
        console.error(`  ${gate.reason}`);
        process.exit(1);
      }
      if (!fs.existsSync(opts.bridge)) {
        console.error(`  Bridge script not found at ${opts.bridge}`);
        console.error(`  Use --bridge to point at your local docker/bridge-server.mjs`);
        process.exit(1);
      }
      const running = runningPid();
      if (running) {
        console.log(`  Daemon already running (PID ${running}). Use \`agena daemon stop\` first.`);
        process.exit(0);
      }

      const env = {
        ...process.env,
        AGENA_JWT: cfg.jwt || '',
        AGENA_TENANT_SLUG: cfg.tenant_slug || '',
        AGENA_BACKEND_URL: cfg.backend_url || '',
        ...(cfg.runtime_name ? { AGENA_RUNTIME_NAME: cfg.runtime_name } : {}),
      };

      if (opts.foreground) {
        const child = spawn('node', [opts.bridge], { env, stdio: 'inherit' });
        child.on('exit', (code) => process.exit(code ?? 0));
        return;
      }

      if (!fs.existsSync(path.dirname(LOG_PATH))) fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
      const out = fs.openSync(LOG_PATH, 'a');
      const err = fs.openSync(LOG_PATH, 'a');
      const child: ChildProcess = spawn('node', [opts.bridge], {
        env,
        detached: true,
        stdio: ['ignore', out, err],
      });
      child.unref();
      fs.writeFileSync(PID_PATH, String(child.pid ?? ''));
      console.log(`  ✅ Daemon started (PID ${child.pid})`);
      console.log(`     bridge: ${opts.bridge}`);
      console.log(`     logs:   ${LOG_PATH}`);
      console.log(`     runtime will auto-enroll in ~2s`);
    });

  cmd
    .command('stop')
    .description('Stop the running daemon')
    .action(() => {
      const pid = runningPid();
      if (!pid) {
        console.log('  Daemon is not running.');
        return;
      }
      try {
        process.kill(pid, 'SIGTERM');
        fs.unlinkSync(PID_PATH);
        console.log(`  ✅ Sent SIGTERM to PID ${pid}`);
      } catch (err) {
        console.error(`  Could not stop PID ${pid}: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  cmd
    .command('status')
    .description('Show whether the daemon is running')
    .action(() => {
      const pid = runningPid();
      if (pid) {
        console.log(`  ✅ Daemon running (PID ${pid})`);
        console.log(`     logs: ${LOG_PATH}`);
      } else {
        console.log(`  ⚠  Daemon is not running. Start with \`agena daemon start\`.`);
      }
    });

  cmd
    .command('logs')
    .description('Tail the daemon log')
    .option('-n, --lines <n>', 'Lines to print', '50')
    .action((opts) => {
      if (!fs.existsSync(LOG_PATH)) {
        console.log('  No log file yet.');
        return;
      }
      const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n');
      const tail = lines.slice(Math.max(0, lines.length - Number(opts.lines) - 1)).join('\n');
      console.log(tail);
    });

  return cmd;
}

function runningPid(): number | null {
  try {
    const raw = fs.readFileSync(PID_PATH, 'utf8').trim();
    const pid = Number(raw);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    // Signal 0: check existence without actually signalling.
    try {
      process.kill(pid, 0);
      return pid;
    } catch {
      // Stale pid file.
      try { fs.unlinkSync(PID_PATH); } catch { /* ignore */ }
      return null;
    }
  } catch {
    return null;
  }
}

function defaultBridgePath(): string {
  // When installed via npm from a local checkout (npm install ../Agena),
  // the bridge lives next to the package. Otherwise users must pass
  // --bridge explicitly.
  const candidates = [
    path.resolve(__dirname, '../../../../docker/bridge-server.mjs'),
    path.resolve(process.cwd(), 'docker/bridge-server.mjs'),
    path.resolve(os.homedir(), '.agena/bridge-server.mjs'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[1];
}
