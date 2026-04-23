import { Command } from 'commander';
import { loadConfig, requireAuthed } from '../config';
import { api } from '../http';

interface HistoryItem {
  external_id: string;
  title: string;
  story_points: number;
  assigned_to: string;
  sprint_name: string;
  completed_at: string;
}

interface BackfillStatus {
  status: string;
  indexed?: number;
  total?: number;
  processed?: number;
  message?: string;
  error?: string;
}

interface AnalyzeResponse {
  analyzed_count: number;
  total_items: number;
  estimated_cost_usd: number;
  results: Array<{
    item_id: string;
    title: string;
    suggested_story_points: number;
    confidence: number;
    error?: string | null;
  }>;
}

export function refinementCommand(): Command {
  const cmd = new Command('refinement').description('Sprint refinement — history-grounded story point estimation');

  cmd
    .command('history')
    .description('List indexed completed work items from the refinement catalog')
    .option('-n, --limit <n>', 'How many to show', '20')
    .option('--sp <sp>', 'Filter by exact story point count')
    .option('-q, --query <q>', 'Keyword filter')
    .action(async (opts) => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg); if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      const params = new URLSearchParams({ page: '1', page_size: String(opts.limit || 20), sort: 'recent' });
      if (opts.sp) params.set('sp', String(opts.sp));
      if (opts.query) params.set('q', opts.query);
      const resp = await api<{ items: HistoryItem[]; total: number }>(cfg, `/refinement/history/items?${params.toString()}`);
      if (resp.items.length === 0) { console.log('  No history indexed yet. Run `agena refinement backfill`.'); return; }
      console.log(`  ${resp.total} indexed — showing ${resp.items.length}`);
      console.log(`    ${pad('SP', 3)}  ${pad('ID', 8)}  ${pad('SPRINT', 16)}  ${pad('ASSIGNEE', 20)}  TITLE`);
      console.log(`    ${'─'.repeat(80)}`);
      for (const it of resp.items) {
        console.log(`    ${pad(String(it.story_points), 3)}  ${pad('#' + it.external_id, 8)}  ${pad((it.sprint_name || '-').slice(0, 16), 16)}  ${pad((it.assigned_to || '-').slice(0, 20), 20)}  ${it.title.slice(0, 60)}`);
      }
    });

  cmd
    .command('backfill-status')
    .description('Show the current backfill job progress')
    .action(async () => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg); if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      const s = await api<BackfillStatus>(cfg, '/refinement/history/backfill-status');
      console.log(`  status:    ${s.status}`);
      if (s.total != null)     console.log(`  progress:  ${s.processed || 0}/${s.total}  (indexed=${s.indexed || 0})`);
      if (s.message)           console.log(`  message:   ${s.message}`);
      if (s.error)             console.log(`  error:     ${s.error}`);
    });

  cmd
    .command('backfill')
    .description('Kick off a Qdrant backfill from Azure/Jira completed work items')
    .requiredOption('-p, --project <p>', 'Project key (Azure project name or Jira key)')
    .option('-t, --team <t>', 'Azure team (required for Azure to stay under 20k WIQL cap)')
    .option('-s, --source <s>', 'azure or jira', 'azure')
    .option('--days <n>', 'Look-back window in days', '730')
    .option('--max <n>', 'Max items to index', '5000')
    .action(async (opts) => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg); if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      await api(cfg, '/refinement/history/backfill', {
        method: 'POST',
        body: JSON.stringify({
          source: opts.source,
          project: opts.project,
          team: opts.team,
          since_days: Number(opts.days) || 730,
          max_items: Number(opts.max) || 5000,
        }),
      });
      console.log('  ▶ backfill started. Use `agena refinement backfill-status` to poll.');
    });

  cmd
    .command('analyze')
    .description('Run refinement analysis on a sprint')
    .requiredOption('-p, --project <p>', 'Project')
    .option('-t, --team <t>', 'Azure team')
    .option('--sprint-path <p>', 'Azure sprint path')
    .option('--board <id>', 'Jira board id')
    .option('--sprint-id <id>', 'Jira sprint id')
    .option('-s, --source <s>', 'azure or jira', 'azure')
    .option('-l, --language <l>', 'Output language', 'Turkish')
    .option('--agent-provider <p>', 'claude_cli, codex_cli, openai, gemini, hal', 'claude_cli')
    .option('--agent-model <m>', 'Model id', 'sonnet')
    .action(async (opts) => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg); if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      const payload: Record<string, unknown> = {
        provider: opts.source,
        language: opts.language,
        agent_provider: opts.agentProvider,
        agent_model: opts.agentModel,
        max_items: 20,
      };
      if (opts.source === 'azure') {
        payload.project = opts.project;
        payload.team = opts.team;
        payload.sprint_path = opts.sprintPath;
      } else {
        payload.board_id = opts.board;
        payload.sprint_id = opts.sprintId;
      }
      console.log('  ⏳ analyzing sprint... this can take a minute per item');
      const resp = await api<AnalyzeResponse>(cfg, '/refinement/analyze', { method: 'POST', body: JSON.stringify(payload) });
      console.log(`\n  Analyzed ${resp.analyzed_count}/${resp.total_items}  ($${(resp.estimated_cost_usd || 0).toFixed(3)})`);
      console.log(`    ${pad('ITEM', 10)}  ${pad('SP', 3)}  ${pad('CONF', 5)}  TITLE`);
      console.log(`    ${'─'.repeat(70)}`);
      for (const r of resp.results) {
        if (r.error) { console.log(`    #${r.item_id}  err  -      ${r.error.slice(0, 50)}`); continue; }
        console.log(`    ${pad('#' + r.item_id, 10)}  ${pad(String(r.suggested_story_points), 3)}  ${pad(`${r.confidence}%`, 5)}  ${r.title.slice(0, 55)}`);
      }
    });

  return cmd;
}

function pad(s: string, w: number): string {
  const t = (s || '').toString();
  return t.length >= w ? t.slice(0, w) : t + ' '.repeat(w - t.length);
}
