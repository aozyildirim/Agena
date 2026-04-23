// Persistent config lives at ~/.agena/config.json. This is the single
// source of truth for backend URL, tenant slug, and JWT. Daemon runtime
// tokens live in a separate file (~/.agena/runtime.json) so this one
// can be shared across bridge restarts without leaking auth.
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AgenaConfig {
  backend_url: string;
  tenant_slug: string;
  jwt?: string;
  runtime_name?: string;
  updated_at?: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.agena');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
export const RUNTIME_PATH = path.join(CONFIG_DIR, 'runtime.json');

const DEFAULT_CONFIG: AgenaConfig = {
  backend_url: 'https://api.agena.dev',
  tenant_slug: '',
};

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadConfig(): AgenaConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(patch: Partial<AgenaConfig>): AgenaConfig {
  ensureConfigDir();
  const current = loadConfig();
  const next: AgenaConfig = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export function maskJwt(jwt: string | undefined): string {
  if (!jwt) return '(not set)';
  if (jwt.length <= 16) return '***';
  return `${jwt.slice(0, 8)}...${jwt.slice(-6)}`;
}

// Returns 'ok' when both backend_url and jwt are set; callers can bail
// early with a friendly message instead of hitting an authed endpoint.
export function requireAuthed(cfg: AgenaConfig): { ok: boolean; reason?: string } {
  if (!cfg.backend_url) return { ok: false, reason: 'backend_url is not set — run `agena login`' };
  if (!cfg.tenant_slug) return { ok: false, reason: 'tenant_slug is not set — run `agena login`' };
  if (!cfg.jwt) return { ok: false, reason: 'jwt is not set — run `agena login`' };
  return { ok: true };
}
