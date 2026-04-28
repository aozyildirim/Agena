'use client';

const TOKEN_KEY = 'agena_token';
const TOKEN_EXP_KEY = 'agena_token_exp';
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
const NETWORK_RETRY_DELAYS_MS = [350, 900];
const USER_CACHE_KEYS = [
  'agena_sprint_project',
  'agena_sprint_team',
  'agena_sprint_path',
  'agena_my_team',
  'agena_agent_configs',
  'agena_flows',
  'agena_repo_mappings',
  'agena_profile_settings',
] as const;

export function resolveApiBase(): string {
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
  localStorage.removeItem('agena_org_slug');
  localStorage.removeItem('agena_org_name');
  USER_CACHE_KEYS.forEach((k) => localStorage.removeItem(k));
}

export function isLoggedIn(): boolean {
  return getToken() !== '';
}

// ── Org slug helpers ──────────────────────────────────────────────────────────

const ORG_SLUG_KEY = 'agena_org_slug';
const ORG_NAME_KEY = 'agena_org_name';

export function setOrgSlug(slug: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ORG_SLUG_KEY, slug);
}

export function getOrgSlug(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(ORG_SLUG_KEY) ?? '';
}

export function setOrgName(name: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ORG_NAME_KEY, name);
}

export function getOrgName(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(ORG_NAME_KEY) ?? '';
}

// ── Cached API fetch (sessionStorage, per-user, 5min TTL) ────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_PREFIX = 'agena_api_cache:';

export async function cachedApiFetch<T>(path: string, ttlMs: number = CACHE_TTL_MS): Promise<T> {
  if (typeof window !== 'undefined') {
    const cacheKey = CACHE_PREFIX + path;
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) {
        const entry = JSON.parse(raw) as { ts: number; data: T };
        if (Date.now() - entry.ts < ttlMs) {
          return entry.data;
        }
        sessionStorage.removeItem(cacheKey);
      }
    } catch { /* ignore corrupt cache */ }
  }

  const data = await apiFetch<T>(path);

  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(CACHE_PREFIX + path, JSON.stringify({ ts: Date.now(), data }));
    } catch { /* sessionStorage full — ignore */ }
  }

  return data;
}

