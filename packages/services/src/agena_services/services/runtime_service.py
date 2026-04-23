"""Runtime registry — tracks compute environments (local CLI bridge, cloud
daemons) that can execute agent tasks.

Daemons register on startup with POST /runtimes/register and receive an
auth token. Subsequent heartbeat / task-pull calls carry that token. The
service hashes the token on storage so a DB leak doesn't hand out active
daemon credentials.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.runtime import Runtime
from agena_models.schemas.runtime import (
    RuntimeCreate,
    RuntimeRegisterRequest,
    RuntimeUpdate,
)

logger = logging.getLogger(__name__)

# How long without a heartbeat before we flip the UI status from 'active'
# to 'offline'. Matches the recommended daemon heartbeat interval (30s)
# plus a generous buffer.
OFFLINE_AFTER_SEC = 120
HEARTBEAT_INTERVAL_SEC = 30


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


class RuntimeService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ----- UI-facing CRUD -----

    async def list(self, organization_id: int) -> list[Runtime]:
        stmt = select(Runtime).where(Runtime.organization_id == organization_id).order_by(
            Runtime.created_at.desc()
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def get(self, organization_id: int, runtime_id: int) -> Runtime | None:
        stmt = select(Runtime).where(
            Runtime.id == runtime_id, Runtime.organization_id == organization_id
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def create(
        self,
        organization_id: int,
        payload: RuntimeCreate,
        *,
        user_id: int | None = None,
    ) -> Runtime:
        runtime = Runtime(
            organization_id=organization_id,
            registered_by_user_id=user_id,
            name=(payload.name or '').strip()[:128] or 'runtime',
            kind=(payload.kind or 'local').strip().lower()[:32],
            status='active',
            description=(payload.description or '').strip() or None,
            available_clis=list(payload.available_clis or []),
            host=payload.host,
        )
        self.db.add(runtime)
        await self.db.commit()
        await self.db.refresh(runtime)
        return runtime

    async def update(
        self,
        organization_id: int,
        runtime_id: int,
        payload: RuntimeUpdate,
    ) -> Runtime | None:
        runtime = await self.get(organization_id, runtime_id)
        if runtime is None:
            return None
        data = payload.model_dump(exclude_unset=True)
        for key, value in data.items():
            if value is not None:
                setattr(runtime, key, value)
        await self.db.commit()
        await self.db.refresh(runtime)
        return runtime

    async def delete(self, organization_id: int, runtime_id: int) -> bool:
        runtime = await self.get(organization_id, runtime_id)
        if runtime is None:
            return False
        await self.db.execute(delete(Runtime).where(Runtime.id == runtime_id))
        await self.db.commit()
        return True

    # ----- Daemon-facing endpoints -----

    async def register(
        self,
        organization_id: int,
        payload: RuntimeRegisterRequest,
    ) -> tuple[Runtime, str]:
        """Enroll (or re-enroll) a daemon. Returns the Runtime row + raw
        token. We use name as the natural key so re-registering the same
        daemon (after a restart) reuses the row.
        """
        clean_name = (payload.name or '').strip()[:128] or 'runtime'
        stmt = select(Runtime).where(
            Runtime.organization_id == organization_id,
            Runtime.name == clean_name,
        )
        runtime = (await self.db.execute(stmt)).scalar_one_or_none()
        raw_token = secrets.token_urlsafe(32)
        token_hash = _hash_token(raw_token)
        now = datetime.utcnow()
        if runtime is None:
            runtime = Runtime(
                organization_id=organization_id,
                name=clean_name,
                kind=(payload.kind or 'local').strip().lower()[:32],
                status='active',
                description=(payload.description or '').strip() or None,
                available_clis=list(payload.available_clis or []),
                daemon_version=payload.daemon_version,
                host=payload.host,
                auth_token_hash=token_hash,
                last_heartbeat_at=now,
            )
            self.db.add(runtime)
        else:
            runtime.kind = (payload.kind or runtime.kind).strip().lower()[:32]
            runtime.status = 'active'
            if payload.description:
                runtime.description = payload.description.strip() or None
            if payload.available_clis is not None:
                runtime.available_clis = list(payload.available_clis)
            if payload.daemon_version:
                runtime.daemon_version = payload.daemon_version
            if payload.host:
                runtime.host = payload.host
            runtime.auth_token_hash = token_hash
            runtime.last_heartbeat_at = now
        await self.db.commit()
        await self.db.refresh(runtime)
        return runtime, raw_token

    async def heartbeat(
        self,
        runtime_id: int,
        raw_token: str,
        *,
        available_clis: list[str] | None = None,
        daemon_version: str | None = None,
        host: str | None = None,
    ) -> Runtime | None:
        """Daemons call this every HEARTBEAT_INTERVAL_SEC. We verify the
        token against the stored hash, then refresh status + metadata."""
        runtime = await self.db.get(Runtime, runtime_id)
        if runtime is None:
            return None
        if not runtime.auth_token_hash:
            return None
        if _hash_token(raw_token or '') != runtime.auth_token_hash:
            return None
        runtime.last_heartbeat_at = datetime.utcnow()
        runtime.status = 'active'
        if available_clis is not None:
            runtime.available_clis = list(available_clis)
        if daemon_version:
            runtime.daemon_version = daemon_version
        if host:
            runtime.host = host
        await self.db.commit()
        await self.db.refresh(runtime)
        return runtime

    @staticmethod
    def heartbeat_age_sec(runtime: Runtime) -> int | None:
        if runtime.last_heartbeat_at is None:
            return None
        delta = datetime.utcnow() - runtime.last_heartbeat_at
        return int(max(0, delta.total_seconds()))

    @staticmethod
    def derive_status(runtime: Runtime) -> str:
        """Compute live status from the stored last_heartbeat_at, so the UI
        doesn't need a background cron to mark runtimes offline."""
        if (runtime.status or '').strip().lower() == 'disabled':
            return 'disabled'
        age = RuntimeService.heartbeat_age_sec(runtime)
        if age is None or age > OFFLINE_AFTER_SEC:
            return 'offline'
        return 'active'

    def to_response_dict(self, runtime: Runtime) -> dict[str, Any]:
        return {
            'id': runtime.id,
            'organization_id': runtime.organization_id,
            'name': runtime.name,
            'kind': runtime.kind,
            'status': self.derive_status(runtime),
            'description': runtime.description,
            'available_clis': list(runtime.available_clis or []),
            'daemon_version': runtime.daemon_version,
            'host': runtime.host,
            'has_auth_token': bool(runtime.auth_token_hash),
            'last_heartbeat_at': runtime.last_heartbeat_at.isoformat() if runtime.last_heartbeat_at else None,
            'last_heartbeat_age_sec': self.heartbeat_age_sec(runtime),
            'created_at': runtime.created_at.isoformat() if runtime.created_at else '',
            'updated_at': runtime.updated_at.isoformat() if runtime.updated_at else '',
        }
