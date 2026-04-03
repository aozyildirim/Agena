"""Teams & Telegram ChatOps webhook endpoints.

Teams Outgoing Webhook flow:
  1. User creates an Outgoing Webhook in a Teams channel named "agena"
  2. Teams gives a shared HMAC secret — store it in TEAMS_CHATOPS_SECRET env var
  3. When someone @agena in that channel, Teams POSTs here
  4. We validate HMAC, resolve the org, parse the command, and return an Adaptive Card

Telegram Bot flow:
  1. Create a bot via @BotFather, get the token
  2. Set TELEGRAM_BOT_TOKEN env var
  3. Call POST /webhooks/telegram/setup to register the webhook with Telegram
  4. Users /command or mention the bot in a group — Telegram POSTs here
  5. We parse the command, resolve the org, execute, and send a reply via Bot API
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_core.database import get_db_session
from agena_core.settings import get_settings
from agena_models.models.integration_config import IntegrationConfig
from agena_models.models.organization_member import OrganizationMember
from agena_services.services.chatops_service import ChatOpsResult, handle_command

router = APIRouter(prefix='/webhooks', tags=['chatops'])
logger = logging.getLogger(__name__)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEAMS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@router.post('/teams')
async def teams_chatops(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Receive messages from a Teams Outgoing Webhook and respond."""

    raw_body = await request.body()
    _verify_teams_hmac(request, raw_body)

    payload = await request.json()
    text = payload.get('text', '')
    from_user = payload.get('from', {})
    aad_object_id = from_user.get('aadObjectId', '')
    from_name = from_user.get('name', 'Teams User')
    tenant_id = (payload.get('channelData', {}) or {}).get('tenant', {}).get('id', '')

    logger.info(
        'Teams ChatOps from=%s aad=%s tenant=%s text=%s',
        from_name, aad_object_id, tenant_id, text[:100],
    )

    org_id, user_id = await _resolve_org_and_user(db, 'teams', tenant_id)

    if org_id is None or user_id is None:
        return _teams_card(ChatOpsResult(
            text="Could not identify your AGENA organization. Make sure Teams integration is configured in Dashboard → Integrations.",
            color='EF4444',
        ))

    result = await handle_command(text, org_id, user_id, db)
    return _teams_card(result)


def _verify_teams_hmac(request: Request, body: bytes) -> None:
    settings = get_settings()
    secret = settings.teams_chatops_secret
    if not secret:
        return

    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('HMAC '):
        raise HTTPException(status_code=401, detail='Missing HMAC authorization')

    provided_hmac = auth_header[5:]
    secret_bytes = base64.b64decode(secret)
    computed = base64.b64encode(
        hmac.new(secret_bytes, body, hashlib.sha256).digest()
    ).decode()

    if not hmac.compare_digest(provided_hmac, computed):
        raise HTTPException(status_code=401, detail='Invalid HMAC signature')


def _teams_card(result: ChatOpsResult) -> dict[str, Any]:
    body: list[dict[str, Any]] = [
        {
            'type': 'TextBlock',
            'text': result.text,
            'wrap': True,
            'size': 'Medium',
        }
    ]
    if result.facts:
        body.append({
            'type': 'FactSet',
            'facts': [
                {'title': f.get('name', ''), 'value': f.get('value', '')}
                for f in result.facts
            ],
        })

    return {
        'type': 'message',
        'attachments': [
            {
                'contentType': 'application/vnd.microsoft.card.adaptive',
                'content': {
                    '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
                    'type': 'AdaptiveCard',
                    'version': '1.4',
                    'body': body,
                    'msteams': {'width': 'Full'},
                },
            }
        ],
    }


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TELEGRAM
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@router.post('/telegram')
async def telegram_chatops(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> JSONResponse:
    """Receive updates from Telegram Bot API webhook."""

    settings = get_settings()
    if not settings.telegram_bot_token:
        raise HTTPException(status_code=503, detail='Telegram bot not configured')

    # Validate secret token header (set during webhook registration)
    if settings.telegram_webhook_secret:
        header_secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token', '')
        if header_secret != settings.telegram_webhook_secret:
            raise HTTPException(status_code=401, detail='Invalid secret token')

    payload = await request.json()
    message = payload.get('message') or payload.get('edited_message') or {}
    text = message.get('text', '')
    chat = message.get('chat', {})
    chat_id = chat.get('id')
    from_user = message.get('from', {})
    from_name = from_user.get('first_name', 'Telegram User')

    if not chat_id or not text:
        return JSONResponse({'ok': True})

    logger.info(
        'Telegram ChatOps from=%s chat=%s text=%s',
        from_name, chat_id, text[:100],
    )

    # In group chats, only respond to /commands or @bot mentions
    is_group = chat.get('type') in ('group', 'supergroup')
    bot_username = await _get_bot_username(settings.telegram_bot_token)
    if is_group:
        if not text.startswith('/') and f'@{bot_username}' not in text:
            return JSONResponse({'ok': True})

    # Strip /command prefix and @bot mention
    cleaned = _strip_telegram_command(text, bot_username)

    org_id, user_id = await _resolve_org_and_user(db, 'telegram', str(chat_id))

    if org_id is None or user_id is None:
        await _telegram_send(
            settings.telegram_bot_token, chat_id,
            "⚠️ Could not identify your AGENA organization.\n\n"
            "Go to Dashboard → Integrations → Telegram and enter this chat ID:\n"
            f"`{chat_id}`",
        )
        return JSONResponse({'ok': True})

    result = await handle_command(cleaned, org_id, user_id, db)
    await _telegram_send(settings.telegram_bot_token, chat_id, _format_telegram(result))

    return JSONResponse({'ok': True})


@router.post('/telegram/setup')
async def telegram_setup_webhook(
    base_url: str = Query(..., description='Public base URL, e.g. https://api.agena.dev'),
) -> dict[str, Any]:
    """Register the Telegram webhook. Call once after setting TELEGRAM_BOT_TOKEN."""

    settings = get_settings()
    if not settings.telegram_bot_token:
        raise HTTPException(status_code=400, detail='TELEGRAM_BOT_TOKEN not set')

    webhook_url = f"{base_url.rstrip('/')}/webhooks/telegram"

    params: dict[str, Any] = {'url': webhook_url}
    if settings.telegram_webhook_secret:
        params['secret_token'] = settings.telegram_webhook_secret

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f'https://api.telegram.org/bot{settings.telegram_bot_token}/setWebhook',
            json=params,
        )
        data = resp.json()

    if not data.get('ok'):
        raise HTTPException(status_code=502, detail=f"Telegram API error: {data.get('description', 'unknown')}")

    # Also get bot info for confirmation
    async with httpx.AsyncClient(timeout=10) as client:
        me_resp = await client.get(
            f'https://api.telegram.org/bot{settings.telegram_bot_token}/getMe',
        )
        me_data = me_resp.json()

    bot_info = me_data.get('result', {})
    return {
        'status': 'ok',
        'webhook_url': webhook_url,
        'bot_username': bot_info.get('username', ''),
        'bot_name': bot_info.get('first_name', ''),
        'telegram_response': data,
    }


