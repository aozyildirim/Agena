'use client';

const TOKEN_KEY = 'tiqr_token';
const TOKEN_EXP_KEY = 'tiqr_token_exp';
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
const USER_CACHE_KEYS = [
  'tiqr_sprint_project',
  'tiqr_sprint_team',
  'tiqr_sprint_path',
  'tiqr_my_team',
  'tiqr_agent_configs',
  'tiqr_flows',
  'tiqr_repo_mappings',
  'tiqr_profile_settings',
] as const;

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
  USER_CACHE_KEYS.forEach((k) => localStorage.removeItem(k));
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

  if (response.status === 401 && auth) {
    removeToken();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/signin') && !window.location.pathname.startsWith('/signup')) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`/signin?next=${encodeURIComponent(next)}`);
    }
    throw new Error('Invalid token');
  }

  if (!response.ok) {
    const text = await response.text();
    let message = text || `Request failed: ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      if (parsed.detail !== undefined) {
        if (typeof parsed.detail === 'string') {
          message = parsed.detail;
        } else {
          message = JSON.stringify(parsed.detail);
        }
      }
    } catch {}
    throw new Error(message);
  }

  return (await response.json()) as T;
}

// ── Preferences helpers ──────────────────────────────────────────────────────

export type AzureMember = { id: string; displayName: string; uniqueName: string };
export type RepoMapping = {
  id: string;
  name: string;
  local_path: string;
  notes?: string;
  repo_playbook?: string;
  azure_project?: string;
  azure_repo_url?: string;
  azure_repo_name?: string;
};

export interface UserPrefs {
  azure_project: string | null;
  azure_team: string | null;
  azure_sprint_path: string | null;
  my_team: AzureMember[];
  agents: Record<string, unknown>[];
  flows: Record<string, unknown>[];
  repo_mappings: RepoMapping[];
  profile_settings: Record<string, unknown>;
}

export interface RepoProfileSummary {
  mapping_name: string;
  azure_repo_name?: string | null;
  local_path: string;
  stack: string[];
  package_manager?: string | null;
  suggested_test_commands: string[];
  suggested_lint_commands: string[];
  top_directories: string[];
  top_files: string[];
  profile_version: number;
  scanned_at: string;
  scan_id?: string;
  agents_md_path?: string;
  scanned_by_provider?: string;
  scanned_model?: string | null;
  repo_rules?: string[];
}

const LS_PROJECT = 'tiqr_sprint_project';
const LS_TEAM    = 'tiqr_sprint_team';
const LS_SPRINT  = 'tiqr_sprint_path';
const LS_MY_TEAM = 'tiqr_my_team';
const LS_REPO_MAPPINGS = 'tiqr_repo_mappings';

/** DB'den tercihleri çek, localStorage'a da yaz (cache) */
export async function loadPrefs(): Promise<UserPrefs> {
  const prefs = await apiFetch<UserPrefs>('/preferences');
  if (prefs.azure_project)     localStorage.setItem(LS_PROJECT, prefs.azure_project);
  if (prefs.azure_team)        localStorage.setItem(LS_TEAM,    prefs.azure_team);
  if (prefs.azure_sprint_path) localStorage.setItem(LS_SPRINT,  prefs.azure_sprint_path);
  if (prefs.my_team?.length)   localStorage.setItem(LS_MY_TEAM, JSON.stringify(prefs.my_team));
  if (prefs.agents?.length)    localStorage.setItem('tiqr_agent_configs', JSON.stringify(prefs.agents));
  if (prefs.flows?.length)     localStorage.setItem('tiqr_flows', JSON.stringify(prefs.flows));
  if (prefs.repo_mappings)     localStorage.setItem(LS_REPO_MAPPINGS, JSON.stringify(prefs.repo_mappings));
  if (prefs.profile_settings)  localStorage.setItem('tiqr_profile_settings', JSON.stringify(prefs.profile_settings));
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
  repo_mappings: RepoMapping[];
  profile_settings: Record<string, unknown>;
}>): Promise<void> {
  if (partial.azure_project !== undefined)     localStorage.setItem(LS_PROJECT, partial.azure_project);
  if (partial.azure_team !== undefined)        localStorage.setItem(LS_TEAM,    partial.azure_team);
  if (partial.azure_sprint_path !== undefined) localStorage.setItem(LS_SPRINT,  partial.azure_sprint_path);
  if (partial.my_team !== undefined)           localStorage.setItem(LS_MY_TEAM, JSON.stringify(partial.my_team));
  if (partial.agents !== undefined)            localStorage.setItem('tiqr_agent_configs', JSON.stringify(partial.agents));
  if (partial.flows !== undefined)             localStorage.setItem('tiqr_flows', JSON.stringify(partial.flows));
  if (partial.repo_mappings !== undefined)     localStorage.setItem(LS_REPO_MAPPINGS, JSON.stringify(partial.repo_mappings));
  if (partial.profile_settings !== undefined)  localStorage.setItem('tiqr_profile_settings', JSON.stringify(partial.profile_settings));
  await apiFetch('/preferences', {
    method: 'PUT',
    body: JSON.stringify({
      azure_project:     partial.azure_project     ?? null,
      azure_team:        partial.azure_team        ?? null,
      azure_sprint_path: partial.azure_sprint_path ?? null,
      my_team:           partial.my_team           ?? null,
      agents:            partial.agents            ?? null,
      flows:             partial.flows             ?? null,
      repo_mappings:     partial.repo_mappings     ?? null,
      profile_settings:  partial.profile_settings  ?? null,
    }),
  });
}

export async function scanRepoProfile(mapping: RepoMapping): Promise<{ mapping_id: string; profile: RepoProfileSummary }> {
  return await apiFetch<{ mapping_id: string; profile: RepoProfileSummary }>('/preferences/repo-profile/scan', {
    method: 'POST',
    body: JSON.stringify({
      mapping_id: mapping.id,
      mapping_name: mapping.name,
      local_path: mapping.local_path,
      azure_repo_name: mapping.azure_repo_name ?? null,
    }),
  });
}

export async function getRepoAgentsDoc(mappingId: string): Promise<{ mapping_id: string; agents_md_path: string; content: string }> {
  return await apiFetch<{ mapping_id: string; agents_md_path: string; content: string }>(
    `/preferences/repo-profile/agents/${encodeURIComponent(mappingId)}`,
  );
}

export async function saveRepoAgentsDoc(mappingId: string, content: string): Promise<{ mapping_id: string; agents_md_path: string; content: string }> {
  return await apiFetch<{ mapping_id: string; agents_md_path: string; content: string }>(
    `/preferences/repo-profile/agents/${encodeURIComponent(mappingId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ content }),
    },
  );
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

