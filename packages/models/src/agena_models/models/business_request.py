from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class BusinessRequestSettings(Base):
    """Org-level configuration for BR Management (one row per org).

    `br_emails` is a free list of the people who own/handle business
    requests — work assigned to these addresses flows into the BR queue.
    `rubric` and `epic_rule` are free-text criteria injected into the
    evaluation prompt so each org tunes what "sufficient" and "Epic"
    mean without code changes.
    """

    __tablename__ = 'business_request_settings'
    __table_args__ = (
        UniqueConstraint('organization_id', name='uq_br_settings_org'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey('organizations.id', ondelete='CASCADE'), index=True
    )
    # Free email list of BR owners.
    br_emails: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Free-text "what makes a BR sufficient" criteria.
    rubric: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Free-text "what makes a BR an Epic vs an Improvement".
    epic_rule: Mapped[str | None] = mapped_column(Text, nullable=True)
    auto_eval: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Optional LLM override; falls back to the org's configured agent.
    provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Optional Azure DevOps PAT scoped for BR people's work items. The org's
    # main Azure PAT often can't see the BR team's project/area; when this is
    # set, BR item fetching uses it instead. Empty → fall back to the main
    # Azure integration. azure_base_url overrides the org URL when the BR
    # team lives in a different Azure organization.
    azure_pat: Mapped[str | None] = mapped_column(Text, nullable=True)
    azure_base_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class BusinessRequestEval(Base):
    """AI evaluation result for a single work item, from a BR perspective.

    One row per external work item (deduped by org + source + external_id,
    like TriageDecision). Holds the classification (Improvement / Epic /
    not-a-BR), a readiness score, the AI's clarifying questions, the
    answers captured from stakeholders, and the resulting verdict. Saved
    answers are fed back into the prompt on re-evaluation so the score
    improves as gaps are filled.
    """

    __tablename__ = 'business_request_evals'
    __table_args__ = (
        UniqueConstraint(
            'organization_id', 'source', 'external_id', name='uq_br_eval_item'
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey('organizations.id', ondelete='CASCADE'), index=True
    )
    source: Mapped[str] = mapped_column(String(32))  # azure | jira | youtrack
    external_id: Mapped[str] = mapped_column(String(128))
    assignee_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    # improvement | epic | not_br
    br_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    readiness_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # ready | needs_info | not_br
    verdict: Mapped[str | None] = mapped_column(String(16), nullable=True)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Decision Pack section coverage: [{"section": "...", "status": "ok|partial|missing", "note": "..."}]
    checklist: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # [{"id": "q1", "text": "..."}]
    questions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # {"q1": "answer", ...}
    answers: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # pending | evaluated | accepted | rejected
    status: Mapped[str] = mapped_column(String(16), default='pending')
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
