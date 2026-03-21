from datetime import datetime

from pydantic import BaseModel, Field


class IntegrationConfigUpsertRequest(BaseModel):
    base_url: str = Field(min_length=3)
    project: str | None = None
    username: str | None = None
    secret: str | None = None


class IntegrationConfigResponse(BaseModel):
    provider: str
    base_url: str
    project: str | None = None
    username: str | None = None
    has_secret: bool
    updated_at: datetime
