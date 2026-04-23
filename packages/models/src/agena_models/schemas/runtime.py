from __future__ import annotations

from pydantic import BaseModel, Field


class RuntimeCreate(BaseModel):
    name: str
    kind: str = 'local'  # 'local' | 'cloud'
    description: str | None = None
    available_clis: list[str] = Field(default_factory=list)
    host: str | None = None


class RuntimeUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None  # 'active' | 'disabled'


class RuntimeResponse(BaseModel):
    id: int
    organization_id: int
    name: str
    kind: str
    status: str
    description: str | None = None
    available_clis: list[str] = Field(default_factory=list)
    daemon_version: str | None = None
    host: str | None = None
    has_auth_token: bool = False
    last_heartbeat_at: str | None = None
    # Seconds since last heartbeat — the UI turns this into a status dot.
    last_heartbeat_age_sec: int | None = None
    created_at: str
    updated_at: str


class RuntimeRegisterRequest(BaseModel):
    """Posted by a daemon (CLI bridge) on startup to enroll itself.
    The server picks a runtime with a matching `name` OR creates a new
    one, returns the auth token the daemon then uses on heartbeats."""
    name: str
    kind: str = 'local'
    available_clis: list[str] = Field(default_factory=list)
    daemon_version: str | None = None
    host: str | None = None
    description: str | None = None


class RuntimeRegisterResponse(BaseModel):
    runtime_id: int
    name: str
    auth_token: str
    heartbeat_interval_sec: int = 30


class RuntimeHeartbeatRequest(BaseModel):
    available_clis: list[str] = Field(default_factory=list)
    daemon_version: str | None = None
    host: str | None = None
