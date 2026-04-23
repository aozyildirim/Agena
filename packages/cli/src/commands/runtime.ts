import { Command } from 'commander';
import { loadConfig, requireAuthed } from '../config';
import { api } from '../http';

interface RuntimeRow {
  id: number;
  name: string;
  kind: string;
  status: string;
  description: string | null;
  available_clis: string[];
  daemon_version: string | null;
  host: string | null;
  last_heartbeat_age_sec: number | null;
}

function fmtAge(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function dot(status: string): string {
  return status === 'active' ? '🟢' : status === 'disabled' ? '🔴' : '⚪';
}

export function runtimeCommand(): Command {
  const cmd = new Command('runtime').description('Inspect registered runtimes');

  cmd
    .command('list')
    .description('List all runtimes in this tenant')
    .action(async () => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg);
      if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      const rows = await api<RuntimeRow[]>(cfg, '/runtimes');
      if (rows.length === 0) {
        console.log('  No runtimes registered. Start the daemon with `agena daemon start`.');
        return;
      }
      const nameWidth = Math.max(4, ...rows.map((r) => r.name.length));
      const header = `  ${pad('', 2)}  ${pad('ID', 4)}  ${pad('NAME', nameWidth)}  ${pad('STATUS', 8)}  ${pad('KIND', 6)}  ${pad('HEARTBEAT', 10)}  CLIS`;
      console.log(header);
      console.log('  ' + '─'.repeat(header.length - 2));
      for (const r of rows) {
        const clis = r.available_clis.join(', ') || '—';
        console.log(`  ${dot(r.status)}  ${pad(String(r.id), 4)}  ${pad(r.name, nameWidth)}  ${pad(r.status, 8)}  ${pad(r.kind, 6)}  ${pad(fmtAge(r.last_heartbeat_age_sec), 10)}  ${clis}`);
      }
    });

  cmd
    .command('status')
    .description('Detail view for one runtime')
    .argument('<id>', 'Runtime ID (see `agena runtime list`)')
    .action(async (id) => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg);
      if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      const r = await api<RuntimeRow & { host: string | null; daemon_version: string | null }>(cfg, `/runtimes/${id}`);
      console.log(`  ${dot(r.status)}  #${r.id}  ${r.name}`);
      console.log(`     status:    ${r.status}`);
      console.log(`     kind:      ${r.kind}`);
      console.log(`     host:      ${r.host || '—'}`);
      console.log(`     version:   ${r.daemon_version || '—'}`);
      console.log(`     heartbeat: ${fmtAge(r.last_heartbeat_age_sec)} ago`);
      console.log(`     CLIs:      ${r.available_clis.join(', ') || '—'}`);
      if (r.description) console.log(`     notes:     ${r.description}`);
    });

  return cmd;
}

function pad(s: string, w: number): string {
  if (s.length >= w) return s;
  return s + ' '.repeat(w - s.length);
}
