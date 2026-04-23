# agena (Go)

Go-based companion to `@agena/cli` (Node). This is the binary published
to Homebrew via `brew install aozyildirim/tap/agena`. It currently runs
as a thin shim that delegates to the Node CLI for the actual work —
commands will be ported to native Go one at a time.

## Status

| Command       | Native in Go? | Notes |
|---------------|:-------------:|-------|
| `login`       | ❌ shim        | Delegates to `@agena/cli`. Port blocked on device-flow polling loop + keyring integration. |
| `setup`       | ❌ shim        | Same as login. |
| `daemon`      | ❌ shim        | Node spawns bridge-server.mjs. |
| `runtime list/status` | ❌ shim | Straightforward to port next (just HTTP). |

## Build

```bash
cd packages/cli-go
go mod tidy
go build -o agena ./cmd/agena
./agena --version
```

## Release (tag-driven)

1. Bump version in `cmd/agena/main.go` (`Version = "0.1.1"`) — optional;
   GoReleaser stamps it from the tag anyway.
2. Tag: `git tag v0.1.1 && git push --tags`
3. `.github/workflows/release-cli.yml` fires:
   - GoReleaser builds cross-platform binaries
   - Uploads to GitHub releases
   - Updates the Homebrew tap (needs `HOMEBREW_TAP_TOKEN` secret)
   - Publishes `@agena/cli` to npm (needs `NPM_TOKEN` secret)

## Prereqs for the first release

- Create `aozyildirim/homebrew-tap` repo (GitHub)
- Copy `Formula/agena.rb.template` → `Formula/agena.rb` in that repo
- Generate a PAT with `repo` scope + save as `HOMEBREW_TAP_TOKEN` on
  the main repo's Actions secrets
- Generate an npm automation token + save as `NPM_TOKEN`
- Create a GitHub Release workflow trigger (tag push)

## Why a shim?

Shipping a usable `brew install agena` today, without rewriting all
three commands in Go, means users on macOS/Linux can install via their
usual package manager while the Go port lands iteratively. Each command
migration to Go drops the Node dependency one step further.
