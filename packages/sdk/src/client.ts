import type {
  AgenaConfig,
  Task,
  TaskCreateParams,
  FlowRun,
  FlowRunParams,
  FlowTemplate,
  AgentRunParams,
  AgentLiveStatus,
  Integration,
  User,
  AuditLogEntry,
  AuditLogPage,
  AuditLogQuery,
  FlowSchedule,
  FlowScheduleCreateParams,
  FlowScheduleUpdateParams,
  WebhookEndpoint,
  WebhookEndpointWithSecret,
  WebhookDelivery,
  ApiError,
} from './types';

class AgenaApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`AGENA API Error ${status}: ${detail}`);
    this.name = 'AgenaApiError';
    this.status = status;
    this.detail = detail;
  }
}

export class AgenaClient {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;

  /** Task operations */
  readonly tasks: TasksResource;
  /** Flow operations */
  readonly flows: FlowsResource;
  /** Agent operations */
  readonly agents: AgentsResource;
  /** Integration operations */
  readonly integrations: IntegrationsResource;
  /** Auth operations */
  readonly auth: AuthResource;
  /** Organization audit trail (owner / admin) */
  readonly auditLogs: AuditLogsResource;
  /** Outbound webhooks (owner / admin) */
  readonly webhooks: WebhooksResource;

  constructor(config: AgenaConfig) {
    this.baseUrl = (config.baseUrl || 'https://api.agena.dev').replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 30000;

    this.tasks = new TasksResource(this);
    this.flows = new FlowsResource(this);
    this.agents = new AgentsResource(this);
    this.integrations = new IntegrationsResource(this);
    this.auth = new AuthResource(this);
    this.auditLogs = new AuditLogsResource(this);
    this.webhooks = new WebhooksResource(this);
  }

  /** Internal: make an authenticated API request and parse the JSON body */
  async _request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this._send(method, path, body, (res) => res.json() as Promise<T>);
  }

  /** Internal: same, for endpoints that answer with text (CSV exports) */
  async _requestText(method: string, path: string): Promise<string> {
    return this._send(method, path, undefined, (res) => res.text());
  }

  private async _send<T>(method: string, path: string, body: unknown, read: (res: Response) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const err: ApiError = await res.json();
          detail = err.detail || detail;
        } catch {}
        throw new AgenaApiError(res.status, detail);
      }

      return read(res);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── Tasks ─────────────────────────────────────────

class TasksResource {
  constructor(private client: AgenaClient) {}

  /** Create a new AI task */
  async create(params: TaskCreateParams): Promise<Task> {
    return this.client._request<Task>('POST', '/saas-tasks/', params);
  }

  /** Get a task by ID */
  async get(id: number): Promise<Task> {
    return this.client._request<Task>('GET', `/saas-tasks/${id}`);
  }

  /** List tasks with optional filters */
  async list(params?: { status?: string; page?: number; per_page?: number }): Promise<Task[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.page) query.set('page', String(params.page));
    if (params?.per_page) query.set('per_page', String(params.per_page));
    const qs = query.toString();
    return this.client._request<Task[]>('GET', `/saas-tasks/${qs ? `?${qs}` : ''}`);
  }

  /** Cancel a running task */
  async cancel(id: number): Promise<Task> {
    return this.client._request<Task>('POST', `/saas-tasks/${id}/cancel`);
  }

  /** Rerun a completed/failed task */
  async rerun(id: number): Promise<Task> {
    return this.client._request<Task>('POST', `/saas-tasks/${id}/rerun`);
  }
}

// ─── Flows ─────────────────────────────────────────

class FlowsResource {
  /** Cron schedules for your flows */
  readonly schedules: FlowSchedulesResource;

  constructor(private client: AgenaClient) {
    this.schedules = new FlowSchedulesResource(client);
  }

  /** Execute a flow */
  async run(params: FlowRunParams): Promise<FlowRun> {
    return this.client._request<FlowRun>('POST', '/flows/run', params);
  }

  /** Get a flow run by ID */
  async getRun(runId: string): Promise<FlowRun> {
    return this.client._request<FlowRun>('GET', `/flows/runs/${runId}`);
  }

  /** List recent flow runs */
  async listRuns(): Promise<FlowRun[]> {
    return this.client._request<FlowRun[]>('GET', '/flows/runs');
  }

  /** List flow templates */
  async listTemplates(): Promise<FlowTemplate[]> {
    return this.client._request<FlowTemplate[]>('GET', '/flows/templates');
  }
}

// ─── Agents ────────────────────────────────────────

class AgentsResource {
  constructor(private client: AgenaClient) {}

  /** Run AI agents on a task */
  async run(params: AgentRunParams): Promise<{ status: string }> {
    return this.client._request('POST', '/agents/run', params);
  }

  /** Get live agent status for a task */
  async liveStatus(taskId: number): Promise<AgentLiveStatus> {
    return this.client._request<AgentLiveStatus>('GET', `/agents/live?task_id=${taskId}`);
  }
}

// ─── Integrations ──────────────────────────────────

class IntegrationsResource {
  constructor(private client: AgenaClient) {}

  /** List all configured integrations */
  async list(): Promise<Integration[]> {
    return this.client._request<Integration[]>('GET', '/integrations');
  }

  /** Get a specific integration */
  async get(provider: string): Promise<Integration> {
    return this.client._request<Integration>('GET', `/integrations/${provider}`);
  }

