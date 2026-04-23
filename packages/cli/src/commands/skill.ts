import { Command } from 'commander';
import { loadConfig, requireAuthed } from '../config';
import { api } from '../http';

interface Skill {
  id: number;
  name: string;
  pattern_type: string;
  tags: string[];
  touched_files: string[];
  approach_summary: string;
  prompt_fragment: string;
  usage_count: number;
  last_used_at: string | null;
  source_task_id: number | null;
  created_at: string;
}

interface SkillsPage { items: Skill[]; total: number; page: number; total_pages: number }

export function skillCommand(): Command {
  const cmd = new Command('skill').description('Inspect the team skill catalog');

  cmd
    .command('list')
    .description('List skills in the catalog')
    .option('-q, --query <q>', 'Search by name/description/tag')
    .option('-t, --type <t>', 'Filter by pattern type (fix-bug, refactor, ...)')
    .option('-n, --limit <n>', 'Page size', '30')
    .action(async (opts) => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg); if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      const params = new URLSearchParams({ page: '1', page_size: String(opts.limit || 30) });
      if (opts.query) params.set('q', opts.query);
      if (opts.type) params.set('pattern_type', opts.type);
      const data = await api<SkillsPage>(cfg, `/skills?${params.toString()}`);
      if (data.items.length === 0) { console.log('  No skills.'); return; }
      console.log(`  ${data.total} skill(s) — showing ${data.items.length}`);
      console.log(`    ${pad('ID', 5)}  ${pad('TYPE', 12)}  ${pad('USES', 5)}  NAME  [tags]`);
      console.log(`    ${'─'.repeat(70)}`);
      for (const s of data.items) {
        console.log(`    ${pad('#' + s.id, 5)}  ${pad(s.pattern_type, 12)}  ${pad(String(s.usage_count), 5)}  ${s.name}${s.tags.length ? `  [${s.tags.slice(0, 4).join(', ')}]` : ''}`);
      }
    });

  cmd
    .command('show')
    .description('Show a single skill in full')
    .argument('<id>')
    .action(async (id) => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg); if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      const s = await api<Skill>(cfg, `/skills/${id}`);
      console.log(`  #${s.id}  [${s.pattern_type}]  ${s.name}`);
      if (s.tags.length) console.log(`     tags:      ${s.tags.join(', ')}`);
      if (s.touched_files.length) console.log(`     files:     ${s.touched_files.join(', ')}`);
      console.log(`     uses:      ${s.usage_count}${s.last_used_at ? ` (last ${new Date(s.last_used_at).toLocaleString()})` : ''}`);
      if (s.source_task_id) console.log(`     from_task: #${s.source_task_id}`);
      if (s.approach_summary) console.log(`\n  approach:\n    ${s.approach_summary.slice(0, 900)}`);
      if (s.prompt_fragment)   console.log(`\n  prompt fragment (sent verbatim to agents):\n    ${s.prompt_fragment.slice(0, 900)}`);
    });

  cmd
    .command('search')
    .description('Vector-search the catalog for a task-like query')
    .argument('<title>', 'Task title to search for')
    .option('-d, --description <d>', 'Optional description for better matching')
    .option('-n, --limit <n>', 'Hits to return', '5')
    .action(async (title, opts) => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg); if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      const hits = await api<Array<{ id: number; name: string; score: number; tier: string; pattern_type: string }>>(cfg, '/skills/search', {
        method: 'POST',
        body: JSON.stringify({ title, description: opts.description || '', limit: Number(opts.limit) || 5 }),
      });
      if (hits.length === 0) { console.log('  No matches.'); return; }
      console.log(`    ${pad('ID', 5)}  ${pad('TIER', 8)}  ${pad('SCORE', 6)}  ${pad('TYPE', 12)}  NAME`);
      console.log(`    ${'─'.repeat(70)}`);
      for (const h of hits) {
        const pct = Math.round((h.score || 0) * 100);
        console.log(`    ${pad('#' + h.id, 5)}  ${pad(h.tier, 8)}  ${pad(`${pct}%`, 6)}  ${pad(h.pattern_type, 12)}  ${h.name}`);
      }
    });

  cmd
    .command('delete')
    .description('Delete a skill')
    .argument('<id>')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (id, opts) => {
      if (!opts.yes) {
        console.log(`  Use -y to confirm deletion of skill #${id}.`);
        return;
      }
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg); if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      await api(cfg, `/skills/${id}`, { method: 'DELETE' });
      console.log(`  deleted #${id}`);
    });

  return cmd;
}

function pad(s: string, w: number): string {
  const t = (s || '').toString();
  return t.length >= w ? t.slice(0, w) : t + ' '.repeat(w - t.length);
}
