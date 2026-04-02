from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from agena_core.database import SessionLocal
from agena_models.models.organization_member import OrganizationMember
from agena_models.models.user import User
from agena_core.security.jwt import decode_token
from agena_services.services.event_bus import EventBus

logger = logging.getLogger(__name__)
router = APIRouter()

PING_INTERVAL = 30


async def _authenticate_ws(token: str) -> tuple[int, int] | None:
    """Validate JWT and org membership. Returns (user_id, org_id) or None."""
    try:
        payload = decode_token(token)
    except ValueError:
        return None

    user_id = int(payload.get('user_id', 0) or 0)
    org_id = int(payload.get('org_id', 0) or 0)
    if user_id <= 0 or org_id <= 0:
        return None

    async with SessionLocal() as session:
        user_result = await session.execute(select(User).where(User.id == user_id))
        if user_result.scalar_one_or_none() is None:
            return None

        member_result = await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == org_id,
                OrganizationMember.user_id == user_id,
            )
        )
        if member_result.scalar_one_or_none() is None:
            return None

    return user_id, org_id


@router.websocket('/ws')
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)) -> None:
    auth = await _authenticate_ws(token)
    if auth is None:
        await websocket.close(code=4001, reason='Unauthorized')
        return

    user_id, org_id = auth
    await websocket.accept()
    logger.info('WebSocket connected user=%s org=%s', user_id, org_id)

    bus = EventBus()
    subscriber = bus.subscribe(org_id)
    subscriber_task: asyncio.Task | None = None
    ping_task: asyncio.Task | None = None

    async def _forward_events() -> None:
        try:
            async for event in subscriber:
                try:
                    await websocket.send_json(event)
                except (WebSocketDisconnect, RuntimeError):
                    break
        except asyncio.CancelledError:
            pass

    async def _ping_loop() -> None:
        try:
            while True:
                await asyncio.sleep(PING_INTERVAL)
                try:
                    await websocket.send_json({'event': 'ping'})
                except (WebSocketDisconnect, RuntimeError):
                    break
        except asyncio.CancelledError:
            pass

    try:
        subscriber_task = asyncio.create_task(_forward_events())
        ping_task = asyncio.create_task(_ping_loop())

        # Keep the connection alive by reading (handles client pong / close)
        while True:
            try:
                await websocket.receive_text()
            except WebSocketDisconnect:
                break
    except Exception:
        logger.debug('WebSocket error user=%s org=%s', user_id, org_id, exc_info=True)
    finally:
        if subscriber_task and not subscriber_task.done():
            subscriber_task.cancel()
        if ping_task and not ping_task.done():
            ping_task.cancel()
        # Close the async generator
        await subscriber.aclose()
        logger.info('WebSocket disconnected user=%s org=%s', user_id, org_id)
