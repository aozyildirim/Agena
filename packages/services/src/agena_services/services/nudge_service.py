from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from agena_services.integrations.azure_client import AzureDevOpsClient
from agena_services.integrations.jira_client import JiraClient
from agena_services.services.integration_config_service import IntegrationConfigService
from agena_services.services.llm.provider import LLMProvider

logger = logging.getLogger(__name__)


# One full day of silence before the nudge fires. Items that already had
# activity in the last 24h are too fresh to ping — we'd just be noise.
SILENCE_THRESHOLD_HOURS = 24


LANGUAGE_NAMES: dict[str, str] = {
    'tr': 'Turkish',
    'en': 'English',
    'de': 'German',
    'es': 'Spanish',
    'it': 'Italian',
    'ja': 'Japanese',
    'zh': 'Chinese',
}


class NudgeService:
    """Generates a polite status-update nudge for a blocked work item
    and posts it back as a comment on the source system (Azure or Jira).
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.integration_service = IntegrationConfigService(db)
        self.azure_client = AzureDevOpsClient()
        self.jira_client = JiraClient()

    async def post_ai_nudge(
        self,
        *,
        organization_id: int,
        provider: str,
        item_id: str,
        project: str | None,
        title: str,
        reason: str,
        assignee: str,
        language: str,
        agent_provider: str,
        agent_model: str,
    ) -> dict[str, Any]:
        src = (provider or '').strip().lower()
        if src not in {'azure', 'jira'}:
            raise ValueError("provider must be 'azure' or 'jira'")
        config = await self.integration_service.get_config(organization_id, src)
        if config is None or not config.secret:
            raise ValueError(f'{src.capitalize()} integration not configured')

        # 1) Fetch comments + timestamp of the last message
        last_commenter, hours_silent, last_comment_text = await self._last_comment_signal(
            src=src, cfg=self._build_cfg(src, config), project=project or '', item_id=item_id,
        )
        # If the item had activity in the last 24h, bail out — don't nudge
        if hours_silent is not None and hours_silent < SILENCE_THRESHOLD_HOURS:
            return {
                'sent': False,
                'reason_code': 'too_soon',
                'hours_silent': round(hours_silent, 1),
                'last_commenter': last_commenter,
                'comment_text': '',
                'generated_by': '',
            }

        # 2) Ask the LLM for a polite nudge in the requested language
        llm = self._build_llm(agent_provider)
        lang_name = LANGUAGE_NAMES.get((language or 'en').lower(), 'English')
        system_prompt = (
            f'You are a tactful sprint facilitator. Write a short, friendly status-check '
            f'comment in {lang_name} for a blocked work item. '
            'Address the named assignee warmly, reference the stated blocker briefly, '
            'ask for a quick status update, and sign off naturally. '
            'Keep it under 80 words. Plain text only, no markdown, no code blocks.'
        )
        silent_phrase = (
            f'{int(hours_silent)} hours' if hours_silent is not None else 'a long while'
        )
        last_line = f'Last reply was from {last_commenter} ({silent_phrase} ago).' if last_commenter else 'No replies on the thread yet.'
        user_prompt = (
            f'Work item title: {title}\n'
            f'Assignee: {assignee}\n'
            f'Blocker note: {reason or "(not supplied)"}\n'
            f'{last_line}\n\n'
            'Draft the comment now.'
        )
        try:
            comment_text, _usage, model, _cached = await llm.generate(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                complexity_hint='simple',
                max_output_tokens=400,
                skip_cache=True,
            )
        except Exception as exc:
            logger.warning('nudge llm generation failed: %s', exc)
            return {
                'sent': False,
                'reason_code': 'llm_failed',
                'hours_silent': round(hours_silent, 1) if hours_silent is not None else None,
                'last_commenter': last_commenter,
                'comment_text': '',
                'generated_by': '',
                'error': str(exc)[:240],
            }
        comment_text = (comment_text or '').strip()
        if not comment_text:
            return {
                'sent': False,
                'reason_code': 'llm_empty',
                'hours_silent': round(hours_silent, 1) if hours_silent is not None else None,
                'last_commenter': last_commenter,
                'comment_text': '',
                'generated_by': model,
            }
        # Also log the agent_model the caller asked for (we may override it
        # at provider level but the intent is worth preserving).
        resolved_model = agent_model.strip() or model

        # 3) Post
        try:
            if src == 'azure':
                await self.azure_client.writeback_refinement(
                    cfg=self._build_cfg(src, config), work_item_id=item_id,
                    suggested_story_points=0, comment=comment_text,
                )
            else:
                await self.jira_client.writeback_refinement(
                    cfg=self._build_cfg(src, config), issue_key=item_id,
                    suggested_story_points=0, comment=comment_text, board_id='',
                )
        except Exception as exc:
            logger.warning('nudge post failed: %s', exc)
            return {
                'sent': False,
                'reason_code': 'post_failed',
                'hours_silent': round(hours_silent, 1) if hours_silent is not None else None,
                'last_commenter': last_commenter,
                'comment_text': comment_text,
                'generated_by': resolved_model,
                'error': str(exc)[:240],
            }
        return {
            'sent': True,
            'reason_code': 'sent',
            'hours_silent': round(hours_silent, 1) if hours_silent is not None else None,
            'last_commenter': last_commenter,
            'comment_text': comment_text,
            'generated_by': resolved_model,
        }

    async def _last_comment_signal(
        self, *, src: str, cfg: dict[str, str], project: str, item_id: str,
    ) -> tuple[str, float | None, str]:
        if src == 'azure':
            comments = await self.azure_client.fetch_work_item_comments(
                cfg=cfg, project=project, work_item_id=item_id,
            )
        else:
            comments = await self.jira_client.fetch_issue_comments(
                cfg=cfg, issue_key=item_id,
            )
        if not comments:
            return '', None, ''
        first = comments[0] or {}
        raw_ts = str(first.get('created_at') or first.get('modified_date') or '')
        hours_silent = self._hours_since(raw_ts)
        return (
            str(first.get('created_by') or ''),
            hours_silent,
            str(first.get('text') or ''),
        )

    @staticmethod
    def _hours_since(iso_ts: str) -> float | None:
        if not iso_ts:
            return None
        raw = iso_ts.strip().replace('Z', '+00:00')
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - parsed
        return max(0.0, delta.total_seconds() / 3600.0)

    @staticmethod
    def _build_cfg(src: str, config: Any) -> dict[str, str]:
        if src == 'azure':
            return {'org_url': config.base_url or '', 'pat': config.secret or ''}
        return {
            'base_url': config.base_url or '',
            'email': config.username or '',
            'api_token': config.secret or '',
        }

    def _build_llm(self, agent_provider: str) -> LLMProvider:
        slug = (agent_provider or 'openai').strip().lower()
        # CLI-bridge modes (claude_cli / codex_cli) would loop through the
        # bridge — overkill for a short nudge. We collapse to their
        # API-native equivalent provider where possible.
        if slug in {'claude_cli', 'anthropic'}:
            # Anthropic isn't a top-level provider in LLMProvider today;
            # fall through to the default openai-compatible route.
            return LLMProvider()
        if slug == 'gemini':
            return LLMProvider(provider='gemini')
        return LLMProvider()  # openai default / hal / codex_cli fallback
