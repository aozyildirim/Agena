// JWT is stored in the OS keychain (macOS Keychain, Windows Credential
// Manager, libsecret on Linux) via keytar. Falls back to config.json
// only when keytar fails to load (e.g. a stripped-down Docker image).
//
// Service name is scoped per backend so switching tenants doesn't clobber
// a previous login.
import type * as Keytar from 'keytar';

const SERVICE_PREFIX = 'agena-cli';
const ACCOUNT = 'jwt';

let kt: typeof Keytar | null | undefined;

function loadKeytar(): typeof Keytar | null {
  if (kt !== undefined) return kt;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    kt = require('keytar') as typeof Keytar;
  } catch {
    kt = null;
  }
  return kt;
}

function serviceFor(backendUrl: string): string {
  // Normalise so http://api.foo.com/ and https://api.foo.com map to the
  // same keychain entry.
  const clean = backendUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
  return `${SERVICE_PREFIX}:${clean}`;
}

export async function readJwt(backendUrl: string): Promise<string | null> {
  const k = loadKeytar();
  if (!k) return null;
  try {
    return await k.getPassword(serviceFor(backendUrl), ACCOUNT);
  } catch {
    return null;
  }
}

export async function writeJwt(backendUrl: string, jwt: string): Promise<boolean> {
  const k = loadKeytar();
  if (!k) return false;
  try {
    await k.setPassword(serviceFor(backendUrl), ACCOUNT, jwt);
    return true;
  } catch {
    return false;
  }
}

export async function deleteJwt(backendUrl: string): Promise<boolean> {
  const k = loadKeytar();
  if (!k) return false;
  try {
    return await k.deletePassword(serviceFor(backendUrl), ACCOUNT);
  } catch {
    return false;
  }
}

export function keychainAvailable(): boolean {
  return loadKeytar() !== null;
}
