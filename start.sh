#!/bin/bash
# Start Agena development environment
# Docker: mysql, redis, qdrant, backend, worker, frontend_blue, frontend_green
# Local:  CLI bridge (codex/claude run natively on host)
#
# Ports:
#   3011  Frontend Blue (prod)
#   3012  Frontend Green (prod)
#   8010  Backend API
#   9876  CLI Bridge
#   3307  MySQL
#   6380  Redis
#   6333  Qdrant

set -e
cd "$(dirname "$0")"

# Host-side absolute path for task attachment storage. Containers serve
# files via /app/data, but the local CLI runs on the host and needs the
# real macOS path so it can open uploaded images/files.
export ATTACHMENT_HOST_ROOT="$(pwd)/data"

# ── Port conflict check ──────────────────────────────────────────────
check_port() {
  local port=$1 name=$2
  local pid=$(lsof -ti:$port 2>/dev/null | head -1)
  if [ -n "$pid" ]; then
    local cmd=$(ps -p $pid -o comm= 2>/dev/null || echo "unknown")
    echo "  WARNING: Port $port ($name) already in use by $cmd (PID $pid)"
    return 1
  fi
  return 0
}

echo "=== Checking ports ==="
CONFLICT=0
check_port 3011 "Frontend Blue"  || CONFLICT=1
check_port 3012 "Frontend Green" || CONFLICT=1
check_port 8010 "Backend"    || CONFLICT=1
check_port 9876 "CLI Bridge" || CONFLICT=1
check_port 3307 "MySQL"      || CONFLICT=1
check_port 6380 "Redis"      || CONFLICT=1
check_port 6333 "Qdrant"     || CONFLICT=1

if [ $CONFLICT -eq 1 ]; then
  echo ""
  echo "  Run ./stop.sh first or kill conflicting processes."
  echo "  Continuing anyway in 3s..."
  sleep 1
fi
echo ""

# ── Docker services ──────────────────────────────────────────────────
echo "=== Starting Docker services ==="
# Exclude cli-bridge (runs on host) and dev frontend (port 3010 used by other project)
docker-compose up -d --build mysql redis qdrant backend worker frontend_blue frontend_green 2>&1 | grep -v "obsolete" || true
echo ""

echo "=== Waiting for MySQL ==="
for i in $(seq 1 30); do
  docker exec ai_agent_mysql mysql -uroot -proot_password -e "SELECT 1" &>/dev/null && break
  sleep 1
done
echo "  MySQL ready"

echo "=== Configuring Redis ==="
docker exec ai_agent_redis redis-cli CONFIG SET stop-writes-on-bgsave-error no &>/dev/null || true
echo "  Redis ready"

# ── Database migrations ──────────────────────────────────────────────
# Wait for backend to finish `pip install -e` before running alembic.
# Skip silently if already at head; otherwise upgrade so the modules
# table (which drives the sidebar) is seeded on fresh checkouts.
echo ""
echo "=== Applying DB migrations ==="
for i in $(seq 1 30); do
  docker exec ai_agent_api alembic current &>/dev/null && break
  sleep 1
done
docker exec ai_agent_api alembic upgrade head 2>&1 | grep -E "Running upgrade|alembic" | tail -5 || echo "  (migrations skipped — backend not ready)"

# ── CLI Bridge (host) ────────────────────────────────────────────────
echo ""
echo "=== Starting CLI bridge ==="
# Kill any existing bridge
if [ -f /tmp/agena-bridge.pid ]; then
  kill "$(cat /tmp/agena-bridge.pid)" 2>/dev/null || true
  rm -f /tmp/agena-bridge.pid
fi
lsof -ti:9876 2>/dev/null | xargs kill 2>/dev/null || true
sleep 0.5

# Start bridge (host-native for claude/codex access)
node docker/bridge-server.mjs &>/tmp/agena-bridge.log &
BRIDGE_PID=$!
echo $BRIDGE_PID > /tmp/agena-bridge.pid

# Wait for bridge to be ready
for i in $(seq 1 10); do
  if curl -s http://localhost:9876/health &>/dev/null; then
    break
  fi
  sleep 0.5
done

HEALTH=$(curl -s http://localhost:9876/health 2>/dev/null || echo '{"status":"error"}')
echo "  CLI Bridge started (PID: $BRIDGE_PID)"
echo "  Health: $HEALTH"

# ── Summary ──────────────────────────────────────────────────────────
echo ""
echo "=== Agena is running ==="
echo ""
echo "  Frontend:  http://localhost:3011 (blue) / http://localhost:3012 (green)"
echo "  API:       http://localhost:8010"
echo "  API Docs:  http://localhost:8010/docs"
echo "  Bridge:    http://localhost:9876"
echo "  MySQL:     localhost:3307"
echo "  Redis:     localhost:6380"
echo "  Qdrant:    localhost:6333"
echo ""
echo "  Logs:  docker-compose logs -f backend worker"
echo "  Bridge log: tail -f /tmp/agena-bridge.log"
echo ""
echo "  Run ./stop.sh to stop everything"
