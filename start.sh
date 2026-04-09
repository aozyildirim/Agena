#!/bin/bash
# Start Agena development environment
# Docker: mysql, redis, qdrant, backend, worker, frontend
# Local: CLI bridge (codex/claude run natively on host)

set -e
cd "$(dirname "$0")"

echo "=== Starting Docker services ==="
docker-compose up -d mysql redis qdrant backend worker frontend
echo ""

echo "=== Waiting for MySQL ==="
until docker exec ai_agent_mysql mysql -uroot -proot_password -e "SELECT 1" &>/dev/null; do
  sleep 1
done
echo "MySQL ready"

echo "=== Fixing Redis ==="
docker exec ai_agent_redis redis-cli CONFIG SET stop-writes-on-bgsave-error no &>/dev/null || true
echo "Redis ready"

echo ""
echo "=== Starting local CLI bridge ==="
# Kill existing bridge if running
if [ -f /tmp/agena-bridge.pid ]; then
  kill "$(cat /tmp/agena-bridge.pid)" 2>/dev/null || true
  rm -f /tmp/agena-bridge.pid
fi

# Start bridge locally (codex/claude use host auth & sandbox)
node docker/bridge-server.mjs &>/tmp/agena-bridge.log &
echo $! > /tmp/agena-bridge.pid
echo "CLI bridge started (PID: $(cat /tmp/agena-bridge.pid), log: /tmp/agena-bridge.log)"

echo ""
echo "=== Agena is running ==="
echo "  Frontend:  http://localhost:3010"
echo "  API:       http://localhost:8010"
echo "  Bridge:    http://localhost:9876"
echo ""
echo "Run ./stop.sh to stop everything"
