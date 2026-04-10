#!/bin/bash
# Fix volume ownership (volumes are created as root by Docker)
chown -R bridge:bridge /home/bridge/.claude /home/bridge/.codex /home/bridge/.claude.json 2>/dev/null || true
exec runuser -u bridge -- node /app/bridge-server.mjs
