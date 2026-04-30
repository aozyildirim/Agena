"""IntegrationRule engine — given a Jira issue or Azure work item payload,
apply matching rules and produce an action (tags, priority override, repo
override, flow override, agent role) that the import path then stamps onto
the resulting TaskRecord."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.integration_rule import IntegrationRule

logger = logging.getLogger(__name__)


@dataclass
class RuleAction:
    """Composed result of all matching rules for a given source payload."""
    tags: list[str] = field(default_factory=list)
    priority: str | None = None
    repo_mapping_id: int | None = None
    flow_id: str | None = None
    agent_role: str | None = None
    matched_rule_ids: list[int] = field(default_factory=list)


def _norm(v: Any) -> str:
    return str(v or '').strip().lower()


def _match_one(criteria: dict, payload: dict) -> bool:
    """All non-empty fields in `criteria` must match the corresponding payload
    field. String comparisons are case-insensitive and trimmed.

    Supported criteria keys:
        reporter      → exact email or displayName match (case-insensitive)
        issue_type    → exact match (Bug / Story / Security / etc.)
        project       → exact match
        labels        → list — payload labels must contain all listed values
    """
    if not criteria:
        return False  # an empty rule matches nothing on purpose

    reporter = criteria.get('reporter')
    if reporter:
        candidates = {
            _norm(payload.get('reporter_email')),
            _norm(payload.get('reporter_name')),
            _norm(payload.get('reporter')),
            _norm(payload.get('created_by_email')),
            _norm(payload.get('created_by_name')),
            _norm(payload.get('created_by')),
        }
        if _norm(reporter) not in candidates:
            return False

    issue_type = criteria.get('issue_type')
    if issue_type:
        candidates = {
            _norm(payload.get('issue_type')),
            _norm(payload.get('work_item_type')),
            _norm(payload.get('type')),
        }
        if _norm(issue_type) not in candidates:
            return False

    project = criteria.get('project')
    if project:
        candidates = {
            _norm(payload.get('project')),
            _norm(payload.get('project_key')),
        }
        if _norm(project) not in candidates:
            return False

    required_labels = criteria.get('labels')
    if required_labels:
        if isinstance(required_labels, str):
            required_labels = [required_labels]
        payload_labels_raw = payload.get('labels') or payload.get('tags') or []
        if not isinstance(payload_labels_raw, list):
            payload_labels_raw = [payload_labels_raw]
        payload_labels = {_norm(x) for x in payload_labels_raw}
        for lbl in required_labels:
            if _norm(lbl) not in payload_labels:
                return False

    return True


async def evaluate_rules(
    db: AsyncSession,
    *,
    organization_id: int,
    provider: str,
    payload: dict,
) -> RuleAction:
    """Run all active rules for this org+provider against the payload and
    merge their actions. Tags accumulate; later rules override earlier
    rules on scalar fields (priority/repo/flow/agent) by their sort_order."""
    if not payload:
        return RuleAction()

    rows = list((await db.execute(
        select(IntegrationRule).where(
            IntegrationRule.organization_id == organization_id,
            IntegrationRule.provider == provider,
            IntegrationRule.is_active.is_(True),
        ).order_by(IntegrationRule.sort_order, IntegrationRule.id)
    )).scalars().all())

    out = RuleAction()
    for rule in rows:
        try:
            criteria = json.loads(rule.match_json or '{}')
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(criteria, dict):
            continue
        if not _match_one(criteria, payload):
            continue
        try:
            action = json.loads(rule.action_json or '{}')
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(action, dict):
            continue

        out.matched_rule_ids.append(rule.id)

        tags = action.get('tags') or []
        if isinstance(tags, str):
            tags = [tags]
        for tag in tags:
            tag_norm = str(tag).strip()
            if tag_norm and tag_norm not in out.tags:
                out.tags.append(tag_norm)

        priority = str(action.get('priority') or '').strip().lower()
        if priority in ('critical', 'high', 'medium', 'low'):
            out.priority = priority

        rm = action.get('repo_mapping_id')
        try:
            if rm is not None and rm != '':
                out.repo_mapping_id = int(rm)
        except (TypeError, ValueError):
            pass

        flow_id = str(action.get('flow_id') or '').strip()
        if flow_id:
            out.flow_id = flow_id

        agent_role = str(action.get('agent_role') or '').strip()
        if agent_role:
            out.agent_role = agent_role

    if out.matched_rule_ids:
        logger.info(
            'IntegrationRule matches org=%s provider=%s rules=%s tags=%s priority=%s',
            organization_id, provider, out.matched_rule_ids, out.tags, out.priority,
        )
    return out
