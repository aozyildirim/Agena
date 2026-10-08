#!/usr/bin/env bash
#
# Edge integrity check — detects HTML injected between our origin and visitors.
#
# In September 2026 an attacker with dashboard access to our Cloudflare account
# deployed a Worker that appended a malicious loader to every HTML response on
# agena.dev, washiq.app and kaynaklar.net. The origin was untouched, so nothing
# on this box — not the repo, not the build, not the containers — showed a
# trace of it; the only way to see it was to compare what a visitor receives
# against what the origin actually sends.
#
# This script does exactly that comparison, on a schedule:
#
#   1. fetch each page through the public hostname (i.e. through the CDN);
#   2. fetch the same page straight from the origin IP, bypassing the CDN;
#   3. flag any <script> the edge added, plus a handful of known-bad markers.
#
# Known-bad markers are checked on every domain. The structural diff needs the
# origin to be reachable: list a domain as `host=origin-ip` when its origin is
# not ORIGIN_IP, and a bare `host` to use ORIGIN_IP. Where the origin cannot be
# compared (hosted elsewhere, behind its own CDN) the check degrades to
# markers-only and says so rather than guessing.
#
# Usage:
#   scripts/edge-integrity-check.sh                      # check the defaults
#   DOMAINS="a.com b.com=203.0.113.9" ...                # per-domain origins
#   ORIGIN_IP=1.2.3.4 ...                                # default origin
#   ALERT_WEBHOOK=https://hooks.slack.com/... ...        # post failures somewhere
#
# Exit codes: 0 clean, 1 injection detected, 2 could not complete a check.
#
# Cron example (every minute):
#   * * * * * /var/www/tiqr/scripts/edge-integrity-check.sh >> /var/log/edge-integrity.log 2>&1

set -uo pipefail

ORIGIN_IP="${ORIGIN_IP:-92.205.27.116}"
DOMAINS="${DOMAINS:-agena.dev washiq.app kaynaklar.net}"  # `host` or `host=origin-ip`
PATHS="${PATHS:-/}"
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"
CURL_TIMEOUT="${CURL_TIMEOUT:-20}"

# Substrings that are malicious wherever they appear in our HTML. The first
# three are the fingerprint of the Worker we actually got hit with; the rest
# are generic loader patterns worth knowing about immediately.
readonly BAD_MARKERS=(
  '6d4ce63c'            # eth_call selector used to pull the payload on-chain
  'bnbchain.org'
  'data-seed-prebsc'
  'eval(atob('
  'String.fromCharCode.apply'
)

failures=0
errors=0
report=""

note() {
  printf '%s\n' "$1"
  report+="$1"$'\n'
}

for entry in $DOMAINS; do
  domain="${entry%%=*}"
  origin_ip="${entry#*=}"
  [[ "$origin_ip" == "$entry" ]] && origin_ip="$ORIGIN_IP"

  for page in $PATHS; do
    target="https://${domain}${page}"

    edge=$(curl -sS --max-time "$CURL_TIMEOUT" "$target" 2>/dev/null)
    if [[ -z "$edge" ]]; then
      note "ERROR     ${target} — no response through the edge"
      errors=$((errors + 1))
      continue
    fi

    hit=""
    for marker in "${BAD_MARKERS[@]}"; do
      if [[ "$edge" == *"$marker"* ]]; then
        hit+="${marker} "
      fi
    done
    if [[ -n "$hit" ]]; then
      note "INJECTED  ${target} — known-bad markers: ${hit%% }"
      failures=$((failures + 1))
      continue
    fi

    edge_scripts=$(grep -o '<script' <<<"$edge" | wc -l | tr -d ' ')

    # Structural diff, but only when the origin actually answers with the same
    # kind of document. A domain whose origin lives elsewhere answers this
    # request with someone else's 404, and diffing against that would report an
    # injection on every run.
    origin=$(curl -sSk --max-time "$CURL_TIMEOUT" --resolve "${domain}:443:${origin_ip}" "$target" 2>/dev/null)
    if [[ -z "$origin" || "${origin,,}" != *"<html"* ]]; then
      note "markers   ${target} (${edge_scripts} scripts; origin ${origin_ip} served no comparable HTML — structural diff skipped)"
      continue
    fi

    # Script-tag count is the catch-all: it fires on an injected payload we
    # have never seen before, which is the case that matters.
    origin_scripts=$(grep -o '<script' <<<"$origin" | wc -l | tr -d ' ')
    if (( edge_scripts > origin_scripts )); then
      note "INJECTED  ${target} — edge serves ${edge_scripts} <script> tags, origin serves ${origin_scripts}"
      failures=$((failures + 1))
    else
      note "ok        ${target} (${edge_scripts} scripts, matches origin)"
    fi
  done
done

if (( failures > 0 )); then
  summary="🚨 agena edge integrity: ${failures} page(s) serving content the origin never sent. Check the CDN/Cloudflare account for an unexpected Worker, Snippet or Transform Rule."
  note "$summary"
  if [[ -n "$ALERT_WEBHOOK" ]]; then
    curl -sS --max-time 15 -X POST -H 'Content-Type: application/json' \
      --data "$(printf '{"text":%s}' "$(printf '%s\n%s' "$summary" "$report" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" \
      "$ALERT_WEBHOOK" >/dev/null || true
  fi
  exit 1
fi

(( errors > 0 )) && exit 2
exit 0
