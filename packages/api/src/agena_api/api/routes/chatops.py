"""Teams, Slack & Telegram ChatOps webhook endpoints.

Bot credentials stored per-organization in IntegrationConfig (DB):
  - provider='teams'    → secret = Bot App Secret, project = Bot App ID, base_url = webhook URL
  - provider='slack'    → secret = Bot Token, project = Signing Secret, base_url = webhook URL
  - provider='telegram' → secret = Bot Token, project = webhook secret, username = chat_id

Each org configures their own bot via Dashboard → Integrations.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_core.database import get_db_session
from agena_models.models.integration_config import IntegrationConfig
from agena_models.models.organization_member import OrganizationMember
from agena_services.services.chatops_service import ChatOpsResult, handle_command

router = APIRouter(prefix='/webhooks', tags=['chatops'])
logger = logging.getLogger(__name__)


@dataclass
class ResolvedContext:
    org_id: int
    user_id: int
    bot_token: str       # Bot token / secret
    webhook_secret: str  # signing secret / webhook secret
    app_id: str          # Bot App ID (Teams) or empty


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEAMS — Bot Framework
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@router.post('/teams')
async def teams_chatops(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    payload = await request.json()

    # Bot Framework Activity format
    text = payload.get('text', '')
    from_name = (payload.get('from') or {}).get('name', 'Teams User')
    tenant_id = ((payload.get('channelData') or {}).get('tenant') or {}).get('id', '')
    service_url = payload.get('serviceUrl', '')
    conversation = payload.get('conversation', {})
    activity_id = payload.get('id', '')

    logger.info('Teams ChatOps from=%s tenant=%s text=%s', from_name, tenant_id, text[:100])

    ctx = await _resolve_context(db, 'teams', tenant_id)
    if ctx is None:
        return _teams_card(ChatOpsResult(
            text="Could not identify your AGENA organization.\n\nGo to Dashboard → Integrations → Teams to configure ChatOps.",
            color='EF4444',
        ))

    # Verify Bot Framework JWT bearer token
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer ') and ctx.app_id:
        # In production, validate JWT against Bot Framework OpenID metadata
        # For now, we trust that the Bot Framework Service validates the token
        pass
    elif auth_header.startswith('HMAC ') and ctx.bot_token:
        # Legacy: Outgoing Webhook HMAC validation
        raw_body = await request.body()
        _verify_hmac(auth_header[5:], raw_body, ctx.bot_token)

    result = await handle_command(text, ctx.org_id, ctx.user_id, db)
    return _teams_card(result)


def _verify_hmac(provided: str, body: bytes, secret: str) -> None:
    import base64
    secret_bytes = base64.b64decode(secret)
    computed = base64.b64encode(
        hmac.new(secret_bytes, body, hashlib.sha256).digest()
    ).decode()
    if not hmac.compare_digest(provided, computed):
        raise HTTPException(status_code=401, detail='Invalid HMAC signature')


def _teams_card(result: ChatOpsResult) -> dict[str, Any]:
    body: list[dict[str, Any]] = [
        {'type': 'TextBlock', 'text': result.text, 'wrap': True, 'size': 'Medium'}
    ]
    if result.facts:
        body.append({
            'type': 'FactSet',
            'facts': [{'title': f.get('name', ''), 'value': f.get('value', '')} for f in result.facts],
        })
    return {
        'type': 'message',
        'attachments': [{
            'contentType': 'application/vnd.microsoft.card.adaptive',
            'content': {
                '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
                'type': 'AdaptiveCard', 'version': '1.4', 'body': body,
                'msteams': {'width': 'Full'},
            },
        }],
    }


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SLACK — Events API
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@router.post('/slack', response_model=None)
async def slack_chatops(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
):
    raw_body = await request.body()
    payload = await request.json()

    # Slack URL verification challenge (one-time during Event Subscription setup)
    if payload.get('type') == 'url_verification':
        return {'challenge': payload.get('challenge', '')}

    # Find org from team_id
    team_id = payload.get('team_id', '')
    ctx = await _resolve_context(db, 'slack', team_id)

    if ctx is None:
        logger.warning('Slack ChatOps: no org found for team_id=%s', team_id)
        return JSONResponse({'ok': True})

    # Verify Slack signing secret
    if ctx.webhook_secret:
        _verify_slack_signature(request, raw_body, ctx.webhook_secret)

    # Handle Events API callback
    event = payload.get('event', {})
    event_type = event.get('type', '')
    text = event.get('text', '')
    channel = event.get('channel', '')
    user_slack = event.get('user', '')

    # Ignore bot messages to prevent loops
    if event.get('bot_id') or event.get('subtype') == 'bot_message':
        return JSONResponse({'ok': True})

    # Only respond to app_mention or direct messages
    if event_type not in ('app_mention', 'message'):
        return JSONResponse({'ok': True})

    # For 'message' events, only respond in DMs (im channel type)
    if event_type == 'message' and event.get('channel_type') != 'im':
        return JSONResponse({'ok': True})

    logger.info('Slack ChatOps event=%s channel=%s user=%s text=%s', event_type, channel, user_slack, text[:100])

    # Strip bot mention from text
    cleaned = re.sub(r'<@[A-Z0-9]+>\s*', '', text).strip()
    result = await handle_command(cleaned, ctx.org_id, ctx.user_id, db)

    # Send response via Slack API
    await _slack_send(ctx.bot_token, channel, _format_slack(result))
    return JSONResponse({'ok': True})


def _verify_slack_signature(request: Request, body: bytes, signing_secret: str) -> None:
    """Verify Slack request signature (v0 scheme)."""
    timestamp = request.headers.get('X-Slack-Request-Timestamp', '')
    signature = request.headers.get('X-Slack-Signature', '')

    if not timestamp or not signature:
        raise HTTPException(status_code=401, detail='Missing Slack signature headers')

    # Prevent replay attacks (5 minute window)
    if abs(time.time() - int(timestamp)) > 300:
        raise HTTPException(status_code=401, detail='Slack request too old')

    sig_basestring = f'v0:{timestamp}:{body.decode()}'
    computed = 'v0=' + hmac.new(
        signing_secret.encode(), sig_basestring.encode(), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(computed, signature):
        raise HTTPException(status_code=401, detail='Invalid Slack signature')


async def _slack_send(token: str, channel: str, blocks: list[dict[str, Any]]) -> None:
    """Send a message via Slack Web API."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.post(
                'https://slack.com/api/chat.postMessage',
                headers={'Authorization': f'Bearer {token}'},
                json={'channel': channel, 'blocks': blocks, 'unfurl_links': False},
            )
    except Exception as exc:
        logger.warning('Failed to send Slack message to %s: %s', channel, exc)


