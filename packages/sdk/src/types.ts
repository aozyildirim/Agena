export interface AgenaConfig {
  /** An API key from Administration → API Keys (`agena_…`), or a session JWT */
  apiKey: string;
  /** Base URL of the AGENA API (default: https://api.agena.dev) */
  baseUrl?: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  result_summary?: string;
  pr_url?: string;
  pr_branch?: string;
  tokens_used?: number;
  cost_usd?: number;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskCreateParams {
  title: string;
  description: string;
  /** Optional: assign to a specific agent config */
  agent_config_id?: number;
  /** Optional: specify target repository mapping */
  repo_mapping_id?: number;
  /** Optional: priority (1-10) */
  priority?: number;
}

export interface FlowRun {
  id: string;
  flow_id: number;
  status: string;
  steps: FlowStep[];
  created_at: string;
  finished_at?: string;
}

export interface FlowStep {
  node_id: string;
  status: string;
  output?: Record<string, unknown>;
  error?: string;
}

export interface FlowRunParams {
  flow_id: number;
  /** Optional context variables to inject */
  context?: Record<string, unknown>;
}

export interface FlowTemplate {
  id: number;
  name: string;
  description: string;
  nodes: unknown[];
  edges: unknown[];
}

export interface AgentRunParams {
  task_id: number;
}

export interface AgentLiveStatus {
  task_id: number;
  agents: {
    role: string;
    status: string;
    progress?: number;
  }[];
}

export interface Integration {
  provider: string;
  configured: boolean;
  config: Record<string, unknown>;
}

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: string;
  organization_id: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface ApiError {
  detail: string;
  status: number;
}

export interface AuditLogEntry {
  id: number;
  created_at: string;
  actor_user_id: number | null;
  actor_email: string | null;
  actor_role: string | null;
  /** `<area>.<endpoint>`, e.g. `tasks.assign_task` or `auth.login` */
  action: string;
  method: string;
  path: string;
  /** Matched path template, e.g. `/tasks/{task_id}/assign` */
  route: string | null;
  target_type: string | null;
  target_id: string | null;
  status_code: number;
  request_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  workspace_id: number | null;
  /** Path params and redacted query string; never the request body */
  details: Record<string, unknown> | null;
}

export interface AuditLogQuery {
  /** Exact action name, e.g. `integrations.save_integration` */
  action?: string;
  /** Substring match on the actor's email */
  actor?: string;
  target_type?: string;
  /** Free text over path, action, target id, IP, or an exact request id */
  q?: string;
  /** ISO date (YYYY-MM-DD), inclusive */
  created_from?: string;
  created_to?: string;
}

export interface AuditLogPage {
  page: number;
  page_size: number;
  total: number;
  items: AuditLogEntry[];
}

export interface FlowSchedule {
  id: number;
  flow_id: string;
  flow_name: string;
  /** 5-field cron: minute hour day-of-month month day-of-week */
  cron: string;
  /** IANA timezone the cron is evaluated in, e.g. Europe/Istanbul */
  timezone: string;
  enabled: boolean;
  task_json: Record<string, unknown> | null;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_id: number | null;
  last_status: string | null;
  last_error: string | null;
  run_count: number;
  created_at: string;
}

export interface FlowScheduleCreateParams {
  flow_id: string;
  flow_name?: string;
  cron: string;
  timezone?: string;
  enabled?: boolean;
  /** The `task` object the flow's trigger node receives on each run */
  task?: Record<string, unknown>;
}

export interface FlowScheduleUpdateParams {
  cron?: string;
  timezone?: string;
  enabled?: boolean;
  task?: Record<string, unknown>;
  flow_name?: string;
}
