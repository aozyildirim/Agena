from __future__ import annotations

import hashlib
import logging
from typing import Any

import httpx

from agena_models.schemas.task import ExternalTask

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# NerdGraph helper
# ---------------------------------------------------------------------------

def _nr_headers(api_key: str) -> dict[str, str]:
    return {'Api-Key': api_key, 'Content-Type': 'application/json'}


class NewRelicClient:
    """Async client for New Relic NerdGraph (GraphQL) API."""

    def __init__(self) -> None:
        self.default_url = 'https://api.newrelic.com/graphql'

    # -- config helpers -----------------------------------------------------

    def _resolve(self, cfg: dict[str, str] | None) -> tuple[str, str]:
        """Return (graphql_url, api_key) from config dict."""
        cfg = cfg or {}
        url = cfg.get('base_url') or self.default_url
        api_key = cfg.get('api_key', '')
        return url, api_key

    # -- raw GraphQL call ---------------------------------------------------

    async def _query(self, cfg: dict[str, str], query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        url, api_key = self._resolve(cfg)
        if not api_key:
            logger.warning('New Relic API key not set; returning empty result.')
            return {}
        payload: dict[str, Any] = {'query': query}
        if variables:
            payload['variables'] = variables
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=payload, headers=_nr_headers(api_key))
            resp.raise_for_status()
            body = resp.json()
        if 'errors' in body:
            logger.error('NerdGraph errors: %s', body['errors'])
        return body.get('data', {})

    # -- entities -----------------------------------------------------------

    async def search_entities(
        self,
        cfg: dict[str, str],
        *,
        query: str = '',
        entity_type: str = '',
        domain: str = '',
    ) -> list[dict[str, Any]]:
        """Search NR entities via NerdGraph entitySearch."""
        parts: list[str] = []
        if domain:
            parts.append(f"domain = '{domain}'")
        if entity_type:
            parts.append(f"type = '{entity_type}'")
        if query:
            parts.append(f"name LIKE '%{query}%'")
        search_query = ' AND '.join(parts) if parts else "domain IN ('APM', 'BROWSER', 'MOBILE', 'INFRA', 'SYNTH')"

        gql = """
        {
          actor {
            entitySearch(query: "%s") {
              results {
                entities {
                  guid
                  name
                  entityType
                  domain
                  accountId
                  reporting
                  tags { key values }
                }
              }
            }
          }
        }
        """ % search_query

        data = await self._query(cfg, gql)
        try:
            return data['actor']['entitySearch']['results']['entities'] or []
        except (KeyError, TypeError):
            return []

    async def get_entity(self, cfg: dict[str, str], *, guid: str) -> dict[str, Any] | None:
        gql = """
        {
          actor {
            entity(guid: "%s") {
              guid
              name
              entityType
              domain
              accountId
              reporting
              tags { key values }
            }
          }
        }
        """ % guid

        data = await self._query(cfg, gql)
        try:
            return data['actor']['entity']
        except (KeyError, TypeError):
            return None

    # -- NRQL queries -------------------------------------------------------

    async def _run_nrql(self, cfg: dict[str, str], account_id: int, nrql: str) -> list[dict[str, Any]]:
        gql = """
        {
          actor {
            account(id: %d) {
              nrql(query: "%s") {
                results
              }
            }
          }
        }
        """ % (account_id, nrql.replace('"', '\\"'))

        data = await self._query(cfg, gql)
        try:
            return data['actor']['account']['nrql']['results'] or []
        except (KeyError, TypeError):
            return []

    # -- errors -------------------------------------------------------------

    async def fetch_errors(
        self,
        cfg: dict[str, str],
        *,
        account_id: int,
        app_name: str,
        since: str = '24 hours ago',
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Fetch error groups (FACET by class+message) for an APM app."""
        nrql = (
            f"SELECT count(*) AS occurrences, latest(timestamp) AS lastSeen "
            f"FROM TransactionError "
            f"WHERE appName = '{app_name}' "
            f"FACET error.class, error.message "
            f"SINCE {since} LIMIT {limit}"
        )
        rows = await self._run_nrql(cfg, account_id, nrql)
        result: list[dict[str, Any]] = []
        for row in rows:
            error_class = row.get('error.class') or row.get('facet', ['', ''])[0] or 'Unknown'
            error_message = row.get('error.message') or (row.get('facet', ['', ''])[1] if len(row.get('facet', [])) > 1 else '') or ''
            result.append({
                'error_class': error_class,
                'error_message': error_message,
                'occurrences': int(row.get('occurrences', row.get('count', 0))),
                'last_seen': row.get('lastSeen') or row.get('latest.timestamp'),
                'fingerprint': _fingerprint(app_name, error_class, error_message),
            })
        return result

    async def fetch_error_details(
        self,
        cfg: dict[str, str],
        *,
        account_id: int,
        app_name: str,
        error_class: str,
        error_message: str,
        since: str = '24 hours ago',
    ) -> list[dict[str, Any]]:
        """Fetch individual error traces for a specific error group."""
        # Extract a safe keyword from message for LIKE matching (avoid quote issues)
        words = [w for w in error_message.split() if len(w) > 4 and "'" not in w and '"' not in w and '$' not in w and '\\' not in w]
        keyword = words[0] if words else ''

        if keyword:
            msg_filter = f"AND error.message LIKE '%{keyword}%' "
        else:
            msg_filter = ''

        # Get unique endpoint samples + stack trace via FACET
        nrql = (
            f"SELECT count(*) AS hits, latest(request.method) AS method, latest(host) AS host, "
            f"latest(error.stack) AS stackTrace "
            f"FROM TransactionError "
            f"WHERE appName = '{app_name}' "
            f"AND error.class = '{error_class}' "
            f"{msg_filter}"
            f"FACET transactionName, request.uri "
            f"SINCE {since} LIMIT 10"
        )
        return await self._run_nrql(cfg, account_id, nrql)

    async def fetch_errors_with_details(
        self,
        cfg: dict[str, str],
        *,
        account_id: int,
        app_name: str,
        since: str = '24 hours ago',
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Fetch error groups + sample details for each group."""
        errors = await self.fetch_errors(
            cfg, account_id=account_id, app_name=app_name, since=since, limit=limit,
        )
        for err in errors:
            try:
                details = await self.fetch_error_details(
                    cfg,
                    account_id=account_id,
                    app_name=app_name,
                    error_class=err['error_class'],
                    error_message=err['error_message'],
                    since=since,
                )
                err['samples'] = details[:3]
            except Exception:
                err['samples'] = []
        return errors

    # -- violations / incidents ---------------------------------------------

    async def fetch_violations(
        self,
        cfg: dict[str, str],
        *,
        account_id: int,
        entity_guid: str,
        since: str = '24 hours ago',
    ) -> list[dict[str, Any]]:
        nrql = (
            f"SELECT * FROM NrAiIncident "
            f"WHERE entity.guid = '{entity_guid}' "
            f"SINCE {since} LIMIT 100"
        )
        return await self._run_nrql(cfg, account_id, nrql)

    # -- conversion helpers -------------------------------------------------

    def errors_to_external_tasks(
        self,
        errors: list[dict[str, Any]],
        *,
        entity_name: str,
        account_id: int | None = None,
        entity_guid: str = '',
    ) -> list[ExternalTask]:
        tasks: list[ExternalTask] = []
        for err in errors:
            error_class = err.get('error_class', 'Unknown')
            error_message = err.get('error_message', '')
            occurrences = err.get('occurrences', 0)
            last_seen_raw = err.get('last_seen', '')
            fp = err.get('fingerprint') or _fingerprint(entity_name, error_class, error_message)

            # Format timestamp
            last_seen_str = _format_nr_timestamp(last_seen_raw)

            # Parse file path and line number from error message
            file_path, line_number = _parse_file_location(error_message)

            title = f'[{entity_name}] {error_class}'
            if error_message:
                short_msg = error_message[:120] + ('...' if len(error_message) > 120 else '')
                title += f': {short_msg}'

            # Build NR errors inbox URL (direct link to error group)
            nr_errors_url = ''
            if entity_guid and account_id:
                nr_errors_url = f'https://one.eu.newrelic.com/nr1-core/errors-inbox/entity-inbox/{entity_guid}?account={account_id}'
            elif account_id:
                nr_errors_url = f'https://one.eu.newrelic.com/nr1-core?account={account_id}'

            # Build rich description
            description = f'## New Relic Error — `{error_class}`\n\n'

            # Error details section
            description += '### Error Details\n\n'
            description += f'- **Entity:** {entity_name}\n'
            description += f'- **Error Class:** `{error_class}`\n'
            description += f'- **Message:** `{error_message}`\n'
            if file_path:
                description += f'- **File:** `{file_path}`\n'
            if line_number:
                description += f'- **Line:** {line_number}\n'
            description += f'- **Occurrences (24h):** {occurrences}\n'
            description += f'- **Last Seen:** {last_seen_str}\n'
            description += '\n'

            # Affected endpoints section (from FACET results)
            samples = err.get('samples', [])
            if samples:
                description += '### Affected Endpoints\n\n'
                description += '| Endpoint | Transaction | Hits |\n'
                description += '|----------|-------------|------|\n'
                for s in samples:
                    # FACET results put facet values in 'facet' array
                    facet = s.get('facet', [])
                    txn = facet[0] if len(facet) > 0 else s.get('transactionName', '')
                    uri = facet[1] if len(facet) > 1 else s.get('request.uri', '')
                    method = s.get('method', s.get('request.method', ''))
                    hits = s.get('hits', s.get('count', ''))
                    host = s.get('host', '')

                    endpoint_str = f'`{method} {uri}`' if method and uri else f'`{uri}`' if uri else '-'
                    txn_str = f'`{txn}`' if txn else '-'
                    description += f'| {endpoint_str} | {txn_str} | {hits} |\n'
                description += '\n'

            # Stack trace (from NRQL error.stack)
            stack_traces = [s.get('stackTrace') or s.get('error.stack') or '' for s in samples]
            stack_trace = next((st for st in stack_traces if st), '')
            if stack_trace:
                description += '### Stack Trace\n\n```\n' + str(stack_trace)[:2000] + '\n```\n\n'
                # Try to parse file path from stack trace if not already found
                if not file_path:
                    file_path, line_number = _parse_file_location(str(stack_trace))
                    if file_path:
                        description += f'- **File (from stack):** `{file_path}`\n'
                        if line_number:
                            description += f'- **Line:** {line_number}\n'
                        description += '\n'

            # Action required
            description += '### Task\n\n'
            if file_path and line_number:
                description += (
                    f'Fix the `{error_class}` in `{file_path}` at line **{line_number}**. '
                    f'This error occurs **{occurrences}x/day** in production.\n\n'
                )
            else:
                description += (
                    f'Investigate and fix the `{error_class}` error in **{entity_name}**. '
                    f'This error occurs **{occurrences}x/day** in production.\n\n'
                )

            # Links
            if nr_errors_url:
                description += f'**Errors Inbox:** {nr_errors_url}\n'

            tasks.append(ExternalTask(
                id=fp,
                title=title[:512],
                description=description,
                source='newrelic',
                state='open',
                web_url=nr_errors_url or None,
            ))
        return tasks


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _fingerprint(entity_name: str, error_class: str, error_message: str) -> str:
    raw = f'{entity_name}|{error_class}|{error_message}'
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def _format_nr_timestamp(raw: Any) -> str:
    if not raw:
        return ''
    try:
        from datetime import datetime, timezone
        ts = float(raw) / 1000  # NR returns millis
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    except (ValueError, TypeError, OSError):
        return str(raw)


def _parse_file_location(message: str) -> tuple[str, str]:
    """Extract file path and line number from PHP error messages.

    Examples:
        "... in /var/www/app/app/Controller/Api/V1/Customer.php:2992"
        "... called in /var/www/app/app/Model/V1/Otp.php on line 311"
    """
    import re
    # Pattern 1: "in /path/to/file.php:123"
    m = re.search(r'in\s+(/\S+\.php)[:\s]+(\d+)', message)
    if m:
        return m.group(1), m.group(2)
    # Pattern 2: "at /path/to/file.php (123)" or "at /path/to/file.php(123)"
    m = re.search(r'at\s+(/\S+\.php)\s*\(?(\d+)\)?', message)
    if m:
        return m.group(1), m.group(2)
    # Pattern 3: "called at /path/to/file.php (123)"
    m = re.search(r'called at\s+(/\S+\.php)\s*\((\d+)\)', message)
    if m:
        return m.group(1), m.group(2)
    # Pattern 4: "on line 123"  with a file path somewhere before
    m = re.search(r'(/\S+\.php)\s+on\s+line\s+(\d+)', message)
    if m:
        return m.group(1), m.group(2)
    # Pattern 5: generic file.ext:line
    m = re.search(r'(/\S+\.\w+):(\d+)', message)
    if m:
        return m.group(1), m.group(2)
    return '', ''
