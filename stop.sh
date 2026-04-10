#!/bin/bash
# Stop Agena development environment

set -e
cd "$(dirname "$0")"

echo "=== Stopping local CLI bridge ==="
if [ -f /tmp/agena-bridge.pid ]; then
  kill "$(cat /tmp/agena-bridge.pid)" 2>/dev/null && echo "  Bridge stopped" || true
  rm -f /tmp/agena-bridge.pid
fi
# Also kill by port in case PID file is stale
lsof -ti:9876 2>/dev/null | xargs kill 2>/dev/null && echo "  Bridge killed (port 9876)" || echo "  No bridge running"

echo ""
echo "=== Stopping Docker services ==="
docker-compose down --remove-orphans 2>&1 | grep -v "obsolete" || true

echo ""
echo "=== Agena stopped ==="
