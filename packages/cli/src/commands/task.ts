import { Command } from 'commander';
import { loadConfig, requireAuthed } from '../config';
import { api } from '../http';

interface TaskRow {
  id: number;
  title: string;
  status: string;
  source: string | null;
  created_at: string;
  assigned_to?: string | null;
  pr_url?: string | null;
  queue_position?: number | null;
}

interface TaskLog {
  id: number;
  stage: string;
  message: string;
  created_at: string;
}

const STATUS_DOT: Record<string, string> = {
  new: '⚪', queued: '🔵', running: '🟡',
  completed: '🟢', failed: '🔴', cancelled: '⚫',
};

export function taskCommand(): Command {
  const cmd = new Command('task').description('Manage and inspect tasks');

  cmd
    .command('list')
    .description('List recent tasks on the tenant')
    .option('-s, --status <s>', 'Filter by status (new, queued, running, completed, failed)')
    .option('-n, --limit <n>', 'How many to show', '20')
    .action(async (opts) => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg); if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      const rows = await api<TaskRow[]>(cfg, '/tasks');
      let filtered = rows;
      if (opts.status) filtered = filtered.filter((r) => r.status === opts.status);
      filtered = filtered.slice(0, Number(opts.limit) || 20);
      if (filtered.length === 0) { console.log('  No tasks.'); return; }
      console.log(`    ${pad('ID', 6)}  ${pad('STATUS', 10)}  ${pad('SOURCE', 10)}  TITLE`);
      console.log(`    ${'─'.repeat(70)}`);
      for (const t of filtered) {
        const dot = STATUS_DOT[t.status] || '⚪';
        console.log(`  ${dot} ${pad('#' + t.id, 5)}  ${pad(t.status, 10)}  ${pad(t.source || '-', 10)}  ${(t.title || '').slice(0, 60)}`);
      }
    });

  cmd
    .command('show')
    .description('Show a single task')
    .argument('<id>')
    .action(async (id) => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg); if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      const t = await api<TaskRow & { description?: string; branch_name?: string | null; total_tokens?: number | null }>(cfg, `/tasks/${id}`);
      console.log(`  ${STATUS_DOT[t.status] || '⚪'}  #${t.id}  ${t.title}`);
      console.log(`     status:    ${t.status}`);
      console.log(`     source:    ${t.source || '-'}`);
      console.log(`     created:   ${t.created_at}`);
      if (t.branch_name) console.log(`     branch:    ${t.branch_name}`);
      if (t.pr_url)      console.log(`     pr:        ${t.pr_url}`);
      if (t.total_tokens != null) console.log(`     tokens:    ${t.total_tokens}`);
      if (t.description) console.log(`\n  description:\n    ${t.description.slice(0, 800)}`);
    });

  cmd
    .command('logs')
    .description('Tail the log trail of a task')
    .argument('<id>')
    .option('-n, --lines <n>', 'Lines to print', '50')
    .action(async (id, opts) => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg); if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      const rows = await api<TaskLog[]>(cfg, `/tasks/${id}/logs`);
      const tail = rows.slice(-Number(opts.lines) || 50);
      for (const l of tail) {
        const t = new Date(l.created_at).toLocaleTimeString();
        console.log(`  ${t}  [${pad(l.stage, 10)}]  ${l.message.slice(0, 200)}`);
      }
    });

  cmd
    .command('create')
    .description('Create a new task')
    .requiredOption('-t, --title <title>', 'Task title')
    .option('-d, --description <desc>', 'Task description')
    .option('--assign', 'Enqueue immediately for an AI agent', false)
    .action(async (opts) => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg); if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      const created = await api<TaskRow>(cfg, '/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: opts.title, description: opts.description || '' }),
      });
      console.log(`  ✅ created #${created.id}`);
      if (opts.assign) {
        await api(cfg, `/tasks/${created.id}/assign`, {
          method: 'POST',
          body: JSON.stringify({ mode: 'mcp_agent', create_pr: true }),
        });
        console.log(`  ▶ queued for the AI agent`);
      }
    });

  return cmd;
}

function pad(s: string, w: number): string {
  const t = (s || '').toString();
  return t.length >= w ? t.slice(0, w) : t + ' '.repeat(w - t.length);
}
