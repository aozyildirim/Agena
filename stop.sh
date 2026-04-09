#!/bin/bash
# Stop Agena development environment

set -e
cd "$(dirname "$0")"

echo "=== Stopping local CLI bridge ==="
if [ -f /tmp/agena-bridge.pid ]; then
  kill "$(cat /tmp/agena-bridge.pid)" 2>/dev/null && echo "Bridge stopped" || echo "Bridge was not running"
  rm -f /tmp/agena-bridge.pid
else
  # Try to find and kill by port
  lsof -ti:9876 2>/dev/null | xargs kill 2>/dev/null && echo "Bridge stopped (by port)" || echo "No bridge running"
fi

echo ""
echo "=== Stopping Docker services ==="
docker-compose stop
echo ""
echo "=== Agena stopped ==="
