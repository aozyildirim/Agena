# @agena/cli

Official command-line tool for AGENA — enroll your machine as a
Runtime, manage the CLI bridge daemon, and inspect the backend from
the terminal.

## Install

```bash
npm install -g @agena/cli
# or use it one-shot
npx @agena/cli --help
```

## First-run setup

```bash
agena setup
```

Walks you through:

1. **Pick a backend + tenant** (defaults to `https://api.agena.dev`).
2. **Paste a JWT** — for now you grab it from the dashboard
   (`localStorage.auth_token` in DevTools). Proper OAuth ships with
   the Go rewrite.
3. **Starts the daemon** (`bridge-server.mjs`) with the env vars
   auto-enrollment needs.

Your config is saved to `~/.agena/config.json`; the daemon's runtime
token lives in `~/.agena/runtime.json`.

## Commands

```
agena login                    Auth only (interactive)
agena setup                    Login + daemon start in one shot

agena daemon start             Spawn the bridge, auto-enroll
agena daemon stop              Kill the running daemon
agena daemon status            Is it running?
agena daemon logs -n 100       Tail the daemon log

agena runtime list             Every runtime on the tenant + status
agena runtime status <id>      Detail view for one runtime
```

All commands read `~/.agena/config.json`. `agena login` is idempotent
— re-run it to rotate JWT or switch tenant.

## What's next

The Go-based rewrite (`agena-ai/tap/agena`) will add:

- Browser-based OAuth device-code flow (no JWT copy-paste).
- Keychain credential storage on macOS/Linux/Windows.
- Shipped binaries via Homebrew tap + GoReleaser.
- `agena task create`, `agena task logs`, `agena skill list`.

The backend endpoints this CLI talks to are stable — future binaries
use the same contracts.
