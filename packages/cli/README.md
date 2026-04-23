# @agenaai/cli

Official command-line tool for AGENA — enroll your machine as a
Runtime, manage the CLI bridge daemon, and drive the whole platform
(tasks, skills, sprint refinement) from the terminal.

## Install

```bash
# Homebrew (macOS / Linux) — recommended
brew install aozyildirim/tap/agena

# npm (any platform)
npm install -g @agenaai/cli

# one-shot
npx @agenaai/cli --help
```

## First-run setup

```bash
agena setup
```

Walks you through:

1. **Pick a backend + tenant** (defaults to `https://api.agena.dev`).
2. **Browser-based OAuth** via RFC 8628 device-code flow — no token
   copy-paste. (Falls back to manual JWT paste for CI / headless
   shells; the key in DevTools is `localStorage.agena_token`.)
3. **Starts the bridge daemon**, which auto-enrolls this machine as
   a Runtime.

Config lives in `~/.agena/config.json`; the JWT is stored in the OS
keychain (macOS Keychain / libsecret / Windows Credential Manager)
when available, falling back to the config file.

## Commands

### Auth & tenant

```
agena login                    Device-code OAuth (or --jwt to paste manually)
agena setup                    Login + daemon start in one shot
agena whoami                   Current user, tenant, JWT source
agena org list                 Organizations you belong to
agena org switch <slug>        Switch the active tenant for this CLI
```

### Daemon (local CLI bridge)

The bridge is the process Agena's backend calls into to drive Claude
Code / Codex on your machine. Starting the daemon also enrolls this
host in the Runtimes registry.

```
agena daemon start             Spawn the bridge, auto-enroll
agena daemon stop              Kill the running daemon
agena daemon status            Is it running?
agena daemon logs -n 100       Tail the daemon log
```

### Runtimes

```
agena runtime list             Every runtime on the tenant + status
agena runtime status <id>      Detail view for one runtime
```

### Tasks

```
agena task list                Recent tasks (filter: -s running, etc.)
agena task show <id>           Full task detail
agena task logs <id>           Tail the task's log trail
agena task create -t "Fix bug" --assign
                               Create a task and immediately enqueue
                               it for the AI agent
```

### Skill catalog

Skills are reusable patterns the platform auto-extracts from
completed tasks — they get prepended to agent system prompts when a
new task matches.

```
agena skill list               Browse the catalog
agena skill list -q auth       Search by name/tag/description
agena skill show <id>          Full skill incl. prompt fragment
agena skill search "fix 502"   Vector-search the catalog
agena skill delete <id> -y     Remove a skill
```

### Sprint refinement (history-grounded story points)

Qdrant-backed retrieval over the team's completed work items —
grounds LLM estimates in the project's real history.

```
agena refinement backfill -p MyProject -t MyTeam --days 730
                               Kick off the Azure/Jira → Qdrant import
agena refinement backfill-status
                               Poll the indexer
agena refinement history       List what's currently indexed
agena refinement history --sp 5 -q "auth"
                               Filter by SP / keyword
agena refinement analyze -p MyProject -t MyTeam --sprint-path '...'
                               Estimate SP for an upcoming sprint
```

All commands read `~/.agena/config.json`. `agena login` is
idempotent — re-run it to rotate JWT or switch tenant.

## How it talks to the backend

Every command hits the same REST API the dashboard uses
(`/tasks`, `/skills`, `/runtimes`, `/refinement/*`, `/auth/me`,
`/auth/device/*`). The CLI is a thin client — no business logic
lives here. See `packages/sdk/` for a reusable TypeScript client.

## Bundled bridge

`agena daemon start` looks for `bridge-server.mjs` in this order:

1. Bundled inside the npm package (`<install-dir>/bridge/`)
2. Monorepo checkout (`../../docker/bridge-server.mjs`)
3. `~/.agena/bridge-server.mjs`
4. `./docker/bridge-server.mjs` in the current working directory

The npm package ships the bridge so `npm install -g @agenaai/cli`
is self-contained.
