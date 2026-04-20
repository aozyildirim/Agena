from __future__ import annotations

from pydantic import BaseModel


class NewRelicEntityResponse(BaseModel):
    guid: str
    name: str
    entity_type: str
    domain: str
    account_id: int
    reporting: bool = True
    tags: dict[str, list[str]] = {}


class NewRelicErrorGroup(BaseModel):
    error_class: str
    error_message: str
    occurrences: int
    last_seen: str | None = None
    fingerprint: str


class NewRelicErrorListResponse(BaseModel):
    entity_name: str
    entity_guid: str
    errors: list[NewRelicErrorGroup] = []


class NewRelicEntityMappingCreate(BaseModel):
    entity_guid: str
    entity_name: str
    entity_type: str
    account_id: int
    repo_mapping_id: int | None = None
    flow_id: str | None = None
    auto_import: bool = False
    import_interval_minutes: int = 60


class NewRelicEntityMappingUpdate(BaseModel):
    repo_mapping_id: int | None = None
    flow_id: str | None = None
    auto_import: bool | None = None
    import_interval_minutes: int | None = None
    is_active: bool | None = None


class NewRelicEntityMappingResponse(BaseModel):
    id: int
    entity_guid: str
    entity_name: str
    entity_type: str
    account_id: int
    repo_mapping_id: int | None = None
    repo_display_name: str | None = None
    flow_id: str | None = None
    auto_import: bool
    import_interval_minutes: int
    last_import_at: str | None = None
    is_active: bool

    class Config:
        from_attributes = True


class NewRelicImportRequest(BaseModel):
    entity_guid: str | None = None
    since: str = '24 hours ago'
    min_occurrences: int = 1
    fingerprints: list[str] | None = None
    mirror_target: str | None = None  # 'azure' | 'jira' | 'none' | None (auto)
