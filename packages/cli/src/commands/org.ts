import { Command } from 'commander';
import { loadConfig, requireAuthed, saveConfig } from '../config';
import { api } from '../http';

interface Me {
  organizations?: Array<{ id: number; slug: string; name: string; role?: string }>;
}

export function orgCommand(): Command {
  const cmd = new Command('org').description('Organization (tenant) management');

  cmd
    .command('list')
    .description('List organizations you belong to')
    .action(async () => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg);
      if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      const me = await api<Me>(cfg, '/auth/me');
      const orgs = me.organizations || [];
      if (orgs.length === 0) {
        console.log('  No organizations.');
        return;
      }
      const nameW = Math.max(4, ...orgs.map((o) => (o.name || '').length));
      const slugW = Math.max(4, ...orgs.map((o) => (o.slug || '').length));
      console.log(`    ${pad('NAME', nameW)}  ${pad('SLUG', slugW)}  ROLE`);
      console.log(`    ${'─'.repeat(nameW + slugW + 14)}`);
      for (const o of orgs) {
        const cur = o.slug === cfg.tenant_slug ? '→ ' : '  ';
        console.log(`  ${cur}${pad(o.name, nameW)}  ${pad(o.slug, slugW)}  ${o.role || '-'}`);
      }
    });

  cmd
    .command('switch')
    .description('Switch the active organization for this CLI')
    .argument('<slug>', 'Organization slug')
    .action(async (slug: string) => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg);
      if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      const me = await api<Me>(cfg, '/auth/me');
      const target = (me.organizations || []).find((o) => o.slug === slug.trim().toLowerCase());
      if (!target) {
        console.error(`  You are not a member of '${slug}'. Check 'agena org list'.`);
        process.exit(1);
      }
      await saveConfig({ tenant_slug: target.slug });
      console.log(`  ✅ Active tenant set to ${target.name} (${target.slug})`);
    });

  return cmd;
}

function pad(s: string, w: number): string {
  const t = s || '';
  return t.length >= w ? t : t + ' '.repeat(w - t.length);
}