export interface NotificationItem {
  id: number;
  task_id: number | null;
  event_type: string;
  title: string;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'error' | string;
  is_read: boolean;
  created_at: string;
}

export interface NotificationListResponse {
  unread_count: number;
  total: number;
  page: number;
  page_size: number;
  items: NotificationItem[];
}

export interface UsageEventItem {
  id: number;
  operation_type: string;
  provider: string;
  model: string | null;
  status: string;
  task_id: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  duration_ms: number | null;
  cache_hit: boolean;
  local_repo_path: string | null;
  profile_version: number | null;
  error_message: string | null;
  created_at: string;
}

export interface UsageSummary {
  count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  avg_duration_ms: number;
}

export interface UsageEventsResponse {
  page: number;
  page_size: number;
  total: number;
  summary: UsageSummary;
  items: UsageEventItem[];
}

export async function listNotifications(
  limit = 12,
  onlyUnread = false,
  opts?: { page?: number; page_size?: number; event_type?: string; read_status?: 'all' | 'read' | 'unread' },
): Promise<NotificationListResponse> {
  const qs = new URLSearchParams({
    limit: String(limit),
    only_unread: String(onlyUnread),
    page: String(opts?.page ?? 1),
    page_size: String(opts?.page_size ?? limit),
    event_type: String(opts?.event_type ?? 'all'),
    read_status: String(opts?.read_status ?? 'all'),
  });
  return apiFetch<NotificationListResponse>(`/notifications?${qs.toString()}`);
}

export async function listUsageEvents(params?: {
  operation_type?: string;
  provider?: string;
  status?: string;
  task_id?: number;
  created_from?: string;
  created_to?: string;
  mine_only?: boolean;
  page?: number;
  page_size?: number;
}): Promise<UsageEventsResponse> {
  const qs = new URLSearchParams();
  if (params?.operation_type) qs.set('operation_type', params.operation_type);
  if (params?.provider) qs.set('provider', params.provider);
  if (params?.status) qs.set('status', params.status);
  if (params?.task_id !== undefined) qs.set('task_id', String(params.task_id));
  if (params?.created_from) qs.set('created_from', params.created_from);
  if (params?.created_to) qs.set('created_to', params.created_to);
  if (params?.mine_only !== undefined) qs.set('mine_only', String(params.mine_only));
  qs.set('page', String(params?.page ?? 1));
  qs.set('page_size', String(params?.page_size ?? 20));
  return await apiFetch<UsageEventsResponse>(`/usage-events?${qs.toString()}`);
}

export async function markNotificationRead(notificationId: number): Promise<void> {
  await apiFetch(`/notifications/${notificationId}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead(): Promise<number> {
  const res = await apiFetch<{ updated: number }>('/notifications/read-all', { method: 'POST' });
  return res.updated;
}

export async function clearAllNotifications(): Promise<number> {
  const res = await apiFetch<{ deleted: number }>('/notifications', { method: 'DELETE' });
  return res.deleted;
}

export async function createNotificationEvent(payload: {
  event_type: string;
  title: string;
  message: string;
  severity?: string;
  task_id?: number | null;
}): Promise<void> {
  await apiFetch('/notifications/event', { method: 'POST', body: JSON.stringify(payload) });
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
