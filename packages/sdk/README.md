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

Get your API token by logging in:

```typescript
import { AgenaClient } from '@agena/sdk';

// Login to get a token
const { access_token } = await AgenaClient.auth.login(
  'https://api.agena.dev',
  'you@email.com',
  'your-password'
);

// Use the token
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
