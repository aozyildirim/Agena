// Persistent config lives at ~/.agena/config.json for the non-sensitive
// bits (backend URL, tenant slug, runtime name). The JWT itself goes
// into the OS keychain (macOS Keychain / Windows Credential Manager /
// libsecret) so it's never on disk as plain text. Daemon runtime tokens
// live in a separate file (~/.agena/runtime.json).
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readJwt, writeJwt, deleteJwt, keychainAvailable } from './keychain';

export interface AgenaConfig {
  backend_url: string;
  tenant_slug: string;
  jwt?: string;
  runtime_name?: string;
  updated_at?: string;
  /** True when jwt was read from the OS keychain rather than the config file. */
  jwt_source?: 'keychain' | 'config' | 'missing';
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

function readConfigFile(): AgenaConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Sync variant used when we don't want to await the keychain. Returns
 *  whatever's in the config file; JWT will be unset if the keychain is
 *  where it lives. Prefer `loadConfig()` in command handlers. */
export function loadConfigSync(): AgenaConfig {
  return readConfigFile();
}

export async function loadConfig(): Promise<AgenaConfig> {
  const base = readConfigFile();
  // If the JWT is already in the config file (legacy / fallback), keep
  // using it but mark the source so the UI can nudge the user to rotate.
  if (base.jwt) {
    return { ...base, jwt_source: 'config' };
  }
  // Otherwise try the keychain.
  if (keychainAvailable() && base.backend_url) {
    const jwt = await readJwt(base.backend_url);
    if (jwt) return { ...base, jwt, jwt_source: 'keychain' };
  }
  return { ...base, jwt_source: 'missing' };
}

export async function saveConfig(patch: Partial<AgenaConfig>): Promise<AgenaConfig> {
  ensureConfigDir();
  const current = readConfigFile();
  const { jwt: jwtFromPatch, ...rest } = patch;
  const next: AgenaConfig = {
    ...current,
    ...rest,
    updated_at: new Date().toISOString(),
  };
  // Never persist JWT in the config file. Keychain if available;
  // refuse to save otherwise to avoid quietly leaking to disk.
  if (jwtFromPatch !== undefined) {
    delete (next as AgenaConfig).jwt;
    if (jwtFromPatch === '') {
      if (current.backend_url) await deleteJwt(current.backend_url);
    } else {
      const stored = await writeJwt(next.backend_url, jwtFromPatch);
      if (!stored) {
        throw new Error(
          'keytar is not available on this system — install it with `npm install -g keytar`, '
          + 'or set AGENA_JWT in the shell environment instead of running `agena login`.'
        );
      }
    }
  }
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