  /** List GitHub repos */
  async githubRepos(): Promise<{ name: string; full_name: string; private: boolean }[]> {
    return this.client._request('GET', '/integrations/github/repos');
  }

  /** List GitHub branches */
  async githubBranches(owner: string, repo: string): Promise<{ name: string }[]> {
    return this.client._request('GET', `/integrations/github/branches?owner=${owner}&repo=${repo}`);
  }
}

// ─── Auth ──────────────────────────────────────────

class AuthResource {
  constructor(private client: AgenaClient) {}

  /** Get current authenticated user */
  async me(): Promise<User> {
    return this.client._request<User>('GET', '/auth/me');
  }

  /** Login and get a token (use the returned token as apiKey) */
  static async login(baseUrl: string, email: string, password: string): Promise<{ access_token: string }> {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new AgenaApiError(res.status, 'Login failed');
    return res.json();
  }
}

// ─── Audit Logs ────────────────────────────────────

class AuditLogsResource {
  constructor(private client: AgenaClient) {}

  private query(params?: AuditLogQuery & { page?: number; page_size?: number }): string {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
    }
    const s = qs.toString();
    return s ? `?${s}` : '';
  }

  /** List audit entries, newest first (owner / admin only) */
  async list(params?: AuditLogQuery & { page?: number; page_size?: number }): Promise<AuditLogPage> {
    return this.client._request<AuditLogPage>('GET', `/audit-logs${this.query(params)}`);
  }

  /** Distinct action names seen in this organization — handy for filter UIs */
  async actions(): Promise<string[]> {
    return this.client._request<string[]>('GET', '/audit-logs/actions');
  }

  /** The filtered entries as CSV text (newest first, up to 10,000 rows) */
  async exportCsv(params?: AuditLogQuery): Promise<string> {
    return this.client._requestText('GET', `/audit-logs/export.csv${this.query(params)}`);
  }
}

// ─── Flow Schedules ────────────────────────────────

class FlowSchedulesResource {
  constructor(private client: AgenaClient) {}

  /** Your schedules, newest first */
  async list(): Promise<FlowSchedule[]> {
    return this.client._request<FlowSchedule[]>('GET', '/flows/schedules');
  }

  /** The next five fire times for a cron + timezone, without saving anything */
  async preview(cron: string, timezone = 'UTC'): Promise<{ cron: string; timezone: string; next_runs: string[] }> {
    const qs = new URLSearchParams({ cron, timezone });
    return this.client._request('GET', `/flows/schedules/preview?${qs.toString()}`);
  }

  /** Schedule a flow; it runs as you */
  async create(params: FlowScheduleCreateParams): Promise<FlowSchedule> {
    return this.client._request<FlowSchedule>('POST', '/flows/schedules', params);
  }

  /** Change the cron, timezone, enabled flag or task payload */
  async update(id: number, params: FlowScheduleUpdateParams): Promise<FlowSchedule> {
    return this.client._request<FlowSchedule>('PUT', `/flows/schedules/${id}`, params);
  }

  async delete(id: number): Promise<{ deleted: boolean }> {
    return this.client._request<{ deleted: boolean }>('DELETE', `/flows/schedules/${id}`);
  }

  /** Run the flow now, outside the schedule (next_run_at is untouched) */
  async runNow(id: number): Promise<FlowSchedule> {
    return this.client._request<FlowSchedule>('POST', `/flows/schedules/${id}/run`);
  }
}

// ─── Outbound Webhooks ─────────────────────────────

class WebhooksResource {
  constructor(private client: AgenaClient) {}

  /** Event types you can subscribe to */
  async eventTypes(): Promise<string[]> {
    return this.client._request<string[]>('GET', '/webhook-endpoints/event-types');
  }

  async list(): Promise<WebhookEndpoint[]> {
    return this.client._request<WebhookEndpoint[]>('GET', '/webhook-endpoints');
  }

  /** Register a URL; the returned `secret` signs every delivery and is shown once */
  async create(params: { name: string; url: string; events?: string[]; enabled?: boolean }): Promise<WebhookEndpointWithSecret> {
    return this.client._request<WebhookEndpointWithSecret>('POST', '/webhook-endpoints', params);
  }

  async update(id: number, params: { name?: string; url?: string; events?: string[]; enabled?: boolean }): Promise<WebhookEndpoint> {
    return this.client._request<WebhookEndpoint>('PUT', `/webhook-endpoints/${id}`, params);
  }

  async rotateSecret(id: number): Promise<WebhookEndpointWithSecret> {
    return this.client._request<WebhookEndpointWithSecret>('POST', `/webhook-endpoints/${id}/rotate-secret`);
  }

  /** Deliver a `ping` right away and return the outcome */
  async test(id: number): Promise<WebhookDelivery> {
    return this.client._request<WebhookDelivery>('POST', `/webhook-endpoints/${id}/test`);
  }

  async deliveries(id: number, limit = 30): Promise<WebhookDelivery[]> {
    return this.client._request<WebhookDelivery[]>('GET', `/webhook-endpoints/${id}/deliveries?limit=${limit}`);
  }

  async delete(id: number): Promise<{ deleted: boolean }> {
    return this.client._request<{ deleted: boolean }>('DELETE', `/webhook-endpoints/${id}`);
  }
}