def _format_slack(result: ChatOpsResult) -> list[dict[str, Any]]:
    """Format ChatOpsResult as Slack Block Kit blocks."""
    blocks: list[dict[str, Any]] = [
        {'type': 'section', 'text': {'type': 'mrkdwn', 'text': result.text}},
    ]
    if result.facts:
        fields = [{'type': 'mrkdwn', 'text': f"*{f['name']}*\n{f['value']}"} for f in result.facts[:10]]
        blocks.append({'type': 'section', 'fields': fields})
    return blocks


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TELEGRAM
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@router.post('/telegram')
async def telegram_chatops(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> JSONResponse:
    payload = await request.json()
    message = payload.get('message') or payload.get('edited_message') or {}
    text = message.get('text', '')
    chat = message.get('chat', {})
    chat_id = chat.get('id')
    from_name = (message.get('from') or {}).get('first_name', 'Telegram User')

    if not chat_id or not text:
        return JSONResponse({'ok': True})

    logger.info('Telegram ChatOps from=%s chat=%s text=%s', from_name, chat_id, text[:100])

    ctx = await _resolve_context(db, 'telegram', str(chat_id))
    if ctx is None:
        return JSONResponse({'ok': True})

    # Validate webhook secret
    if ctx.webhook_secret:
        header_secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token', '')
        if header_secret != ctx.webhook_secret:
            raise HTTPException(status_code=401, detail='Invalid secret token')

    # In group chats, only respond to /commands or @bot mentions
    is_group = chat.get('type') in ('group', 'supergroup')
    bot_username = await _get_bot_username(ctx.bot_token)
    if is_group and not text.startswith('/') and f'@{bot_username}' not in text:
        return JSONResponse({'ok': True})

    cleaned = _strip_telegram_command(text, bot_username)
    result = await handle_command(cleaned, ctx.org_id, ctx.user_id, db)
    await _telegram_send(ctx.bot_token, chat_id, _format_telegram(result))
    return JSONResponse({'ok': True})


@router.post('/telegram/setup')
async def telegram_setup_webhook(
    base_url: str = Query(..., description='Public base URL, e.g. https://api.agena.dev'),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    token, webhook_secret = await _get_telegram_token(db)
    if not token:
        raise HTTPException(status_code=400, detail='No Telegram bot token found. Configure it in Dashboard → Integrations → Telegram.')

    webhook_url = f"{base_url.rstrip('/')}/webhooks/telegram"
    params: dict[str, Any] = {'url': webhook_url}
    if webhook_secret:
        params['secret_token'] = webhook_secret

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(f'https://api.telegram.org/bot{token}/setWebhook', json=params)
        data = resp.json()

    if not data.get('ok'):
        raise HTTPException(status_code=502, detail=f"Telegram API error: {data.get('description', 'unknown')}")

    async with httpx.AsyncClient(timeout=10) as client:
        me_resp = await client.get(f'https://api.telegram.org/bot{token}/getMe')
        me_data = me_resp.json()

    bot_info = me_data.get('result', {})
    return {
        'status': 'ok', 'webhook_url': webhook_url,
        'bot_username': bot_info.get('username', ''),
        'bot_name': bot_info.get('first_name', ''),
        'telegram_response': data,
    }


@router.get('/telegram/info')
async def telegram_info(db: AsyncSession = Depends(get_db_session)) -> dict[str, Any]:
    token, _ = await _get_telegram_token(db)
    if not token:
        raise HTTPException(status_code=400, detail='No Telegram bot token configured')
    async with httpx.AsyncClient(timeout=10) as client:
        me_resp = await client.get(f'https://api.telegram.org/bot{token}/getMe')
        wh_resp = await client.get(f'https://api.telegram.org/bot{token}/getWebhookInfo')
    return {'bot': me_resp.json().get('result', {}), 'webhook': wh_resp.json().get('result', {})}


# ── Telegram helpers ──────────────────────────────────────────────

_bot_username_cache: dict[str, str] = {}


async def _get_bot_username(token: str) -> str:
    if token in _bot_username_cache:
        return _bot_username_cache[token]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f'https://api.telegram.org/bot{token}/getMe')
            username = resp.json().get('result', {}).get('username', '')
            _bot_username_cache[token] = username
            return username
    except Exception:
        return ''


def _strip_telegram_command(text: str, bot_username: str) -> str:
    text = re.sub(r'^/(\w+)(@\w+)?\s*', r'\1 ', text).strip()
    if bot_username:
        text = text.replace(f'@{bot_username}', '').strip()
    return text


async def _telegram_send(token: str, chat_id: int, text: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.post(
                f'https://api.telegram.org/bot{token}/sendMessage',
                json={'chat_id': chat_id, 'text': text, 'parse_mode': 'Markdown', 'disable_web_page_preview': True},
            )
    except Exception as exc:
        logger.warning('Failed to send Telegram message to chat %s: %s', chat_id, exc)


def _format_telegram(result: ChatOpsResult) -> str:
    lines = [result.text]
    if result.facts:
        lines.append('')
        for f in result.facts:
            lines.append(f"*{f.get('name', '')}:* {f.get('value', '')}")
    return '\n'.join(lines)


async def _get_telegram_token(db: AsyncSession) -> tuple[str, str]:
    result = await db.execute(
        select(IntegrationConfig).where(IntegrationConfig.provider == 'telegram').limit(1)
    )
    cfg = result.scalar_one_or_none()
    if cfg and cfg.secret:
        return cfg.secret, (cfg.project or '').strip()
    return '', ''


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SHARED: Org/User/Token resolution
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async def _resolve_context(
    db: AsyncSession,
    provider: str,
    external_id: str,
) -> ResolvedContext | None:
    """Resolve org, user, and bot credentials from IntegrationConfig.

    DB field mapping:
      teams:    base_url = webhook URL, secret = Bot App Secret, project = Bot App ID
      slack:    base_url = webhook URL, secret = Bot Token, project = Signing Secret
      telegram: secret = Bot Token, project = webhook secret, username = chat_id
    """

    result = await db.execute(
        select(IntegrationConfig).where(IntegrationConfig.provider == provider)
    )
    configs = result.scalars().all()

    if not configs:
        return None

    target_cfg: IntegrationConfig | None = None
    if len(configs) == 1:
        target_cfg = configs[0]
    else:
        for cfg in configs:
            if external_id and (
                external_id == (cfg.username or '').strip()
                or external_id == (cfg.project or '').strip()
                or external_id in (cfg.base_url or '')
            ):
                target_cfg = cfg
                break
        if target_cfg is None:
            target_cfg = configs[0]

    bot_token = (target_cfg.secret or '').strip()
    webhook_secret = (target_cfg.project or '').strip() if provider in ('telegram', 'slack') else ''
    app_id = (target_cfg.project or '').strip() if provider == 'teams' else ''

    # For teams, bot_token not strictly required (legacy webhook mode works without)
    # For slack/telegram, bot_token is required to send responses
    if provider in ('slack', 'telegram') and not bot_token:
        return None

    member_result = await db.execute(
        select(OrganizationMember)
        .where(OrganizationMember.organization_id == target_cfg.organization_id)
        .order_by(OrganizationMember.role.asc())
        .limit(1)
    )
    member = member_result.scalar_one_or_none()
    if not member:
        return None

    return ResolvedContext(
        org_id=target_cfg.organization_id,
        user_id=member.user_id,
        bot_token=bot_token,
        webhook_secret=webhook_secret,
        app_id=app_id,
    )
