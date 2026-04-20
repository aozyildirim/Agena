"""Shared helper for resolving a task's external_work_item_id to a browsable URL
(Azure DevOps work item or Jira issue). Used by NR / Sentry / Datadog / AppDynamics
request endpoints to decorate already-imported rows with a quick link."""
from __future__ import annotations

from typing import Callable
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.user_preference import UserPreference
from agena_services.services.integration_config_service import IntegrationConfigService


async def build_work_item_url_resolver(
    db: AsyncSession, organization_id: int
) -> Callable[[str | None], str | None]:
    """Return a resolver(external_work_item_id) → full URL or None.
    - Numeric IDs → Azure DevOps URL (uses org base + user's azure_project)
    - KEY-123 patterns → Jira URL (uses jira base_url)
    """
    svc = IntegrationConfigService(db)
    azure_cfg = await svc.get_config(organization_id, 'azure')
    jira_cfg = await svc.get_config(organization_id, 'jira')
    azure_base = (azure_cfg.base_url or '').rstrip('/') if azure_cfg else ''
    jira_base = (jira_cfg.base_url or '').rstrip('/') if jira_cfg else ''

    azure_project = ''
    pref_rows = (await db.execute(
        select(UserPreference.azure_project)
    )).all()
    for (proj,) in pref_rows:
        if proj:
            azure_project = proj
            break

    def resolve(wi_id: str | None) -> str | None:
        if not wi_id:
            return None
        wi = str(wi_id).strip()
        if wi.isdigit() and azure_base and azure_project:
            return f'{azure_base}/{quote(azure_project, safe="")}/_workitems/edit/{wi}'
        if '-' in wi and jira_base:
            return f'{jira_base}/browse/{wi}'
        return None

    return resolve
