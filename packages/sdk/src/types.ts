export interface AgenaConfig {
  /** API key or JWT token */
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