export function invalidateApiCache(pathPrefix?: string): void {
  if (typeof window === 'undefined') return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) {
      if (!pathPrefix || key.startsWith(CACHE_PREFIX + pathPrefix)) {
        keysToRemove.push(key);
      }
    }
  }
  keysToRemove.forEach((k) => sessionStorage.removeItem(k));
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const API_BASE = resolveApiBase();
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const slug = getOrgSlug();
  if (slug) headers['X-Tenant-Slug'] = slug;
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: formData,
    cache: 'no-store',
  });
  const text = response.ok ? '' : await response.text();
  if (!response.ok) {
    let message = text || `Request failed: ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      if (typeof parsed.detail === 'string') message = parsed.detail;
    } catch {}
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function apiDownloadBlob(path: string): Promise<Blob> {
  const API_BASE = resolveApiBase();
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const slug = getOrgSlug();
  if (slug) headers['X-Tenant-Slug'] = slug;
  const response = await fetch(`${API_BASE}${path}`, { headers, cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }
  return await response.blob();
}

export async function apiFetch<T>(path: string, init?: RequestInit, auth = true): Promise<T> {
  const API_BASE = resolveApiBase();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  const method = (init?.method || 'GET').toUpperCase();

  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  // Pass tenant slug for local dev (where subdomains are unavailable)
  const slug = getOrgSlug();
  if (slug) headers['X-Tenant-Slug'] = slug;

  let response: Response;
  let lastNetworkError: unknown = null;
  for (let attempt = 0; attempt <= NETWORK_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers,
        cache: 'no-store',
      });
      break;
    } catch (error) {
      lastNetworkError = error;
      const canRetry = method === 'GET' && attempt < NETWORK_RETRY_DELAYS_MS.length;
      if (!canRetry) {
        throw error;
      }
      await new Promise((resolve) => {
        window.setTimeout(resolve, NETWORK_RETRY_DELAYS_MS[attempt]);
      });
    }
  }

  if (!response!) {
    throw lastNetworkError instanceof Error ? lastNetworkError : new Error('Network request failed');
  }

  const text = response.ok ? '' : await response.text();

  if (response.status === 401 && auth) {
    let detail = text || 'Unauthorized';
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      if (typeof parsed.detail === 'string' && parsed.detail.trim()) detail = parsed.detail.trim();
    } catch {}
    const tokenErrors = new Set(['Invalid token', 'Invalid auth context', 'User not found']);
    if (tokenErrors.has(detail)) {
      removeToken();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/signin') && !window.location.pathname.startsWith('/signup')) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/signin?next=${encodeURIComponent(next)}`);
      }
    }
    throw new Error(detail);
  }

  if (!response.ok) {
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

// ── Backend repo mapping (multi-repo orchestration) ─────────────────────────

export type BackendRepoMapping = {
  id: number;
  provider: string;
  owner: string;
  repo_name: string;
  display_name?: string;
  is_active?: boolean;
};

// ── Preferences helpers ──────────────────────────────────────────────────────

export type AzureMember = { id: string; displayName: string; uniqueName: string };
export type RepoMapping = {
  id: string;
  name: string;
  local_path: string;
  provider?: 'azure' | 'github';
  notes?: string;
  repo_playbook?: string;
  azure_project?: string;
  azure_repo_url?: string;
  azure_repo_name?: string;
  github_owner?: string;
  github_repo?: string;
  github_repo_full_name?: string;
  analyze_prompt?: string;
  default_branch?: string;
};

export interface UserPrefs {
  azure_project: string | null;
  azure_team: string | null;
  azure_sprint_path: string | null;
  my_team: AzureMember[];
  my_team_source?: 'azure' | 'jira' | string;
  my_team_by_source?: Record<string, AzureMember[]>;
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
  agents_md_size?: number;
  agents_md_signatures?: number;
  agents_md_files?: number;
  scanned_by_provider?: string;
  scanned_model?: string | null;
  repo_rules?: string[];
}

export interface PromptCatalog {
  defaults: Record<string, string>;
  overrides: Record<string, string>;
  effective: Record<string, string>;
}

const LS_PROJECT = 'agena_sprint_project';
const LS_TEAM    = 'agena_sprint_team';
const LS_SPRINT  = 'agena_sprint_path';
const LS_MY_TEAM = 'agena_my_team';
const LS_REPO_MAPPINGS = 'agena_repo_mappings';

/** DB'den tercihleri çek, localStorage'a da yaz (cache) */
export async function loadPrefs(): Promise<UserPrefs> {
  const prefs = await apiFetch<UserPrefs>('/preferences');
  if (prefs.azure_project)     localStorage.setItem(LS_PROJECT, prefs.azure_project);
  if (prefs.azure_team)        localStorage.setItem(LS_TEAM,    prefs.azure_team);
  if (prefs.azure_sprint_path) localStorage.setItem(LS_SPRINT,  prefs.azure_sprint_path);
  if (prefs.my_team?.length)   localStorage.setItem(LS_MY_TEAM, JSON.stringify(prefs.my_team));
  if (prefs.agents?.length)    localStorage.setItem('agena_agent_configs', JSON.stringify(prefs.agents));
  if (prefs.flows?.length)     localStorage.setItem('agena_flows', JSON.stringify(prefs.flows));
  if (prefs.repo_mappings)     localStorage.setItem(LS_REPO_MAPPINGS, JSON.stringify(prefs.repo_mappings));
  if (prefs.profile_settings)  localStorage.setItem('agena_profile_settings', JSON.stringify(prefs.profile_settings));
  return prefs;
}

/** Tercihleri hem localStorage'a hem DB'ye kaydet */
export async function savePrefs(partial: Partial<{
  azure_project: string;
  azure_team: string;
  azure_sprint_path: string;
  my_team: AzureMember[];
  my_team_source: 'azure' | 'jira';
  agents: Record<string, unknown>[];
  flows: Record<string, unknown>[];
  repo_mappings: RepoMapping[];
  profile_settings: Record<string, unknown>;
}>): Promise<void> {
  if (partial.azure_project !== undefined)     localStorage.setItem(LS_PROJECT, partial.azure_project);
  if (partial.azure_team !== undefined)        localStorage.setItem(LS_TEAM,    partial.azure_team);
  if (partial.azure_sprint_path !== undefined) localStorage.setItem(LS_SPRINT,  partial.azure_sprint_path);
  if (partial.my_team !== undefined)           localStorage.setItem(LS_MY_TEAM, JSON.stringify(partial.my_team));
  if (partial.agents !== undefined)            localStorage.setItem('agena_agent_configs', JSON.stringify(partial.agents));
  if (partial.flows !== undefined)             localStorage.setItem('agena_flows', JSON.stringify(partial.flows));
  if (partial.repo_mappings !== undefined)     localStorage.setItem(LS_REPO_MAPPINGS, JSON.stringify(partial.repo_mappings));
  if (partial.profile_settings !== undefined)  localStorage.setItem('agena_profile_settings', JSON.stringify(partial.profile_settings));
  await apiFetch('/preferences', {
    method: 'PUT',
    body: JSON.stringify({
      azure_project:     partial.azure_project     ?? null,
      azure_team:        partial.azure_team        ?? null,
      azure_sprint_path: partial.azure_sprint_path ?? null,
      my_team:           partial.my_team           ?? null,
      my_team_source:    partial.my_team_source    ?? null,
      agents:            partial.agents            ?? null,
      flows:             partial.flows             ?? null,
      repo_mappings:     partial.repo_mappings     ?? null,
      profile_settings:  partial.profile_settings  ?? null,
    }),
  });
}

export async function loadPromptCatalog(): Promise<PromptCatalog> {
  return apiFetch<PromptCatalog>('/preferences/prompts');
}

export async function savePromptOverrides(overrides: Record<string, string>): Promise<PromptCatalog> {
  return apiFetch<PromptCatalog>('/preferences/prompts', {
    method: 'PUT',
    body: JSON.stringify({ overrides }),
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
      analyze_prompt: mapping.analyze_prompt ?? null,
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

// ── Dashboard Analytics helpers ──────────────────────────────────────────────

export interface AnalyticsDailyStatItem {
  date: string;
  count: number;
  total_tokens: number;
  cost_usd: number;
  avg_duration_ms: number;
}

export interface AnalyticsTaskVelocityItem {
  date: string;
  completed: number;
  failed: number;
  queued: number;
  total: number;
}

export interface AnalyticsDailyResponse {
  daily_usage: AnalyticsDailyStatItem[];
  task_velocity: AnalyticsTaskVelocityItem[];
}

export interface AnalyticsModelItem {
  model: string;
  count: number;
  total_tokens: number;
  cost_usd: number;
}

export interface AnalyticsModelResponse {
  models: AnalyticsModelItem[];
}

export interface AnalyticsSummaryResponse {
  period: string;
  ai_call_count: number;
  total_tokens: number;
  cost_usd: number;
  avg_duration_ms: number;
  task_total: number;
  task_completed: number;
  task_failed: number;
  completion_rate: number;
}

export async function fetchAnalyticsDaily(days = 30): Promise<AnalyticsDailyResponse> {
  return apiFetch<AnalyticsDailyResponse>(`/analytics/daily?days=${days}`);
}

export async function fetchAnalyticsSummary(): Promise<AnalyticsSummaryResponse> {
  return apiFetch<AnalyticsSummaryResponse>('/analytics/summary');
}

export async function fetchAnalyticsModels(days = 30): Promise<AnalyticsModelResponse> {
  return apiFetch<AnalyticsModelResponse>(`/analytics/models?days=${days}`);
}

// ── DORA Project Analytics ───────────────────────────────────────────────────

export interface ProjectKPI {
  predictability: number;
  productivity: number;
  delivery_rate: number;
  planning_accuracy: number;
}

export interface ProjectTotals {
  planned: number;
  completed: number;
  failed: number;
  removed?: number | null;
  in_progress?: number | null;
}

export interface GitActivityBlock {
  prs_opened: number;
  prs_merged: number;
  prs_open: number;
  avg_pr_lead_time_hours: number | null;
  commits: number;
  contributors: number;
  deployments_total: number;
  deployments_success: number;
  deployments_failed: number;
}

export interface WeeklyTrendItem {
  week: string;
  planned: number;
  completed: number;
  failed: number;
}

export interface TimeTrendItem {
  date: string;
  avg_lead_time_hours: number;
  avg_cycle_time_hours: number;
}

export interface ThroughputTrendItem {
  week: string;
  throughput: number;
}

export interface ProjectAnalyticsResponse {
  period_days: number;
  source?: 'internal' | 'external';
  project?: string | null;
  team?: string | null;
  error?: string | null;
  kpi: ProjectKPI;
  totals: ProjectTotals;
  avg_cycle_time_hours: number;
  avg_lead_time_hours: number;
  wip_count: number;
  weekly_trend: WeeklyTrendItem[];
  time_trend: TimeTrendItem[];
  throughput_trend: ThroughputTrendItem[];
  git_activity?: GitActivityBlock | null;
}

export interface ProjectAnalyticsOptions {
  source?: 'internal' | 'external';
  project?: string | null;
  team?: string | null;
}

export async function fetchProjectAnalytics(
  days = 30,
  repoMappingId?: string | null,
  opts: ProjectAnalyticsOptions = {},
): Promise<ProjectAnalyticsResponse> {
  const qs = new URLSearchParams({ days: String(days) });
  if (repoMappingId) qs.set('repo_mapping_id', repoMappingId);
  if (opts.source) qs.set('source', opts.source);
  if (opts.project) qs.set('project', opts.project);
  if (opts.team) qs.set('team', opts.team);
  return apiFetch<ProjectAnalyticsResponse>(`/analytics/dora/project?${qs.toString()}`);
}

// ── Sprint Detail (Oobeya-style) ─────────────────────────────────────────────

export interface SprintAssigneeItem {
  name: string;
  assigned_count: number;
  total_effort: number;
  delivery_rate_count: number;
  delivery_rate_effort: number;
  delivered_effort: number;
}

export interface SprintWorkItem {
  id: number;
  key: string;
  assignee: string;
  assignee_id: number;
  summary: string;
  work_item_type: string;
  priority: string;
  status: string;
  reopen_count: number;
  effort: number;
}

export interface SprintTypeDistItem {
  type: string;
  count: number;
}

export interface SprintScopeChangeItem {
  date: string;
  added: number;
  removed: number;
}

export interface SprintDetailResponse {
  sprint_velocity: number;
  total_items: number;
  planned_items: number;
  delivery_rate_pct: number;
  planning_accuracy_pct: number;
  total_task_count: number;
  total_bug_count: number;
  completed_task_count: number;
  completed_bug_count: number;
  total_effort: number;
  completed_effort: number;
  assignees: SprintAssigneeItem[];
  completed_items: SprintWorkItem[];
  incomplete_items: SprintWorkItem[];
  removed_items: SprintWorkItem[];
  type_distribution: SprintTypeDistItem[];
  scope_change: SprintScopeChangeItem[];
}

export async function fetchSprintDetail(days = 30, repoMappingId?: string | null): Promise<SprintDetailResponse> {
  const qs = new URLSearchParams({ days: String(days) });
  if (repoMappingId) qs.set('repo_mapping_id', repoMappingId);
  return apiFetch<SprintDetailResponse>(`/analytics/dora/project/sprint?${qs.toString()}`);
}

// ── DORA Development Analytics ───────────────────────────────────────────────

export interface AgentPerformanceItem {
  role: string;
  tasks: number;
  success_rate: number;
  avg_duration_ms: number;
}

export interface ModelPerformanceItem {
  model: string;
  tasks: number;
  total_tokens: number;
  cost_usd: number;
  success_rate: number;
  avg_duration_ms: number;
}

export interface CostPerTaskTrendItem {
  date: string;
  cost_per_task: number;
}

export interface TokenUsageTrendItem {
  date: string;
  total_tokens: number;
}

export interface DoraDevelopmentResponse {
  coding_efficiency: number;
  rework_rate: number;
  avg_cost_per_task: number;
  avg_completion_minutes: number;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  avg_tokens_per_task: number;
  agent_performance: AgentPerformanceItem[];
  model_performance: ModelPerformanceItem[];
  cost_per_task_trend: CostPerTaskTrendItem[];
  token_usage_trend: TokenUsageTrendItem[];
}

export async function fetchDoraDevelopment(days = 30, repoMappingId?: string | null): Promise<DoraDevelopmentResponse> {
  const qs = new URLSearchParams({ days: String(days) });
  if (repoMappingId) qs.set('repo_mapping_id', repoMappingId);
  return apiFetch<DoraDevelopmentResponse>(`/analytics/dora/development?${qs.toString()}`);
}

// ── Git Analytics ─────────────────────────────────────────────────────────────

export interface GitKPI {
  active_days: number;
  total_commits: number;
  contributors: number;
  coding_days_per_week: number;
  total_additions: number;
  total_deletions: number;
}

export interface GitDailyStat {
  date: string;
  commits: number;
  additions: number;
  deletions: number;
  files_changed: number;
}

export interface GitCommitsByDay {
  day: string;
  commits: number;
}

export interface GitCommitsByHour {
  hour: number;
  commits: number;
}

export interface GitContributor {
  author: string;
  email: string;
  commits: number;
  additions: number;
  deletions: number;
  files_changed: number;
  efficiency: number;
  impact: number;
  new_pct: number;
  refactor_pct: number;
  help_others_pct: number;
  churn_pct: number;
}

export interface GitRecentCommit {
  sha: string;
  date: string;
  message: string;
  author: string;
  additions: number;
  deletions: number;
  files_changed: number;
}

export interface CodingDaysSparkline {
  week: string;
  days: number;
}

export interface GitAnalyticsResponse {
  kpi: GitKPI;
  coding_days_sparkline: CodingDaysSparkline[];
  daily_stats: GitDailyStat[];
  commits_by_day: GitCommitsByDay[];
  commits_by_hour: GitCommitsByHour[];
  contributors: GitContributor[];
  recent_commits: GitRecentCommit[];
}

export async function fetchGitAnalytics(days = 30, repoMappingId?: string | null): Promise<GitAnalyticsResponse> {
  const qs = new URLSearchParams({ days: String(days) });
  if (repoMappingId) qs.set('repo_mapping_id', repoMappingId);
  return apiFetch<GitAnalyticsResponse>(`/analytics/dora/development/git?${qs.toString()}`);
}

// ── DORA PR Analytics ─────────────────────────────────────────────────────────

export interface PrKPI {
  pct_merged_within_goal: number;
  merge_goal_hours: number;
  avg_merge_hours: number;
  merged_count: number;
}

export interface PrTimeTrendItem {
  date: string;
  pr_title: string;
  hours: number;
}

export interface PrSizeTrendItem {
  date: string;
  pr_title: string;
  lines_changed: number;
  additions: number;
  deletions: number;
}

export interface PrOpenItem {
  id: number;
  title: string;
  risks: string[];
  author: string;
  age_days: number;
  comments: number;
  coding_time_hours: number | null;
  source_branch: string;
  lines_changed: number;
}

export interface PrReviewerStatItem {
  reviewer: string;
  avg_review_hours: number;
  max_review_hours: number;
  reviewed_count: number;
  reviewed_pct: number;
}

export interface PrListItem {
  id: number;
  title: string;
  risks: string[];
  status: string;
  author: string;
  source_branch: string;
  target_branch: string;
  approvals: number;
  lines_changed: number;
  created_at: string;
}

export interface PrAnalyticsResponse {
  kpi: PrKPI;
  merge_time_trend: PrTimeTrendItem[];
  coding_time_trend: PrTimeTrendItem[];
  pr_size_trend: PrSizeTrendItem[];
  open_prs: PrOpenItem[];
  reviewer_stats: PrReviewerStatItem[];
  pr_list: PrListItem[];
}

export async function fetchPrAnalytics(days = 30, repoMappingId?: string | null, mergeGoalHours = 36): Promise<PrAnalyticsResponse> {
  const qs = new URLSearchParams({ days: String(days), merge_goal_hours: String(mergeGoalHours) });
  if (repoMappingId) qs.set('repo_mapping_id', repoMappingId);
  return apiFetch<PrAnalyticsResponse>(`/analytics/dora/development/prs?${qs.toString()}`);
}

// ── DORA Deployments Analytics ────────────────────────────────────────────────

export interface DeploymentsKPI {
  lead_time_hours: number;
  deploy_frequency: number;
  change_failure_rate: number;
  mttr_hours: number;
}

export interface LeadTimeTrendItem {
  date: string;
  hours: number;
}

export interface DeployFreqTrendItem {
  date: string;
  deploys: number;
}

export interface CfrTrendItem {
  date: string;
  rate: number;
}

export interface DeploymentListItem {
  environment: string;
  status: string;
  sha: string;
  deployed_at: string;
  duration_sec: number;
}

export interface DeploymentsAnalyticsResponse {
  kpi: DeploymentsKPI;
  lead_time_trend: LeadTimeTrendItem[];
  deploy_freq_trend: DeployFreqTrendItem[];
  cfr_trend: CfrTrendItem[];
  deployments: DeploymentListItem[];
}

export async function fetchDeploymentsAnalytics(days = 30, repoMappingId?: string | null): Promise<DeploymentsAnalyticsResponse> {
  const qs = new URLSearchParams({ days: String(days) });
  if (repoMappingId) qs.set('repo_mapping_id', repoMappingId);
  return apiFetch<DeploymentsAnalyticsResponse>(`/analytics/dora/development/deployments?${qs.toString()}`);
}

// ── DORA Quality ──────────────────────────────────────────────────────────────

export interface QualityDailyTrendItem {
  date: string;
  success_rate: number;
  completed: number;
  settled: number;
}

export interface FailureCategoryItem {
  reason: string;
  count: number;
}

export interface DoraQualityResponse {
  success_rate: number;
  first_time_rate: number;
  completed: number;
  failed: number;
  benchmark: string;
  daily_trend: QualityDailyTrendItem[];
  failure_categories: FailureCategoryItem[];
}

export async function fetchDoraQuality(days = 30, repoMappingId?: string | null): Promise<DoraQualityResponse> {
  const qs = new URLSearchParams({ days: String(days) });
  if (repoMappingId) qs.set('repo_mapping_id', repoMappingId);
  return apiFetch<DoraQualityResponse>(`/analytics/dora/quality?${qs.toString()}`);
}

// ── DORA Bug Report ───────────────────────────────────────────────────────────

export interface FailedTaskItem {
  id: number;
  title: string;
  failure_reason: string;
  source: string;
  created_at: string;
  updated_at: string;
  duration_sec: number;
}

export interface FailureTrendItem {
  date: string;
  failed: number;
  failure_rate: number;
}

export interface FailureReasonItem {
  reason: string;
  count: number;
}

export interface StaleTaskItem {
  id: number;
  title: string;
  source: string;
  created_at: string;
  running_minutes: number;
}

export interface DoraBugsResponse {
  total_failed: number;
  failure_rate: number;
  mttr_minutes: number;
  stale_count: number;
  recent_failed: FailedTaskItem[];
  failure_trend: FailureTrendItem[];
  top_failure_reasons: FailureReasonItem[];
  stale_tasks: StaleTaskItem[];
}

export async function fetchDoraBugs(days = 30, repoMappingId?: string | null): Promise<DoraBugsResponse> {
  const qs = new URLSearchParams({ days: String(days) });
  if (repoMappingId) qs.set('repo_mapping_id', repoMappingId);
  return apiFetch<DoraBugsResponse>(`/analytics/dora/bugs?${qs.toString()}`);
}

// ── DORA Sync ─────────────────────────────────────────────────────────────────

export async function syncDoraRepo(repoMappingId: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>('/analytics/dora/sync', {
    method: 'POST',
    body: JSON.stringify({ repo_mapping_id: repoMappingId }),
  });
}

export async function fetchDoraOverview(days = 30, repoMappingId?: string | null): Promise<{
  lead_time_hours: number | null;
  deploy_frequency: number | null;
  change_failure_rate: number | null;
  mttr_hours: number | null;
  data_source: string;
  daily: Array<{
    date: string;
    completed: number;
    failed: number;
    lead_time_hours: number | null;
    mttr_hours: number | null;
  }>;
}> {
  const qs = new URLSearchParams({ days: String(days) });
  if (repoMappingId) qs.set('repo_mapping_id', repoMappingId);
  return apiFetch(`/analytics/dora?${qs.toString()}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchTeamSymptoms(days = 90, repoMappingId?: string | null): Promise<any> {
  const qs = new URLSearchParams({ days: String(days) });
  if (repoMappingId) qs.set('repo_mapping_id', repoMappingId);
  return apiFetch(`/analytics/dora/team-symptoms?${qs.toString()}`);
}
