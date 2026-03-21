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
  agents: Record<string, unknown>[];
  flows: Record<string, unknown>[];
}

const LS_PROJECT = 'tiqr_sprint_project';
const LS_TEAM    = 'tiqr_sprint_team';
const LS_SPRINT  = 'tiqr_sprint_path';
const LS_MY_TEAM = 'tiqr_my_team';

/** DB'den tercihleri çek, localStorage'a da yaz (cache) */
export async function loadPrefs(): Promise<UserPrefs> {
  const prefs = await apiFetch<UserPrefs>('/preferences');
  if (prefs.azure_project)     localStorage.setItem(LS_PROJECT, prefs.azure_project);
  if (prefs.azure_team)        localStorage.setItem(LS_TEAM,    prefs.azure_team);
  if (prefs.azure_sprint_path) localStorage.setItem(LS_SPRINT,  prefs.azure_sprint_path);
  if (prefs.my_team?.length)   localStorage.setItem(LS_MY_TEAM, JSON.stringify(prefs.my_team));
  if (prefs.agents?.length)    localStorage.setItem('tiqr_agent_configs', JSON.stringify(prefs.agents));
  if (prefs.flows?.length)     localStorage.setItem('tiqr_flows', JSON.stringify(prefs.flows));
  return prefs;
}

/** Tercihleri hem localStorage'a hem DB'ye kaydet */
export async function savePrefs(partial: Partial<{
  azure_project: string;
  azure_team: string;
  azure_sprint_path: string;
  my_team: AzureMember[];
  agents: Record<string, unknown>[];
  flows: Record<string, unknown>[];
}>): Promise<void> {
  if (partial.azure_project !== undefined)     localStorage.setItem(LS_PROJECT, partial.azure_project);
  if (partial.azure_team !== undefined)        localStorage.setItem(LS_TEAM,    partial.azure_team);
  if (partial.azure_sprint_path !== undefined) localStorage.setItem(LS_SPRINT,  partial.azure_sprint_path);
  if (partial.my_team !== undefined)           localStorage.setItem(LS_MY_TEAM, JSON.stringify(partial.my_team));
  if (partial.agents !== undefined)            localStorage.setItem('tiqr_agent_configs', JSON.stringify(partial.agents));
  if (partial.flows !== undefined)             localStorage.setItem('tiqr_flows', JSON.stringify(partial.flows));
  await apiFetch('/preferences', {
    method: 'PUT',
    body: JSON.stringify({
      azure_project:     partial.azure_project     ?? null,
      azure_team:        partial.azure_team        ?? null,
      azure_sprint_path: partial.azure_sprint_path ?? null,
      my_team:           partial.my_team           ?? null,
      agents:            partial.agents            ?? null,
      flows:             partial.flows             ?? null,
    }),
  });
}

// ── Flow Run helpers ─────────────────────────────────────────────────────────

export interface FlowRunStep {
  id: number;
  node_id: string;
  node_type: string;
  node_label: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output: unknown;
  error_msg: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface FlowRunResult {
  id: number;
  flow_id: string;
  flow_name: string;
  task_id: string | null;
  task_title: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  started_at: string;
  finished_at: string | null;
  steps: FlowRunStep[];
}

export interface FlowTemplate {
  id: number;
  name: string;
  description: string | null;
  flow: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface FlowVersion {
  id: number;
  flow_id: string;
  flow_name: string;
  label: string;
  flow: Record<string, unknown>;
  created_at: string;
}

export interface AgentAnalyticsResponse {
  snapshot_id: number | null;
  created_at: string | null;
  data: Record<string, {
    coveragePct: number;
    activityPct: number;
    latencySec: number;
    successPct: number;
  }>;
}

export async function runFlow(
  flow_id: string,
  task: Record<string, unknown>,
): Promise<FlowRunResult> {
  return apiFetch<FlowRunResult>('/flows/run', {
    method: 'POST',
    body: JSON.stringify({ flow_id, task }),
  });
}

export async function getFlowRuns(limit = 20): Promise<FlowRunResult[]> {
  return apiFetch<FlowRunResult[]>(`/flows/runs?limit=${limit}`);
}

export async function getFlowRun(runId: number): Promise<FlowRunResult> {
  return apiFetch<FlowRunResult>(`/flows/runs/${runId}`);
}

export async function listFlowTemplates(): Promise<FlowTemplate[]> {
  return apiFetch<FlowTemplate[]>('/flows/templates');
}

export async function createFlowTemplate(
  payload: { name: string; description?: string; flow: Record<string, unknown> },
): Promise<FlowTemplate> {
  return apiFetch<FlowTemplate>('/flows/templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateFlowTemplate(
  id: number,
  payload: { name: string; description?: string; flow: Record<string, unknown> },
): Promise<FlowTemplate> {
  return apiFetch<FlowTemplate>(`/flows/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteFlowTemplate(id: number): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/flows/templates/${id}`, { method: 'DELETE' });
}

export async function listFlowVersions(flowId: string, limit = 30): Promise<FlowVersion[]> {
  return apiFetch<FlowVersion[]>(`/flows/${encodeURIComponent(flowId)}/versions?limit=${limit}`);
}

export async function createFlowVersion(
  flowId: string,
  payload: { flow_name: string; label: string; flow: Record<string, unknown> },
): Promise<FlowVersion> {
  return apiFetch<FlowVersion>(`/flows/${encodeURIComponent(flowId)}/versions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getFlowVersion(flowId: string, versionId: number): Promise<FlowVersion> {
  return apiFetch<FlowVersion>(`/flows/${encodeURIComponent(flowId)}/versions/${versionId}`);
}

export async function getAgentAnalytics(persist = true): Promise<AgentAnalyticsResponse> {
  return apiFetch<AgentAnalyticsResponse>(`/flows/analytics/agents?persist=${persist ? '1' : '0'}`);
}
