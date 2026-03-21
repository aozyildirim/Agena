'use client';

const TOKEN_KEY = 'tiqr_token';
const TOKEN_EXP_KEY = 'tiqr_token_exp';
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

function resolveApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) return process.env.NEXT_PUBLIC_API_BASE_URL;
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol;
    const host = window.location.hostname;
    return `${proto}//${host}:8010`;
  }
  return 'http://localhost:8010';
}

export function getToken(): string {
  if (typeof window === 'undefined') return '';
  const exp = localStorage.getItem(TOKEN_EXP_KEY);
  if (exp && Date.now() > parseInt(exp, 10)) {
    removeToken();
    return '';
  }
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(TOKEN_EXP_KEY, String(Date.now() + SIXTY_DAYS_MS));
}

export function removeToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXP_KEY);
}

export function isLoggedIn(): boolean {
  return getToken() !== '';
}

export async function apiFetch<T>(path: string, init?: RequestInit, auth = true): Promise<T> {
  const API_BASE = resolveApiBase();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };

  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

// ── Preferences helpers ──────────────────────────────────────────────────────

export type AzureMember = { id: string; displayName: string; uniqueName: string };

export interface UserPrefs {
  azure_project: string | null;
  azure_team: string | null;
  azure_sprint_path: string | null;
  my_team: AzureMember[];
}

const LS_PROJECT = 'tiqr_sprint_project';
const LS_TEAM    = 'tiqr_sprint_team';
const LS_SPRINT  = 'tiqr_sprint_path';
const LS_MY_TEAM = 'tiqr_my_team';

/** DB'den tercihleri çek, localStorage'a da yaz (cache) */
export async function loadPrefs(): Promise<UserPrefs> {
  const prefs = await apiFetch<UserPrefs>('/preferences');
  if (prefs.azure_project)    localStorage.setItem(LS_PROJECT, prefs.azure_project);
  if (prefs.azure_team)       localStorage.setItem(LS_TEAM,    prefs.azure_team);
  if (prefs.azure_sprint_path) localStorage.setItem(LS_SPRINT, prefs.azure_sprint_path);
  if (prefs.my_team?.length)  localStorage.setItem(LS_MY_TEAM, JSON.stringify(prefs.my_team));
  return prefs;
}

/** Tercihleri hem localStorage'a hem DB'ye kaydet */
export async function savePrefs(partial: Partial<{
  azure_project: string;
  azure_team: string;
  azure_sprint_path: string;
  my_team: AzureMember[];
}>): Promise<void> {
  if (partial.azure_project !== undefined)    localStorage.setItem(LS_PROJECT, partial.azure_project);
  if (partial.azure_team !== undefined)       localStorage.setItem(LS_TEAM,    partial.azure_team);
  if (partial.azure_sprint_path !== undefined) localStorage.setItem(LS_SPRINT, partial.azure_sprint_path);
  if (partial.my_team !== undefined)          localStorage.setItem(LS_MY_TEAM, JSON.stringify(partial.my_team));
  await apiFetch('/preferences', {
    method: 'PUT',
    body: JSON.stringify({
      azure_project:     partial.azure_project     ?? null,
      azure_team:        partial.azure_team        ?? null,
      azure_sprint_path: partial.azure_sprint_path ?? null,
      my_team:           partial.my_team           ?? null,
    }),
  });
}
