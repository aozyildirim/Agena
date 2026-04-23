import { Command } from 'commander';
import { loadConfig, maskJwt, requireAuthed } from '../config';
import { api } from '../http';

interface Me {
  id: number;
  email: string;
  full_name?: string | null;
  organizations?: Array<{ id: number; slug: string; name: string; role?: string }>;
}

export function whoamiCommand(): Command {
  return new Command('whoami')
    .description('Show the authenticated user and current organization')
    .action(async () => {
      const cfg = await loadConfig();
      const gate = requireAuthed(cfg);
      if (!gate.ok) { console.error(`  ${gate.reason}`); process.exit(1); }
      const me = await api<Me>(cfg, '/auth/me');
      console.log(`  user:     ${me.full_name ? `${me.full_name} <${me.email}>` : me.email}`);
      console.log(`  user_id:  ${me.id}`);
      console.log(`  backend:  ${cfg.backend_url}`);
      console.log(`  tenant:   ${cfg.tenant_slug}`);
      console.log(`  jwt:      ${maskJwt(cfg.jwt)}  (stored in ${cfg.jwt_source})`);
      if (me.organizations && me.organizations.length > 0) {
        console.log(`\n  organizations (${me.organizations.length}):`);
        for (const o of me.organizations) {
          const current = o.slug === cfg.tenant_slug ? ' ← current' : '';
          console.log(`    - ${o.name} (${o.slug})${o.role ? `  [${o.role}]` : ''}${current}`);
        }
      }
    });
}
