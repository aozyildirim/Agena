from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class IntegrationRule(Base):
    """Cross-provider rule that auto-tags / routes imported tasks based on
    matchable fields (reporter, work item type, project, labels) coming from
    Jira or Azure DevOps. Stored as a JSON 'match' criteria + JSON 'action'
    payload so the engine stays generic."""

    __tablename__ = 'integration_rules'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey('organizations.id', ondelete='CASCADE'), index=True)
    provider: Mapped[str] = mapped_column(String(16), index=True)  # 'jira' | 'azure'
    name: Mapped[str] = mapped_column(String(160))

    # JSON-encoded match criteria. Example:
    # {"reporter": "security@example.com", "issue_type": "Bug", "labels": ["security"]}
    # Empty values are ignored. ALL non-empty fields must match (AND).
    match_json: Mapped[str] = mapped_column(Text, default='{}')

    # JSON-encoded action payload. Example:
    # {"tags": ["security_review"], "priority": "critical", "repo_mapping_id": 3, "flow_id": "abc", "agent_role": "reviewer"}
    action_json: Mapped[str] = mapped_column(Text, default='{}')

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
