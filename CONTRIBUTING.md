# Contributing to AGENA

Thanks for contributing.

## Development Setup

1. Fork and clone the repository.
2. Copy env files:
   - `cp .env.example .env`
   - `cp frontend/.env.example frontend/.env.local`
3. Start stack:
   - `docker compose up --build`
4. Run tests before opening PR:
   - backend: `pytest`
   - frontend: `cd frontend && npm run lint`

## Branch and Commits

- Create feature branches from `main`.
- Prefer clear commit messages (Conventional Commits style is recommended):
  - `feat(frontend): add patron mode animation`
  - `fix(api): handle missing org slug`

## Pull Requests

- Keep PR scope focused.
- Add screenshots for UI changes.
- Link related issue(s).
- Ensure no secrets are committed.

## Code Style

- Follow existing project patterns.
- Keep changes minimal and production-safe.
- Add/update docs when behavior changes.
