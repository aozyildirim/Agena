#!/bin/bash
# Install git hooks that keep the changelog fresh automatically.
# Run once: ./scripts/install-git-hooks.sh
set -e
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

HOOKS_DIR="$(git rev-parse --git-path hooks)"
mkdir -p "$HOOKS_DIR"

for hook in post-merge post-commit post-rewrite; do
  cat > "$HOOKS_DIR/$hook" <<'EOF'
#!/bin/bash
# Auto-refresh changelog after pull/commit. Non-blocking: never fail the git op.
REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -x "$REPO/scripts/refresh-changelog.sh" ] && "$REPO/scripts/refresh-changelog.sh" || true
EOF
  chmod +x "$HOOKS_DIR/$hook"
  echo "installed: $HOOKS_DIR/$hook"
done
