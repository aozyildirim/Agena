#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# setup-demo.sh — create a fully-populated demo organization for presentations.
#
# Creates (or reuses) a demo user + org, then seeds believable fictional data
# across every DB-backed module. Works locally and on a live server (anywhere
# docker-compose + the API are reachable).
#
#   ./scripts/setup-demo.sh
#
# Override defaults via env:
#   DEMO_EMAIL=demo@you.com DEMO_PASSWORD=secret DEMO_ORG_NAME="Acme" \
#   API_URL=http://localhost:8010 ./scripts/setup-demo.sh
#
# NOTE: Sprint Board, Sprint Performance and New Relic read from a LIVE
# Azure DevOps / Jira / New Relic connection and cannot be filled from the DB.
# To demo those, connect a real integration for the demo org. Everything else
# (incl. DORA, computed from seeded git history) is populated by this script.
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

EMAIL="${DEMO_EMAIL:-bb@bb.com}"
PASSWORD="${DEMO_PASSWORD:-test}"
ORG_NAME="${DEMO_ORG_NAME:-Northwind Commerce}"
FULL_NAME="${DEMO_FULL_NAME:-Demo User}"
API_URL="${API_URL:-http://localhost:8010}"

echo "▶ Demo setup → ${EMAIL} @ \"${ORG_NAME}\" (API ${API_URL})"

# 1) Create the user/org via signup; if it already exists, log in instead.
signup_payload=$(EMAIL="$EMAIL" PASSWORD="$PASSWORD" ORG_NAME="$ORG_NAME" FULL_NAME="$FULL_NAME" \
  node -e 'console.log(JSON.stringify({email:process.env.EMAIL,password:process.env.PASSWORD,full_name:process.env.FULL_NAME,organization_name:process.env.ORG_NAME}))')

resp=$(curl -s -X POST "$API_URL/auth/signup" -H 'Content-Type: application/json' -d "$signup_payload" || true)

ids=$(EMAIL="$EMAIL" PASSWORD="$PASSWORD" API_URL="$API_URL" RESP="$resp" node -e '
const resp = process.env.RESP || "";
function out(o,u){ if(o&&u){ console.log(o+" "+u); process.exit(0);} }
try { const j = JSON.parse(resp); if (j.organization_id && j.user_id) out(j.organization_id, j.user_id); } catch(e) {}
// signup failed (likely user exists) -> login and decode the JWT
(async () => {
  const r = await fetch(process.env.API_URL + "/auth/login", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({email:process.env.EMAIL, password:process.env.PASSWORD}) });
  if (!r.ok) { console.error("login failed: " + r.status + " " + (await r.text())); process.exit(1); }
  const j = await r.json();
  const p = JSON.parse(Buffer.from(j.access_token.split(".")[1], "base64").toString());
  if (!p.org_id || !p.user_id) { console.error("no ids in token"); process.exit(1); }
  console.log(p.org_id + " " + p.user_id);
})().catch(e => { console.error(String(e)); process.exit(1); });
')

ORG_ID=$(echo "$ids" | awk '{print $1}')
USER_ID=$(echo "$ids" | awk '{print $2}')
if [ -z "${ORG_ID:-}" ] || [ -z "${USER_ID:-}" ]; then
  echo "✗ Could not resolve org/user id. Is the API reachable at ${API_URL}?"; exit 1
fi
echo "✓ user ready — org_id=${ORG_ID} user_id=${USER_ID}"

# 2) Seed all DB-backed demo data inside the backend container.
echo "▶ Seeding demo data…"
docker-compose exec -T \
  -e DEMO_ORG_ID="$ORG_ID" -e DEMO_USER_ID="$USER_ID" \
  backend python - < scripts/seed_demo_data.py

cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Demo ready.   Sign in:  ${EMAIL} / ${PASSWORD}

Populated: Tasks, AI Reviews, Refinement, Triage, PR Review Backlog, Agents,
Insights, Flows, Prompt Studio, Flow Templates, Skills, Runtimes, DORA,
Integrations, Integration Rules, Repo Mapping, Workspaces, Workspace Roles,
Modules, Usage, Notifications, Profile.

⚠ Sprint Board, Sprint Performance and New Relic need a LIVE Azure DevOps /
  Jira / New Relic connection — connect one in Integrations to demo them.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
