# @agena/sdk

Official TypeScript SDK for the [AGENA](https://agena.dev) Agentic AI Platform API.

## Installation

```bash
npm install @agena/sdk
```

## Quick Start

```typescript
import { AgenaClient } from '@agena/sdk';

const agena = new AgenaClient({
  apiKey: 'your-jwt-token',
  baseUrl: 'https://api.agena.dev', // optional, this is the default
});

// Create a task
const task = await agena.tasks.create({
  title: 'Add dark mode support',
  description: 'Implement a dark/light theme toggle in the settings page',
});

console.log(`Task #${task.id} created: ${task.status}`);

// Check task status
const updated = await agena.tasks.get(task.id);
console.log(`Status: ${updated.status}`);
console.log(`PR: ${updated.pr_url}`);
```

## Authentication

Create an API key in the dashboard under **Administration → API Keys** (owner / admin). Keys look like `agena_…`, are shown once, act as the member who created them (never above admin), and can be revoked at any time.

```typescript
import { AgenaClient } from '@agena/sdk';

const agena = new AgenaClient({ apiKey: process.env.AGENA_API_KEY! });
```

A short-lived session token also works — handy for scripts run by a signed-in user:

```typescript
const { access_token } = await AgenaClient.auth.login(
  'https://api.agena.dev',
  'you@email.com',
  'your-password'
);
const agena = new AgenaClient({ apiKey: access_token });
```

## Resources

### Tasks

```typescript
// Create a task
const task = await agena.tasks.create({ title: '...', description: '...' });

// List tasks
const tasks = await agena.tasks.list({ status: 'completed' });

// Get task details
const detail = await agena.tasks.get(123);

// Cancel a task
await agena.tasks.cancel(123);

// Rerun a task
await agena.tasks.rerun(123);
```

### Flows

```typescript
// Run a flow
const run = await agena.flows.run({ flow_id: 1 });

// Check run status
const status = await agena.flows.getRun(run.id);

// List recent runs
const runs = await agena.flows.listRuns();

// List templates
const templates = await agena.flows.listTemplates();
```

### Flow schedules

```typescript
// Weekdays at 09:00 Istanbul time, running as you
const schedule = await agena.flows.schedules.create({
  flow_id: 'my-flow-id',
  cron: '0 9 * * 1-5',
  timezone: 'Europe/Istanbul',
});

// What will fire next?
const { next_runs } = await agena.flows.schedules.preview('0 9 * * 1-5', 'Europe/Istanbul');

// Pause, run immediately, remove
await agena.flows.schedules.update(schedule.id, { enabled: false });
await agena.flows.schedules.runNow(schedule.id);
await agena.flows.schedules.delete(schedule.id);
```

### Agents

```typescript
// Run agents on a task
await agena.agents.run({ task_id: 123 });

// Get live status
const live = await agena.agents.liveStatus(123);
live.agents.forEach(a => console.log(`${a.role}: ${a.status}`));
```

### Integrations

```typescript
// List integrations
const integrations = await agena.integrations.list();

// List GitHub repos
const repos = await agena.integrations.githubRepos();

// List branches
const branches = await agena.integrations.githubBranches('owner', 'repo');
```

### Audit Logs

Owner / admin only. Every state-changing request a member makes is recorded — who, what, on which resource, from where. Request bodies are never stored.

```typescript
// Newest first, 50 per page
const page = await agena.auditLogs.list({ action: 'tasks.assign_task', page: 1 });

// Distinct action names (for a filter dropdown)
const actions = await agena.auditLogs.actions();

// CSV export of the filtered entries
const csv = await agena.auditLogs.exportCsv({ created_from: '2026-10-01' });
```

### Outbound webhooks

Every Agena event (task queued/completed/failed, PR created, security alerts, …) can be pushed to your own URL as a signed JSON POST, retried with backoff up to five times.

```typescript
const { secret } = await agena.webhooks.create({
  name: 'ops bridge',
  url: 'https://example.com/agena',
  events: ['task_completed', 'task_failed', 'security_alert'], // or ['*']
});
```

Verify deliveries with the secret — the signature covers `"<timestamp>.<raw body>"`:

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret: string, headers: Record<string, string>, rawBody: Buffer): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret)
    .update(`${headers['x-agena-timestamp']}.`).update(rawBody).digest('hex');
  const got = headers['x-agena-signature'] ?? '';
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
```

### Weekly digest

Every Monday owners and admins get a summary of the week — tasks, PRs, flow runs, AI spend, audit activity — through their notification channels. Preview or trigger it from code:

```typescript
const { title, message, digest } = await agena.digest.weeklyPreview();
await agena.digest.sendWeeklyToMe();
```

## Error Handling

```typescript
import { AgenaClient } from '@agena/sdk';

try {
  const task = await agena.tasks.get(999);
} catch (err) {
  if (err.name === 'AgenaApiError') {
    console.error(`API Error ${err.status}: ${err.detail}`);
  }
}
```

## License

MIT
