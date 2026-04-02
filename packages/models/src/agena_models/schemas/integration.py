from datetime import datetime

from pydantic import BaseModel


class IntegrationConfigUpsertRequest(BaseModel):
    base_url: str | None = None
    project: str | None = None
    username: str | None = None
    secret: str | None = None


class IntegrationConfigResponse(BaseModel):
    provider: str
    base_url: str
    project: str | None = None
    username: str | None = None
    has_secret: bool
    secret_preview: str | None = None
    updated_at: datetime
