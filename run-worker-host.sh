#!/bin/bash
# Host worker — runs outside Docker so codex/claude CLIs are available
# Usage: ./run-worker-host.sh

set -e
cd "$(dirname "$0")"

# Load .env safely (handles values with spaces)
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  value="${value%%#*}"    # strip inline comments
  value="${value%"${value##*[![:space:]]}"}"  # strip trailing spaces
  export "$key=$value" 2>/dev/null || true
done < .env

# Override Docker-internal hostnames with localhost
export REDIS_HOST=localhost
export REDIS_PORT=6379
export MYSQL_HOST=localhost
export MYSQL_PORT=3307
export QDRANT_URL=http://localhost:6333

echo "=== Tiqr Host Worker ==="
echo "  Redis: $REDIS_HOST:$REDIS_PORT"
echo "  MySQL: $MYSQL_HOST:$MYSQL_PORT"
echo "  codex: $(which codex 2>/dev/null || echo 'not found')"
echo "  claude: $(which claude 2>/dev/null || echo 'not found')"
echo "========================"

python3 -m workers.redis_worker
