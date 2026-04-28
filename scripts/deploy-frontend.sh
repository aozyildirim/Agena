#!/bin/bash
# Zero-downtime blue/green frontend deploy
# Nginx routes to both 3011 (blue) and 3012 (green) with least_conn.
# We rebuild one at a time so the other keeps serving traffic.

set -e
cd /var/www/tiqr

echo "=== Zero-downtime frontend deploy ==="

# 0) Regenerate changelog data from git history
echo "[0/4] Generating changelog-data.json..."
git log --oneline -1000 --format="%h|%s|%ai|%an" | python3 -c "
import json, sys, re
lines = sys.stdin.read().strip().split('\n')
commits = []
for line in lines:
    parts = line.split('|', 3)
    if len(parts) < 4: continue
    short, message, date, author = parts
    msg_clean = message
    ctype = 'other'
    for prefix in ['feat', 'fix', 'docs', 'chore', 'refactor', 'style', 'test', 'perf', 'ci', 'build']:
        if message.startswith(prefix):
            ctype = prefix if prefix in ('feat','fix','docs') else 'other'
            msg_clean = re.sub(r'^(feat|fix|docs|chore|refactor|style|test|perf|ci|build)(\(.+?\))?:\s*', '', message)
            break
    commits.append({'hash': short, 'short': short, 'message': msg_clean, 'date': date[:10], 'author': author, 'type': ctype})
json.dump(commits, open('frontend/public/changelog-data.json','w'), indent=2)
print(f'  Generated {len(commits)} changelog entries')
"

# 1) Rebuild BLUE while GREEN keeps serving
echo "[1/4] Rebuilding frontend_blue..."
docker-compose up -d --build --no-deps frontend_blue

echo "[2/4] Waiting for frontend_blue to be healthy..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null http://127.0.0.1:3011; then
    echo "  frontend_blue is UP"
    break
  fi
  [ "$i" -eq 30 ] && { echo "ERROR: frontend_blue failed to start"; exit 1; }
  sleep 2
done

# 2) Rebuild GREEN while BLUE keeps serving
echo "[3/4] Rebuilding frontend_green..."
docker-compose up -d --build --no-deps frontend_green

echo "[4/4] Waiting for frontend_green to be healthy..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null http://127.0.0.1:3012; then
    echo "  frontend_green is UP"
    break
  fi
  [ "$i" -eq 30 ] && { echo "ERROR: frontend_green failed to start"; exit 1; }
  sleep 2
done

echo "=== Deploy complete — zero downtime ==="
