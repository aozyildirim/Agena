"""task_ai_fill_service — populate story_context / acceptance_criteria /
edge_cases for a task using the org's chosen LLM.

Routing rules (mirrored on the frontend):
  preferred_provider == claude_cli  → CLI bridge with `claude` CLI
  preferred_provider == codex_cli   → CLI bridge with `codex` CLI
  anything else (or fallback)       → hosted LLM via org's API key, no env

The CLI path uses a read-only sandbox at /tmp so the local CLI doesn't
need a repo on disk — we're just round-tripping a prompt for a JSON
response.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_core.settings import get_settings
from agena_models.models.user_preference import UserPreference
from agena_services.services.integration_config_service import IntegrationConfigService
from agena_services.services.llm.provider import LLMProvider

logger = logging.getLogger(__name__)


_PROMPT = (
    "You are a senior product engineer. Given a software task, return a "
    "JSON object with three fields, all in the same language as the input:\n"
    "  story_context        — Why does this matter? Who is the user? What "
    "is the expected business / user value? 2-4 sentences.\n"
    "  acceptance_criteria  — Bullet list of testable criteria the work "
    "must satisfy. One per line, prefixed with `- `.\n"
    "  edge_cases           — Bullet list of edge cases or constraints to "
    "watch for (race conditions, empty states, scale, accessibility, "
    "permissions). One per line, prefixed with `- `.\n\n"
    "Be concrete and grounded in the task's actual content — do NOT invent "
    "facts. If the task body is too thin to ground a field, write a single "
    "line `- (insufficient context)` for that field instead of guessing.\n\n"
    "Respond ONLY with a JSON object, no prose, no code fences."
)


def _build_user_prompt(title: str, description: str) -> str:
    body = (description or '').strip()
    if len(body) > 8000:
        body = body[:8000] + '\n[...truncated...]'
    return (
        f"Task title:\n{title or '(untitled)'}\n\n"
        f"Task description:\n{body or '(empty)'}"
    )


def _extract_json_object(raw: str) -> dict[str, Any]:
    """LLMs love wrapping JSON in ```json ... ``` fences or adding a
    one-line apology before the object. Walk the string for the first
    balanced { ... } and json.loads that — falls back to a minimal stub
    if the response is unparseable so the modal still shows something.
    """
    s = (raw or '').strip()
    # Strip code fences if present
    s = re.sub(r'^```(?:json)?\s*', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\s*```\s*$', '', s)
    # Find first { ... last }, balance-aware
    start = s.find('{')
    if start == -1:
        return {}
    depth = 0
    end = -1
    in_str = False
    esc = False
    for i in range(start, len(s)):
        ch = s[i]
        if in_str:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end = i
                break
    if end == -1:
        return {}
    try:
        return json.loads(s[start:end + 1])
    except json.JSONDecodeError:
        return {}


async def _user_preferred_provider(db: AsyncSession, user_id: int) -> tuple[str | None, str | None]:
    row = (await db.execute(select(UserPreference).where(UserPreference.user_id == user_id))).scalar_one_or_none()
    if not row or not row.profile_settings_json:
        return None, None
    try:
        ps = json.loads(row.profile_settings_json)
    except (TypeError, ValueError):
        return None, None
    if not isinstance(ps, dict):
        return None, None
    p = ps.get('preferred_provider')
    m = ps.get('preferred_model')
    return (p if isinstance(p, str) and p else None), (m if isinstance(m, str) and m else None)


async def _resolve_org_default(db: AsyncSession, organization_id: int) -> str:
    """Pick a sensible default provider when neither the request nor the
    user's preferred_provider names one. Probes the org's configured
    integrations in order: hosted-LLM keys first (anthropic > openai >
    gemini), then claude_cli (always available locally if the bridge is
    reachable). Falls back to claude_cli so the user gets a CLI-bridge
    error instead of an opaque "openai not configured" when they haven't
    plugged any hosted credentials in."""
    integration_service = IntegrationConfigService(db)
    for prov in ('anthropic', 'openai', 'gemini'):
        cfg = await integration_service.get_config(organization_id, prov)
        if cfg and (cfg.secret or '').strip():
            return prov
    return 'claude_cli'


async def _run_cli(*, cli_provider: str, model: str, prompt: str) -> str:
    """Round-trip the prompt through the host CLI bridge. read_only sandbox
    + /tmp repo path: the CLI doesn't need to touch a repo for this call,
    but the bridge schema requires a path so we hand it the safest one."""
    bridge_url = os.getenv('CLI_BRIDGE_URL', 'http://cli-bridge:9876')
    cli = 'claude' if cli_provider == 'claude_cli' else 'codex'
    timeout = int(os.getenv('AI_FILL_CLI_TIMEOUT_SEC', '180'))
    try:
        async with httpx.AsyncClient(timeout=timeout + 30) as client:
            resp = await client.post(
                f'{bridge_url}/{cli}',
                json={
                    'repo_path': '/tmp',
                    'prompt': prompt,
                    'model': model or '',
                    'timeout': timeout,
                    'read_only': True,
                },
            )
            data = resp.json()
    except httpx.ConnectError as exc:
        raise RuntimeError(f'CLI bridge unreachable at {bridge_url}') from exc
    except httpx.TimeoutException as exc:
        raise RuntimeError(f'CLI bridge timed out after {timeout}s') from exc
    except (httpx.RequestError, ValueError) as exc:
        raise RuntimeError(f'CLI bridge error: {exc}') from exc
    stdout = (data.get('stdout') or '').strip()
    # Bridge marks status='error' whenever the CLI exits with non-zero,
    # but claude often emits an OpenSSL CA-bundle warning and STILL writes
    # the answer to stdout. If we have a non-empty stdout, prefer it over
    # the stderr noise — only raise when stdout is genuinely empty.
    if stdout:
        return stdout
    if data.get('status') != 'ok':
        raise RuntimeError(f'{cli} bridge: {data.get("message", data.get("stderr", "unknown"))}')
    raise RuntimeError(f'{cli} bridge returned empty output')


async def fill(
    *,
    db: AsyncSession,
    organization_id: int,
    user_id: int,
    title: str,
    description: str,
    provider: str | None,
    model: str | None,
) -> dict[str, Any]:
    """Resolve the right provider and ask it to populate the three fields.

    Order of resolution: explicit `provider` arg > user preferred_provider
    > 'openai'. CLI providers use the bridge; hosted providers use the
    org's stored credentials (no env fallback — same rule as refinement
    and review)."""
    settings = get_settings()
    integration_service = IntegrationConfigService(db)
    pref_provider, pref_model = await _user_preferred_provider(db, user_id)
    explicit = (provider or '').strip().lower()
    if explicit:
        chosen = explicit
    elif pref_provider:
        chosen = pref_provider.strip().lower()
    else:
        chosen = await _resolve_org_default(db, organization_id)
    chosen_model = (model or pref_model or '').strip()

    user_prompt = _build_user_prompt(title, description)
    full_prompt = f"{_PROMPT}\n\n---\n\n{user_prompt}"

    raw_response = ''
    used_provider = chosen
    used_model = chosen_model or 'auto'

    # If the chosen hosted provider has no credentials configured, fall
    # back to the CLI bridge so the request still succeeds — many users
    # set preferred_provider before plugging in API keys, and the CLI
    # bridge is always available locally for development.
    if chosen in {'openai', 'anthropic', 'gemini'}:
        cfg_for_check = await integration_service.get_config(organization_id, chosen)
        api_key_for_check = ((cfg_for_check.secret if cfg_for_check else '') or '').strip()
        if not api_key_for_check:
            logger.info(
                'AI fill: %s not configured for org %s — falling back to claude_cli',
                chosen, organization_id,
            )
            chosen = 'claude_cli'

    if chosen in ('claude_cli', 'codex_cli'):
        # Default model labels match the CLI bridge's expectations.
        cli_model = chosen_model or ('sonnet' if chosen == 'claude_cli' else 'gpt-5')
        raw_response = await _run_cli(
            cli_provider=chosen,
            model=cli_model,
            prompt=full_prompt,
        )
        used_provider = chosen
        used_model = cli_model
    else:
        provider_norm = chosen if chosen in {'openai', 'anthropic', 'gemini'} else 'openai'
        integration = await integration_service.get_config(organization_id, provider_norm)
        api_key = ((integration.secret if integration else '') or '').strip()
        base_url = ((integration.base_url if integration else '') or '').strip()
        if not api_key:
            raise ValueError(
                f'{provider_norm} integration is not configured — '
                'add an API key under /dashboard/integrations or pick another provider.'
            )
        if provider_norm == 'anthropic' and not base_url:
            base_url = 'https://api.anthropic.com'
        if provider_norm == 'gemini' and not base_url:
            base_url = 'https://generativelanguage.googleapis.com'
        default_model = chosen_model or settings.llm_large_model or 'gpt-4.1'
        llm = LLMProvider(
            provider=provider_norm,
            api_key=api_key,
            base_url=base_url,
            small_model=default_model,
            large_model=default_model,
        )
        # LLMProvider.generate returns (output, usage, model, cached_flag).
        # We parse JSON from `output` ourselves; usage / cached are unused
        # here but the model name is passed back to the caller.
        output, _usage, returned_model, _cached = await llm.generate(
            system_prompt=_PROMPT,
            user_prompt=user_prompt,
            complexity_hint='normal',
            max_output_tokens=2000,
            skip_cache=True,
        )
        raw_response = output
        used_provider = provider_norm
        used_model = returned_model or default_model

    parsed = _extract_json_object(raw_response)
    return {
        'story_context': str(parsed.get('story_context') or '').strip(),
        'acceptance_criteria': str(parsed.get('acceptance_criteria') or '').strip(),
        'edge_cases': str(parsed.get('edge_cases') or '').strip(),
        'used_provider': used_provider,
        'used_model': used_model,
    }
