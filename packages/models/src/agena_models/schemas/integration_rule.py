from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class RuleMatch(BaseModel):
    reporter: str | None = None
    issue_type: str | None = None
    project: str | None = None
    labels: list[str] | None = None


class RuleAction(BaseModel):
    tags: list[str] = Field(default_factory=list)
    priority: str | None = None  # critical | high | medium | low
    repo_mapping_id: int | None = None
    flow_id: str | None = None
    agent_role: str | None = None


class IntegrationRuleCreate(BaseModel):
    provider: str  # 'jira' | 'azure'
    name: str
    match: RuleMatch
    action: RuleAction
    is_active: bool = True
    sort_order: int = 100


class IntegrationRuleUpdate(BaseModel):
    name: str | None = None
    match: RuleMatch | None = None
    action: RuleAction | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class IntegrationRuleResponse(BaseModel):
    id: int
    provider: str
    name: str
    match: dict[str, Any]
    action: dict[str, Any]
    is_active: bool
    sort_order: int

    class Config:
        from_attributes = True
