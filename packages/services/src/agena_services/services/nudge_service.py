from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.nudge_history import NudgeHistory
from agena_services.integrations.azure_client import AzureDevOpsClient
from agena_services.integrations.jira_client import JiraClient
from agena_services.services.integration_config_service import IntegrationConfigService
from agena_services.services.llm.provider import LLMProvider

logger = logging.getLogger(__name__)


# One full day of silence before the nudge fires. Items that already had
# activity in the last 24h are too fresh to ping — we'd just be noise.
SILENCE_THRESHOLD_HOURS = 24

# Minimum hours between two nudges on the same item. Prevents spam:
# if you pinged yesterday and the thread is still silent, don't ping
# again until the cooldown elapses.
NUDGE_COOLDOWN_HOURS = 48


LANGUAGE_NAMES: dict[str, str] = {
    'tr': 'Turkish',
    'en': 'English',
    'de': 'German',
    'es': 'Spanish',
    'it': 'Italian',
    'ja': 'Japanese',
    'zh': 'Chinese',
}


# Agena signature appended to every nudge — localized so the tone matches
# the rest of the comment. We keep it a short one-liner with the AI model
# so the recipient knows (a) it was auto-generated, (b) which model, and
# (c) what to reply to (they still @-reply to the assignee, not the bot).
AGENA_SIGNATURE: dict[str, str] = {
    'tr': '— 🤖 Agena, sprint ekibi adına {model} ile yazdı. Serbestçe düzenleyebilirsin.',
    'en': '— 🤖 Written by Agena via {model} on behalf of the sprint team. Edit freely.',
    'de': '— 🤖 Von Agena via {model} im Auftrag des Sprint-Teams verfasst. Frei editierbar.',
    'es': '— 🤖 Redactado por Agena con {model} en nombre del equipo del sprint. Edita libremente.',
    'it': '— 🤖 Scritto da Agena tramite {model} per conto del team di sprint. Modifica liberamente.',
    'ja': '— 🤖 Agena が {model} を使いスプリントチームの代わりに作成。自由に編集してください。',
    'zh': '— 🤖 Agena 通过 {model} 代表 sprint 团队撰写。可自由编辑。',
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

    async def list_recent_nudges(
        self,
        *,
        organization_id: int,
        provider: str,
        item_ids: list[str],
    ) -> dict[str, dict[str, Any]]:
        """Return a map of external_item_id → latest nudge record for the
        items passed in. Used by the UI to badge items that have already
        been pinged so the operator doesn't spam them."""
        if not item_ids:
            return {}
        src = (provider or '').strip().lower()
        cutoff = datetime.now(timezone.utc) - timedelta(days=14)
        stmt = (
            select(NudgeHistory)
            .where(
                NudgeHistory.organization_id == organization_id,
                NudgeHistory.provider == src,
                NudgeHistory.external_item_id.in_(item_ids),
                NudgeHistory.created_at >= cutoff.replace(tzinfo=None),
            )
            .order_by(NudgeHistory.external_item_id, desc(NudgeHistory.created_at))
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        out: dict[str, dict[str, Any]] = {}
        for row in rows:
            key = row.external_item_id
            if key in out:
                continue  # already took the newest thanks to ORDER BY
            out[key] = {
                'item_id': key,
                'assignee': row.assignee,
                'language': row.language,
                'generated_by': row.generated_by,
                'hours_silent': row.hours_silent,
                'created_at': row.created_at.isoformat() if row.created_at else None,
            }
        return out

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
        user_id: int | None = None,
    ) -> dict[str, Any]:
        src = (provider or '').strip().lower()
        if src not in {'azure', 'jira'}:
            raise ValueError("provider must be 'azure' or 'jira'")
        config = await self.integration_service.get_config(organization_id, src)
        if config is None or not config.secret:
            raise ValueError(f'{src.capitalize()} integration not configured')

        # 0) Dedup — did we already nudge this item inside the cooldown window?
        cooldown_cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=NUDGE_COOLDOWN_HOURS)
        stmt = (
            select(NudgeHistory)
            .where(
                NudgeHistory.organization_id == organization_id,
                NudgeHistory.provider == src,
                NudgeHistory.external_item_id == item_id,
                NudgeHistory.created_at >= cooldown_cutoff,
            )
            .order_by(desc(NudgeHistory.created_at))
            .limit(1)
        )
        existing = (await self.db.execute(stmt)).scalar_one_or_none()
        if existing is not None:
            delta_hours = (datetime.now(timezone.utc).replace(tzinfo=None) - existing.created_at).total_seconds() / 3600.0
            return {
                'sent': False,
                'reason_code': 'already_nudged',
                'hours_silent': None,
                'last_commenter': '',
                'comment_text': existing.comment_text or '',
                'generated_by': existing.generated_by or '',
                'hours_since_last_nudge': round(delta_hours, 1),
            }

        # 1) Fetch comments + timestamp of the last message
        last_commenter, hours_silent, recent_comments = await self._last_comment_signal(
            src=src, cfg=self._build_cfg(src, config), project=project or '', item_id=item_id,
        )
        # Stash request metadata for _finalise_and_post to persist on success.
        self._pending_meta = {
            'organization_id': organization_id,
            'user_id': user_id,
            'provider': src,
            'item_id': item_id,
            'assignee': assignee,
            'language': language,
            'agent_provider': agent_provider,
            'agent_model': agent_model,
        }
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
            f'You write tight, context-aware sprint status-check messages in {lang_name}. '
            'You will be given the work item, the blocker note, and the last few comments on the thread. '
            'Read the comments carefully — reference what was ACTUALLY said, acknowledge any commitments or handoffs '
            'that were made, and ask a specific question about the concrete next step (not a generic "any update?"). '
            'If the last commenter promised to do X, ask how X is going. If they flagged a dependency, ask about that dependency by name. '
            'Produce exactly ONE short paragraph — no line breaks, no empty lines, no bullet points. '
            'Target 2-3 sentences, max 65 words. Plain text, no markdown, no code blocks. '
            'Do NOT start with "Hi <name>," — the @mention is prepended separately. '
            'Do NOT sign off or add a signature — it is appended separately. '
            'Never invent details that are not in the comments or the blocker note.'
        )
        silent_phrase = (
            f'{int(hours_silent)} hours' if hours_silent is not None else 'a long while'
        )
        last_line = f'Last reply was {silent_phrase} ago from {last_commenter}.' if last_commenter else 'No prior replies on the thread.'

        # Build the comments block for the prompt. Oldest → newest so the
        # model's last "read" is the most recent activity.
        if recent_comments:
            thread_lines = ['', 'Recent thread (oldest → newest):']
            for c in recent_comments:
                ts = c.get('ts', '')[:16] or '?'
                thread_lines.append(f'  [{ts}] {c.get("author", "?")}:\n    {c.get("text", "")}')
            thread_block = '\n'.join(thread_lines)
        else:
            thread_block = '\nThe thread has no prior comments yet.'

        user_prompt = (
            f'Title: {title}\n'
            f'Assignee: {assignee}\n'
            f'Blocker: {reason or "(not supplied)"}\n'
            f'{last_line}'
            f'{thread_block}\n\n'
            'Now write the single-paragraph nudge, grounding every question in the thread above.'
        )

        slug = (agent_provider or 'openai').strip().lower()
        try:
            if slug == 'claude_cli':
                claude_model = (agent_model or 'sonnet').strip() or 'sonnet'
                try:
                    from agena_services.services.claude_cli_service import ClaudeCLIService
                    claude = ClaudeCLIService()
                    raw = await claude.generate_text(
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        model=claude_model,
                    )
                    generated_by = f'claude_cli · {claude_model}'
                    final = self._compose_final_comment(
                        body=raw, assignee=assignee, language=language, generated_by=generated_by,
                    )
                    return await self._finalise_and_post(
                        src=src, config=config, item_id=item_id, comment_text=final,
                        last_commenter=last_commenter, hours_silent=hours_silent,
                        generated_by=generated_by,
                    )
                except RuntimeError as claude_exc:
                    # Host Claude CLI unavailable / not authed → fall back to
                    # Codex CLI on the same bridge. The user's env already
                    # has Codex configured by default in their setup.
                    logger.info('claude_cli unavailable, falling back to codex_cli: %s', claude_exc)
                    from agena_services.services.codex_cli_service import CodexCLIService
                    codex = CodexCLIService()
                    codex_model = 'gpt-4o-mini'
                    raw = await codex.generate_text(
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        model=codex_model,
                    )
                    generated_by = f'codex_cli · {codex_model} (fallback from claude_cli)'
                    final = self._compose_final_comment(
                        body=raw, assignee=assignee, language=language, generated_by=generated_by,
                    )
                    return await self._finalise_and_post(
                        src=src, config=config, item_id=item_id, comment_text=final,
                        last_commenter=last_commenter, hours_silent=hours_silent,
                        generated_by=generated_by,
                    )

            if slug == 'codex_cli':
                from agena_services.services.codex_cli_service import CodexCLIService
                codex = CodexCLIService()
                model = (agent_model or '').strip() or 'gpt-4o-mini'
                raw = await codex.generate_text(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    model=model,
                )
                generated_by = f'codex_cli · {model}'
                final = self._compose_final_comment(
                    body=raw, assignee=assignee, language=language, generated_by=generated_by,
                )
                return await self._finalise_and_post(
                    src=src, config=config, item_id=item_id, comment_text=final,
                    last_commenter=last_commenter, hours_silent=hours_silent,
                    generated_by=generated_by,
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
        generated_by = f'{resolved_provider} · {resolved_model}'
        final = self._compose_final_comment(
            body=comment_text, assignee=assignee, language=language, generated_by=generated_by,
        )
        return await self._finalise_and_post(
            src=src, config=config, item_id=item_id, comment_text=final,
            last_commenter=last_commenter, hours_silent=hours_silent,
            generated_by=generated_by,
        )

    @staticmethod
    def _compose_final_comment(
        *, body: str, assignee: str, language: str, generated_by: str,
    ) -> str:
        """Wrap the LLM-generated body with an @mention of the assignee
        and a localized Agena signature line. The LLM is instructed not
        to greet by name or sign off, so this helper owns both framing
        bits deterministically."""
        clean = (body or '').strip()
        mention = f'@{assignee.strip()} ' if assignee and assignee.strip() and assignee.strip() != '—' else ''
        sig_template = AGENA_SIGNATURE.get((language or 'en').lower(), AGENA_SIGNATURE['en'])
        signature = sig_template.format(model=generated_by or 'AI')
        # Keep the gap between body and signature to a single blank line —
        # Azure and Jira both collapse <p><br/></p> clusters, so extra
        # breaks here only add visual noise on the generated side.
        return f'{mention}{clean}\n\n{signature}'

    @staticmethod
    def _compose_azure_html(
        text: str,
        assignee_name: str = '',
        identity: dict[str, str] | None = None,
    ) -> str:
        """Convert the composed plain-text nudge to Azure DevOps HTML.

        The service passes the known assignee display name explicitly so
        we don't have to guess where the leading "@Display Name" ends —
        multi-word names (Zaide KAYMAK, María José García) were tripping
        up a regex-based splitter. We just peel off the exact prefix.

        Mention strategy: ADO's comment renderer auto-converts plain
        `@user@domain.com` text into a real mention with notification, so
        when we have the assignee's UPN we emit `@upn` as the link text
        wrapped in a mailto anchor — that fires the notification reliably
        AND lets us keep the readable display name visible. The previous
        `data-vss-mention="version:2.0,{guid}"` form was malformed (v2
        expects a Graph subject descriptor like `aad.xxx`, not a TFS
        identity GUID) so it rendered as a dead anchor.
        """
        import html as html_mod

        raw = (text or '').strip()
        body = raw
        mention_html = ''

        name = (assignee_name or '').strip()
        prefix = f'@{name}' if name else ''
        if prefix and raw.startswith(prefix):
            body = raw[len(prefix):].lstrip()
            upn = ((identity or {}).get('unique_name') or '').strip()
            if upn and '@' in upn:
                # Plain `@upn` text — ADO's comment renderer walks the
                # body and converts any `@email` token into a real mention
                # with notification. We accept the trade-off that the
                # visible label is the email rather than the display name,
                # because reliable notification > prettier text.
                mention_html = f'@{html_mod.escape(upn)} '
            else:
                mention_html = f'@{html_mod.escape(name)} '

        parts: list[str] = []
        if mention_html:
            parts.append('<p>' + mention_html)
        else:
            parts.append('<p>')
        first_paragraph = True
        for block in body.split('\n\n'):
            block = block.strip()
            if not block:
                continue
            escaped = html_mod.escape(block).replace('\n', '<br/>')
            if first_paragraph and mention_html:
                parts.append(escaped + '</p>')
                first_paragraph = False
            else:
                parts.append(f'<p>{escaped}</p>')
        if first_paragraph and mention_html and body == '':
            parts.append('</p>')
        return ''.join(parts)

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
                # For a real, notification-firing @mention Azure needs the
                # identity GUID. Resolve the assignee (best-effort — falls
                # back to plain text if the lookup fails) and pass it
                # through to the HTML builder.
                meta = getattr(self, '_pending_meta', None) or {}
                assignee_name = str(meta.get('assignee') or '').strip()
                identity = None
                if assignee_name:
                    try:
                        identity = await self.azure_client.resolve_identity(
                            cfg=self._build_cfg(src, config), display_name=assignee_name,
                        )
                    except Exception as exc:
                        logger.info('azure identity resolve failed for %s: %s', assignee_name, exc)
                html_body = self._compose_azure_html(
                    comment_text,
                    assignee_name=assignee_name,
                    identity=identity,
                )
                await self.azure_client.post_raw_html_comment(
                    cfg=self._build_cfg(src, config), work_item_id=item_id,
                    html_body=html_body,
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
        # Persist the nudge record for dedup + UI badging. Swallow write
        # failures — the comment is already on the external system.
        meta = getattr(self, '_pending_meta', None) or {}
        try:
            row = NudgeHistory(
                organization_id=int(meta.get('organization_id') or 0) or None,
                user_id=meta.get('user_id'),
                provider=meta.get('provider') or src,
                external_item_id=str(meta.get('item_id') or item_id),
                assignee=(meta.get('assignee') or '')[:256] or None,
                language=(meta.get('language') or 'en')[:8] or 'en',
                agent_provider=(meta.get('agent_provider') or 'openai')[:32] or 'openai',
                agent_model=(meta.get('agent_model') or '')[:64] or None,
                generated_by=generated_by[:128] if generated_by else None,
                comment_text=comment_text,
                last_commenter=last_commenter[:256] if last_commenter else None,
                hours_silent=hours_silent,
            )
            self.db.add(row)
            await self.db.commit()
        except Exception as exc:
            logger.warning('nudge history persist failed: %s', exc)
            try:
                await self.db.rollback()
            except Exception:
                pass
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
    ) -> tuple[str, float | None, list[dict[str, str]]]:
        """Return (last_commenter, hours_silent, recent_comments).

        `recent_comments` is the last 5 entries in chronological order
        (oldest → newest) with {author, text, ts} keys — the LLM uses
        them as context so the generated nudge references what's
        actually been said rather than repeating a generic template.
        """
        if src == 'azure':
            comments = await self.azure_client.fetch_work_item_comments(
                cfg=cfg, project=project, work_item_id=item_id,
            )
        else:
            comments = await self.jira_client.fetch_issue_comments(
                cfg=cfg, issue_key=item_id,
            )
        if not comments:
            return '', None, []
        first = comments[0] or {}
        raw_ts = str(first.get('created_at') or first.get('modified_date') or '')
        hours_silent = self._hours_since(raw_ts)
        # API returns newest-first; flip for prompt readability and keep
        # the most recent 5 with their full text (truncated per entry).
        recent: list[dict[str, str]] = []
        for c in reversed(comments[:5]):
            text = str(c.get('text') or '').strip()
            if not text:
                continue
            # Strip HTML tags Azure sometimes wraps around comment bodies.
            import re
            text = re.sub(r'<[^>]+>', ' ', text)
            text = re.sub(r'\s+', ' ', text).strip()
            if len(text) > 600:
                text = text[:600].rstrip() + '…'
            recent.append({
                'author': str(c.get('created_by') or 'unknown'),
                'text': text,
                'ts': str(c.get('created_at') or c.get('modified_date') or ''),
            })
        return (
            str(first.get('created_by') or ''),
            hours_silent,
            recent,
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
