// Tiny fetch wrapper that knows about backend_url + tenant_slug + jwt
// auth. Uses the global fetch (Node 18+).
import { AgenaConfig } from './config';

export async function api<T>(
  cfg: AgenaConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${cfg.backend_url.replace(/\/$/, '')}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };
  if (cfg.jwt) headers['Authorization'] = `Bearer ${cfg.jwt}`;
  if (cfg.tenant_slug) headers['X-Tenant-Slug'] = cfg.tenant_slug;
  const resp = await fetch(url, { ...init, headers });
  if (!resp.ok) {
    let body = '';
    try { body = await resp.text(); } catch { /* ignore */ }
    throw new Error(`${resp.status} ${resp.statusText}: ${body.slice(0, 300)}`);
  }
  return (await resp.json()) as T;
}
