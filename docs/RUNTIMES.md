# Runtimes — Compute Environments for Agent Tasks

A Runtime is any compute environment that can execute an agent task:
the host's local CLI bridge (`claude`/`codex` on your PATH), a
teammate's laptop running the same bridge, or a cloud daemon on an
AWS/GCP instance. Each runtime reports its available CLIs, version, and
a periodic heartbeat. The UI surfaces this so you can see at a glance
which compute is online and where a task can actually run.

## End-to-end flow

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. ENROLL — daemon calls /runtimes/register on startup               │
├──────────────────────────────────────────────────────────────────────┤
│   bridge-server.mjs reads AGENA_JWT + AGENA_TENANT_SLUG (env)        │
│     │ (absent → skip auto-register, serve Docker only)               │
│     ▼                                                                │
│   POST /runtimes/register                                            │
│     Authorization: Bearer <JWT>                                      │
│     X-Tenant-Slug: <slug>                                            │
│     body: { name, kind, available_clis[], daemon_version, host }     │
│     ▼                                                                │
│   RuntimeService.register():                                         │
│     1. Look up Runtime by (org_id, name); create if missing          │
│     2. Mint a fresh token (secrets.token_urlsafe(32))                │
│     3. Hash with sha-256 and store on the row                        │
│     4. Return { runtime_id, name, auth_token } — token only once     │
│     ▼                                                                │
│   Bridge persists { runtime_id, token } to ~/.agena/runtime.json     │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 2. HEARTBEAT — every 30s                                             │
├──────────────────────────────────────────────────────────────────────┤
│   POST /runtimes/{id}/heartbeat                                      │
│     X-Runtime-Token: <raw token>                                     │
│     body: { available_clis, daemon_version, host }                   │
│     ▼                                                                │
│   RuntimeService.heartbeat():                                        │
│     - Verify sha256(token) == stored hash                            │
│     - Refresh last_heartbeat_at = now                                │
│     - Update available_clis / daemon_version / host                  │
│     - Set status = 'active'                                          │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 3. UI POLLS — /runtimes GET every 10s on the dashboard page          │
├──────────────────────────────────────────────────────────────────────┤
│   RuntimeService.derive_status(runtime):                             │
│     - 'disabled' → stays disabled                                    │
│     - last_heartbeat_at is None OR age > 120s → 'offline'            │
│     - otherwise → 'active'                                           │
│   Status dot colour:                                                 │
│     green  = active                                                  │
│     grey   = offline                                                 │
│     red    = disabled                                                │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 4. TASK ROUTING (stub, not yet wired)                                │
├──────────────────────────────────────────────────────────────────────┤
│   GET /runtimes/{id}/tasks/next                                      │
│     X-Runtime-Token: <raw token>                                     │
│     ▼                                                                │
│   Currently returns { task: null, poll_interval_sec } — the endpoint │
│   exists so daemons can be written against the stable shape now.     │
│   Wiring per-runtime task dispatch (so a task assigned to a runtime  │
│   is only pulled by THAT daemon) is a follow-up.                     │
└──────────────────────────────────────────────────────────────────────┘
```

## Env vars (bridge auto-register)

Set these in the shell where you run `bridge-server.mjs` (or in
`start.sh`):

```bash
export AGENA_JWT="eyJhbGciOi..."        # user JWT from the dashboard
export AGENA_TENANT_SLUG="test-org"     # your org slug
export AGENA_RUNTIME_NAME="ali-mac"     # optional, defaults to "$USER's $platform"
export AGENA_BACKEND_URL="http://localhost:8010"  # optional
```

Without `AGENA_JWT` the bridge logs `skipping auto-register` and runs
exactly as before. With the vars set, it enrolls itself + heartbeats.

## Key files

| Concern | File |
|---|---|
| ORM model | `packages/models/src/agena_models/models/runtime.py` |
| Schemas | `packages/models/src/agena_models/schemas/runtime.py` |
| Service | `packages/services/src/agena_services/services/runtime_service.py` |
| HTTP API | `packages/api/src/agena_api/api/routes/runtimes.py` |
| Bridge enrollment | `docker/bridge-server.mjs` (bottom of file) |
| UI catalog | `frontend/app/dashboard/runtimes/page.tsx` |
| Migration — table | `alembic/versions/3bb4644bdfa2_add_runtimes_table.py` |
| Migration — module | `alembic/versions/7c771ad7939f_register_runtimes_module.py` |

## Tuning

- `HEARTBEAT_INTERVAL_SEC = 30` (service constant) — also returned to
  the daemon in the register response, so either side can bump it.
- `OFFLINE_AFTER_SEC = 120` — a runtime is marked `offline` after its
  last heartbeat is this old.

## Security notes

- Raw tokens are never stored; only sha-256 hashes. A DB leak reveals
  runtime IDs but not usable tokens.
- Register requires tenant auth (user JWT). Heartbeat/tasks-next use
  only the runtime token and the runtime id — no user context needed,
  so daemons don't ship user JWTs.
- Deleting a runtime row invalidates its token (no row = 401 on all
  daemon endpoints).

## What's next (CLI project)

The dedicated `agena-cli` project will package:
- `agena setup` → one-shot login (browser), writes a JWT to keychain
- `agena daemon start` → spawns `bridge-server.mjs` with the right
  env vars pre-filled
- `agena runtime list` / `agena runtime rename` — mirrors the UI
- Homebrew tap + GoReleaser release pipeline

Until that ships, run the bridge manually per the env-var recipe
above.
