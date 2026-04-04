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

  constructor(config: AgenaConfig) {
    this.baseUrl = (config.baseUrl || 'https://api.agena.dev').replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 30000;

    this.tasks = new TasksResource(this);
    this.flows = new FlowsResource(this);
    this.agents = new AgentsResource(this);
    this.integrations = new IntegrationsResource(this);
    this.auth = new AuthResource(this);
  }

  /** Internal: make an authenticated API request */
  async _request<T>(method: string, path: string, body?: unknown): Promise<T> {
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

      return res.json() as Promise<T>;
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
  constructor(private client: AgenaClient) {}

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
