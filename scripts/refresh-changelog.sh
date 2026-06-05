#!/bin/bash
# Regenerate changelog-data.json from git history and push it into the
# running blue/green frontend containers WITHOUT a rebuild.
#
# Next.js serves files under /app/public/ straight from disk at request time,
# so `docker cp` makes the new changelog live immediately. A later
# `deploy-frontend.sh` rebuild bakes the same file into the image (step [0/4]),
# so the two stay consistent.
#
# Wired as a git post-merge + post-commit hook (see scripts/install-git-hooks.sh)
# so `git pull` / `git commit` keep the changelog fresh automatically.

set -e
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

OUT="frontend/public/changelog-data.json"

git log --oneline -100000 --format="%h|%s|%ai|%an" | python3 -c "
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
json.dump(commits, open('$OUT','w'), indent=2)
print(f'  changelog: {len(commits)} entries')
"

# Push into any running frontend containers (no rebuild needed)
for c in ai_agent_frontend_blue ai_agent_frontend_green; do
  if docker ps --format '{{.Names}}' | grep -qx "$c"; then
    docker cp "$OUT" "$c:/app/public/changelog-data.json" 2>/dev/null \
      && echo "  -> copied into $c" \
      || echo "  -> skip $c (copy failed)"
  fi
done
