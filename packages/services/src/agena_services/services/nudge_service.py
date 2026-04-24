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

        # 2) Prepare prompts
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

        slug = (agent_provider or 'openai').strip().lower()
        try:
            if slug == 'claude_cli':
                claude_model = (agent_model or 'sonnet').strip() or 'sonnet'
                try:
                    from agena_services.services.claude_cli_service import ClaudeCLIService
                    claude = ClaudeCLIService()
                    comment_text = await claude.generate_text(
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        model=claude_model,
                    )
                    return await self._finalise_and_post(
                        src=src, config=config, item_id=item_id, comment_text=comment_text,
                        last_commenter=last_commenter, hours_silent=hours_silent,
                        generated_by=f'claude_cli · {claude_model}',
                    )
                except RuntimeError as claude_exc:
                    # Host Claude CLI unavailable / not authed → fall back to
                    # Codex CLI on the same bridge. The user's env already
                    # has Codex configured by default in their setup.
                    logger.info('claude_cli unavailable, falling back to codex_cli: %s', claude_exc)
                    from agena_services.services.codex_cli_service import CodexCLIService
                    codex = CodexCLIService()
                    codex_model = 'gpt-4o-mini'
                    comment_text = await codex.generate_text(
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        model=codex_model,
                    )
                    return await self._finalise_and_post(
                        src=src, config=config, item_id=item_id, comment_text=comment_text,
                        last_commenter=last_commenter, hours_silent=hours_silent,
                        generated_by=f'codex_cli · {codex_model} (fallback from claude_cli)',
                    )

            if slug == 'codex_cli':
                from agena_services.services.codex_cli_service import CodexCLIService
                codex = CodexCLIService()
                model = (agent_model or '').strip() or 'gpt-4o-mini'
                comment_text = await codex.generate_text(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    model=model,
                )
                return await self._finalise_and_post(
                    src=src, config=config, item_id=item_id, comment_text=comment_text,
                    last_commenter=last_commenter, hours_silent=hours_silent,
                    generated_by=f'codex_cli · {model}',
                )

            llm, resolved_provider = await self._build_llm(organization_id, slug)
        except ValueError as exc:
            return {
                'sent': False,
                'reason_code': 'no_llm_configured',
                'hours_silent': round(hours_silent, 1) if hours_silent is not None else None,
                'last_commenter': last_commenter,
                'comment_text': '',
                'generated_by': '',
                'error': str(exc),
            }
        except RuntimeError as exc:
            # Claude CLI bridge / auth / connectivity errors land here.
            return {
                'sent': False,
                'reason_code': 'cli_unavailable',
                'hours_silent': round(hours_silent, 1) if hours_silent is not None else None,
                'last_commenter': last_commenter,
                'comment_text': '',
                'generated_by': '',
                'error': str(exc),
            }

        # OpenAI / Gemini path — direct API call via LLMProvider.
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
        resolved_model = agent_model.strip() or model
        return await self._finalise_and_post(
            src=src, config=config, item_id=item_id, comment_text=comment_text,
            last_commenter=last_commenter, hours_silent=hours_silent,
            generated_by=f'{resolved_provider} · {resolved_model}',
        )

    async def _finalise_and_post(
        self, *, src: str, config: Any, item_id: str, comment_text: str,
        last_commenter: str, hours_silent: float | None, generated_by: str,
    ) -> dict[str, Any]:
        comment_text = (comment_text or '').strip()
        if not comment_text:
            return {
                'sent': False,
                'reason_code': 'llm_empty',
                'hours_silent': round(hours_silent, 1) if hours_silent is not None else None,
                'last_commenter': last_commenter,
                'comment_text': '',
                'generated_by': generated_by,
            }
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
                'generated_by': generated_by,
                'error': str(exc)[:240],
            }
        return {
            'sent': True,
            'reason_code': 'sent',
            'hours_silent': round(hours_silent, 1) if hours_silent is not None else None,
            'last_commenter': last_commenter,
            'comment_text': comment_text,
            'generated_by': generated_by,
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

    async def _build_llm(
        self, organization_id: int, agent_provider: str,
    ) -> tuple[LLMProvider, str]:
        """Resolve an API key + base_url for the chosen provider.

        Loads from the org's saved integration_config first (Integrations
        page), then falls back to the global settings env var. Raises
        ValueError with a clear message when neither is available — the
        route surfaces this as `no_llm_configured` instead of silently
        returning mock output.
        """
        slug = (agent_provider or 'openai').strip().lower()
        # CLI-bridge modes and 'hal' get mapped to an API-native route for
        # a short one-shot nudge — looping through the bridge/HAL adds
        # latency without benefit here.
        if slug in {'claude_cli', 'anthropic', 'hal'}:
            slug = 'openai'
        elif slug == 'codex_cli':
            slug = 'openai'
        elif slug not in {'openai', 'gemini'}:
            slug = 'openai'

        integration = await self.integration_service.get_config(organization_id, slug)
        api_key = ((integration.secret if integration else '') or '').strip()
        base_url = ((integration.base_url if integration else '') or '').strip()

        settings = self.azure_client.settings  # reuse any initialized settings obj
        if slug == 'openai':
            api_key = api_key or (settings.openai_api_key or '').strip()
            base_url = base_url or (settings.openai_base_url or '').strip()
        elif slug == 'gemini' and not base_url:
            base_url = 'https://generativelanguage.googleapis.com'

        if not api_key or api_key.startswith('your_'):
            raise ValueError(
                f"{slug} API key is not configured — add it at "
                "/dashboard/integrations (provider: "
                f"{slug}) or set the env var."
            )

        llm = LLMProvider(
            provider=slug,
            api_key=api_key,
            base_url=base_url or None,
        )
        return llm, slug