@router.get('/telegram/info')
async def telegram_info() -> dict[str, Any]:
    """Get current bot info and webhook status."""

    settings = get_settings()
    if not settings.telegram_bot_token:
        raise HTTPException(status_code=400, detail='TELEGRAM_BOT_TOKEN not set')

    async with httpx.AsyncClient(timeout=10) as client:
        me_resp = await client.get(
            f'https://api.telegram.org/bot{settings.telegram_bot_token}/getMe',
        )
        wh_resp = await client.get(
            f'https://api.telegram.org/bot{settings.telegram_bot_token}/getWebhookInfo',
        )

    return {
        'bot': me_resp.json().get('result', {}),
        'webhook': wh_resp.json().get('result', {}),
    }


# ── Telegram helpers ──────────────────────────────────────────────

_bot_username_cache: dict[str, str] = {}


async def _get_bot_username(token: str) -> str:
    if token in _bot_username_cache:
        return _bot_username_cache[token]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f'https://api.telegram.org/bot{token}/getMe')
            data = resp.json()
            username = data.get('result', {}).get('username', '')
            _bot_username_cache[token] = username
            return username
    except Exception:
        return ''


def _strip_telegram_command(text: str, bot_username: str) -> str:
    """Strip /command@bot prefix from Telegram message."""
    import re
    # Remove /command@botname or /command prefix
    text = re.sub(r'^/(\w+)(@\w+)?\s*', r'\1 ', text).strip()
    # Remove @bot mentions
    if bot_username:
        text = text.replace(f'@{bot_username}', '').strip()
    return text


async def _telegram_send(token: str, chat_id: int, text: str) -> None:
    """Send a message via Telegram Bot API."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.post(
                f'https://api.telegram.org/bot{token}/sendMessage',
                json={
                    'chat_id': chat_id,
                    'text': text,
                    'parse_mode': 'Markdown',
                    'disable_web_page_preview': True,
                },
            )
    except Exception as exc:
        logger.warning('Failed to send Telegram message to chat %s: %s', chat_id, exc)


def _format_telegram(result: ChatOpsResult) -> str:
    """Format ChatOpsResult as Telegram Markdown message."""
    lines = [result.text]

    if result.facts:
        lines.append('')
        for f in result.facts:
            name = f.get('name', '')
            value = f.get('value', '')
            lines.append(f"*{name}:* {value}")

    return '\n'.join(lines)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SHARED: Org/User resolution
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async def _resolve_org_and_user(
    db: AsyncSession,
    provider: str,
    external_id: str,
) -> tuple[int | None, int | None]:
    """Map a chat platform identity to an AGENA org + user.

    Looks for IntegrationConfig entries matching the provider ('teams' or 'telegram').
    For Telegram, the chat_id can be stored in the 'project' field of the integration config.
    For Teams, the tenant_id is matched against 'project' or 'base_url'.
    Fallback: first org with that provider configured.
    """

    result = await db.execute(
        select(IntegrationConfig).where(IntegrationConfig.provider == provider)
    )
    configs = result.scalars().all()

    if not configs:
        return None, None

    target_org_id: int | None = None

    if len(configs) == 1:
        target_org_id = configs[0].organization_id
    else:
        for cfg in configs:
            if external_id and (
                external_id == (cfg.project or '').strip()
                or external_id in (cfg.base_url or '')
            ):
                target_org_id = cfg.organization_id
                break
        if target_org_id is None:
            target_org_id = configs[0].organization_id

    # Find a user in this org (prefer owner/admin)
    member_result = await db.execute(
        select(OrganizationMember)
        .where(OrganizationMember.organization_id == target_org_id)
        .order_by(OrganizationMember.role.asc())
        .limit(1)
    )
    member = member_result.scalar_one_or_none()
    user_id = member.user_id if member else None

    return target_org_id, user_id
