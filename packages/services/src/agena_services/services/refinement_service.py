from __future__ import annotations

import html
import json
import logging
import re
import time

logger = logging.getLogger(__name__)
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_agents.agents.crewai_agents import CrewAIAgentRunner
from agena_agents.memory.qdrant import QdrantMemoryStore
from agena_core.settings import get_settings
from agena_services.integrations.azure_client import AzureDevOpsClient
from agena_services.integrations.jira_client import JiraClient
from agena_models.models.user_preference import UserPreference
from agena_models.models.refinement_record import RefinementRecord
from agena_models.schemas.refinement import (
    RecommendedAuthor,
    RefinementAnalyzeRequest,
    RefinementAnalyzeResponse,
    RefinementItemsResponse,
    RefinementSuggestion,
    RefinementWritebackRequest,
    RefinementWritebackResponse,
    RefinementWritebackResult,
    SimilarPastItem,
    TouchedFile,
)
from agena_models.schemas.task import ExternalTask
from agena_services.services.ai_usage_event_service import AIUsageEventService
from agena_services.services.integration_config_service import IntegrationConfigService
from agena_services.services.llm.cost_tracker import CostTracker
from agena_services.services.llm.hal_provider import HalProvider
from agena_services.services.llm.provider import LLMProvider


class _SafeDict(dict[str, Any]):
    def __missing__(self, key: str) -> str:
        return ''


# Per-attachment text cap. The full Azure attachment may be 8 MB; only
# the first few thousand chars typically carry the requirements / spec
# the PM intended. Hard cap protects the LLM context.
_ATTACHMENT_TEXT_PER_FILE_LIMIT = 8000
_ATTACHMENT_TOTAL_LIMIT = 24000


def _extract_text_from_pdf(data: bytes) -> str:
    try:
        import io
        import pdfplumber  # type: ignore
        out: list[str] = []
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages[:30]:
                try:
                    txt = page.extract_text() or ''
                except Exception:
                    txt = ''
                if txt:
                    out.append(txt)
        return '\n'.join(out)
    except Exception as exc:
        logger.info('PDF extract failed: %s', exc)
        return ''


def _extract_text_from_docx(data: bytes) -> str:
    try:
        import io
        import docx  # type: ignore
        d = docx.Document(io.BytesIO(data))
        parts = [p.text for p in d.paragraphs if (p.text or '').strip()]
        # Tables — flatten into "cell | cell" lines so requirement
        # tables (very common in Office briefs) survive the trip.
        for tbl in d.tables:
            for row in tbl.rows:
                cells = [(c.text or '').strip() for c in row.cells]
                line = ' | '.join(c for c in cells if c)
                if line:
                    parts.append(line)
        return '\n'.join(parts)
    except Exception as exc:
        logger.info('DOCX extract failed: %s', exc)
        return ''


def _extract_text_from_xlsx(data: bytes) -> str:
    try:
        import io
        import openpyxl  # type: ignore
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
        out: list[str] = []
        for name in wb.sheetnames[:5]:
            ws = wb[name]
            out.append(f'--- {name} ---')
            for row in ws.iter_rows(max_rows=200, values_only=True):
                cells = [str(c) for c in row if c is not None and str(c).strip()]
                if cells:
                    out.append(' | '.join(cells))
        wb.close()
        return '\n'.join(out)
    except Exception as exc:
        logger.info('XLSX extract failed: %s', exc)
        return ''


def _extract_attachments_text(
    files: list[tuple[str, bytes, str]] | None,
) -> str:
    """Turn (filename, bytes, mime) tuples into a single prompt-friendly
    block. Skips formats we can't parse so the LLM doesn't see noise.
    Returns '' if nothing extractable came through."""
    if not files:
        return ''
    blocks: list[str] = []
    total = 0
    for name, data, mime in files:
        text = ''
        ext = (name.rsplit('.', 1)[-1] if '.' in name else '').lower()
        m = (mime or '').lower()
        if ext == 'pdf' or 'pdf' in m:
            text = _extract_text_from_pdf(data)
        elif ext == 'docx' or 'wordprocessingml' in m:
            text = _extract_text_from_docx(data)
        elif ext == 'xlsx' or 'spreadsheetml' in m:
            text = _extract_text_from_xlsx(data)
        elif ext in {'txt', 'md', 'csv', 'log', 'json', 'yaml', 'yml'} or m.startswith('text/'):
            try:
                text = data.decode('utf-8', errors='replace')
            except Exception:
                text = ''
        else:
            # Unknown binary — skip rather than dumping bytes into prompt.
            continue
        text = (text or '').strip()
        if not text:
            continue
        if len(text) > _ATTACHMENT_TEXT_PER_FILE_LIMIT:
            text = text[:_ATTACHMENT_TEXT_PER_FILE_LIMIT] + '\n…[truncated]'
        block = f'[ATTACHMENT: {name}]\n{text}'
        if total + len(block) > _ATTACHMENT_TOTAL_LIMIT:
            blocks.append(f'[ATTACHMENT: {name}]\n…[skipped — total budget exhausted]')
            break
        blocks.append(block)
        total += len(block)
    if not blocks:
        return ''
    header = '## Eklenen Dokümanlar / Attachments'
    return header + '\n\n' + '\n\n'.join(blocks)


class _RefinementFileChange(BaseModel):
    """Loose schema for the file_changes block — we don't validate paths
    here; resolution happens in _resolve_authorship_for_files."""
    file: str = ''
    action: str = 'modify'
    description: str = ''


class _RefinementStructuredOutput(BaseModel):
    summary: str = ''
    suggested_story_points: int | str = 0  # Accept string too (LLM may return "5 puan")
    estimation_rationale: str = ''
    confidence: int | str = 0  # Accept string too
    comment: str = ''
    ambiguities: list[str] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)
    ready_for_planning: bool = False
    # Code-aware additions: LLM lists candidate files it would edit.
    # Same `file_changes` shape PM_SYSTEM_PROMPT already produces.
    file_changes: list[_RefinementFileChange] = Field(default_factory=list)


class RefinementService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.settings = get_settings()
        self.azure_client = AzureDevOpsClient()
        self.jira_client = JiraClient()
        self.integration_service = IntegrationConfigService(db)
        self.cost_tracker = CostTracker()
        self.memory = QdrantMemoryStore()

    # Absolute floor — below this it's pure noise. But because short-text
    # Turkish/multilingual embeddings compress scores into a narrow 0.70-
    # 0.80 band, we don't rely on absolute score alone. We also apply a
    # *relative* gap from the top hit, and classify into tiers so the UI
    # + LLM can weight strong vs weak matches correctly.
    SIMILAR_MIN_SCORE = 0.55
    # Hits further than this below the top hit are dropped — risk of
    # diluting the LLM's reasoning outweighs any grounding benefit.
    SIMILAR_MAX_GAP = 0.06
    # Absolute tier cutoffs. Because short Turkish/multilingual embeddings
    # compress into 0.70-0.80 for ANY two "same domain" items, a hit is
    # only "strong" when it clears a high absolute bar (real semantic
    # closeness). Gap-based tiers falsely mark the top hit strong even
    # when the whole cluster is generic noise.
    TIER_STRONG_SCORE = 0.82
    TIER_RELATED_SCORE = 0.72
    # If we have >=3 hits of the same work_item_type after the threshold,
    # keep only those — avoids anchoring a Bug's SP on a same-worded Story.
    TYPE_MATCH_MIN_COUNT = 3

    async def _fetch_similar_past(
        self,
        organization_id: int,
        item: ExternalTask,
        *,
        limit: int = 5,
        skip_external_id: str | None = None,
    ) -> list[SimilarPastItem]:
        """Look up completed work items with final story points whose
        title+description embed close to the current item. Used to ground
        the LLM's SP estimate and surface 'kimler yaptı' context."""
        if not self.memory.enabled:
            return []
        # Normalise the description BEFORE embedding — Azure returns HTML
        # <p>...</p><br/> which dilutes semantic signal unless stripped.
        clean_desc = self._normalize_description(item.description)
        query_parts = [str(item.title or '').strip(), clean_desc[:1500]]
        query = '\n\n'.join(p for p in query_parts if p)
        if not query:
            return []
        logger.info(
            'Refinement embed input for %s (len=%d): %r',
            item.id, len(query), query[:300],
        )
        # Pull a wider candidate pool so we have room to filter on score +
        # type before picking the top N.
        candidate_limit = max(limit * 4, 12)
        try:
            rows = await self.memory.search_similar(
                query,
                limit=candidate_limit,
                organization_id=organization_id,
                extra_filters={'kind': 'completed_task'},
            )
        except Exception as exc:
            logger.info('Qdrant similar-past lookup failed for item %s: %s', item.id, exc)
            return []

        # Shape raw rows into typed records; track scores for diagnostics
        shaped: list[tuple[SimilarPastItem, str]] = []  # (record, work_item_type)
        for row in rows:
            ext_id = str(row.get('external_id') or '')
            if not ext_id:
                continue
            if skip_external_id and ext_id == str(skip_external_id):
                continue
            sp = row.get('story_points')
            try:
                sp_int = int(sp) if sp is not None else 0
            except (TypeError, ValueError):
                sp_int = 0
            if sp_int <= 0:
                continue
            score = float(row.get('_score') or 0.0)
            raw_branches = row.get('branches') or []
            raw_pr_titles = row.get('pr_titles') or []
            record = SimilarPastItem(
                external_id=ext_id,
                title=str(row.get('title') or '')[:300],
                story_points=sp_int,
                assigned_to=str(row.get('assigned_to') or ''),
                url=str(row.get('url') or ''),
                source=str(row.get('source') or ''),
                score=score,
                branches=[str(b) for b in raw_branches if b][:5] if isinstance(raw_branches, list) else [],
                pr_titles=[str(t) for t in raw_pr_titles if t][:5] if isinstance(raw_pr_titles, list) else [],
                pr_count=int(row.get('pr_count') or 0) if isinstance(row.get('pr_count'), (int, float)) else 0,
                commit_count=int(row.get('commit_count') or 0) if isinstance(row.get('commit_count'), (int, float)) else 0,
            )
            shaped.append((record, str(row.get('work_item_type') or '')))

        total_raw = len(shaped)
        # Drop absolute-floor noise
        filtered = [(r, wt) for r, wt in shaped if r.score >= self.SIMILAR_MIN_SCORE]
        dropped_low = total_raw - len(filtered)

        # Apply relative-gap drop — keep only items within SIMILAR_MAX_GAP
        # of the top score. This fights the "everything is 0.72-0.78" cluster
        # problem by forcing separation from the best match.
        if filtered:
            top_score = max(r.score for r, _ in filtered)
            gap_cut = top_score - self.SIMILAR_MAX_GAP
            filtered_gap = [(r, wt) for r, wt in filtered if r.score >= gap_cut]
            dropped_gap = len(filtered) - len(filtered_gap)
            filtered = filtered_gap
        else:
            top_score = 0.0
            dropped_gap = 0

        # Prefer same work_item_type when we have enough of them
        target_type = (item.work_item_type or '').strip()
        type_filtered = filtered
        used_type_filter = False
        if target_type:
            same_type = [(r, wt) for r, wt in filtered if wt and wt.strip().lower() == target_type.lower()]
            if len(same_type) >= self.TYPE_MATCH_MIN_COUNT:
                type_filtered = same_type
                used_type_filter = True

        # Classify into tiers by absolute score
        out: list[SimilarPastItem] = []
        for r, _ in type_filtered[:limit]:
            if r.score >= self.TIER_STRONG_SCORE:
                r.tier = 'strong'
            elif r.score >= self.TIER_RELATED_SCORE:
                r.tier = 'related'
            else:
                r.tier = 'weak'
            out.append(r)

        logger.info(
            'Refinement similar lookup for %s (type=%s): %d candidates, '
            'dropped_low_score=%d (<%.2f), dropped_gap=%d (gap>%.2f), '
            'type_filter=%s, returned=%d. Top: %s',
            item.id,
            target_type or '—',
            total_raw,
            dropped_low,
            self.SIMILAR_MIN_SCORE,
            dropped_gap,
            self.SIMILAR_MAX_GAP,
            used_type_filter,
            len(out),
            [f'#{x.external_id}={x.story_points}SP@{x.score:.2f}[{x.tier}]' for x in out[:5]],
        )
        return out

    @staticmethod
    def _format_similar_past_for_prompt(items: list[SimilarPastItem], is_turkish: bool) -> str:
        if not items:
            return ''
        header = (
            'Benzer Tamamlanmis Isler (Gecmis SP Referansi):'
            if is_turkish
            else 'Similar Completed Items (Historical SP Reference):'
        )
        def _tier_label(tier: str) -> str:
            if is_turkish:
                return {'strong': 'ÇOK YAKIN', 'related': 'yakın', 'weak': 'uzak'}.get(tier, 'yakın')
            return {'strong': 'VERY CLOSE', 'related': 'close', 'weak': 'loose'}.get(tier, 'close')

        lines = [header]
        strong_count = sum(1 for it in items if it.tier == 'strong')
        if strong_count == 0:
            lines.append(
                '  (Not: yüksek güvenli eşleşme yok — aşağıdaki işler gevşek benzer, tahminini ihtiyatlı yap.)'
                if is_turkish else
                '  (Note: no high-confidence match — the items below are loosely related, hedge your estimate.)'
            )
        for i, it in enumerate(items, 1):
            who = it.assigned_to or ('-' if is_turkish else 'unknown')
            tag = _tier_label(it.tier)
            lines.append(
                f'  {i}. [{it.story_points} SP · {tag}] #{it.external_id} {it.title} (yapan: {who})'
                if is_turkish
                else f'  {i}. [{it.story_points} SP · {tag}] #{it.external_id} {it.title} (assignee: {who})'
            )
            if it.pr_titles:
                pr_line = '     PRs: ' + ' | '.join(it.pr_titles[:3])
                lines.append(pr_line[:240])
            elif it.branches:
                lines.append('     Branches: ' + ', '.join(it.branches[:3]))
            if it.pr_count or it.commit_count:
                lines.append(
                    f'     ({it.pr_count} PR, {it.commit_count} commit)'
                    if is_turkish else
                    f'     ({it.pr_count} PRs, {it.commit_count} commits)'
                )
        trailer = (
            'Bu benzer islerin SP dagilimina dayanarak puan oner; aciklamanda '
            'hangi isle benzestigini ve neden bu puani sectigini kisa anlat.'
            if is_turkish
            else 'Base your SP suggestion on the distribution of these similar items; '
                 'briefly mention which one(s) it resembles and why in your rationale.'
        )
        lines.append('')
        lines.append(trailer)
        return '\n'.join(lines)

    async def list_items(
        self,
        organization_id: int,
        *,
        provider: str,
        project: str | None = None,
        team: str | None = None,
        sprint_path: str | None = None,
        sprint_name: str | None = None,
        board_id: str | None = None,
        sprint_id: str | None = None,
    ) -> RefinementItemsResponse:
        provider_key = (provider or '').strip().lower()
        items, resolved_name, resolved_ref = await self._fetch_items(
            organization_id=organization_id,
            provider=provider_key,
            project=project,
            team=team,
            sprint_path=sprint_path,
            sprint_name=sprint_name,
            board_id=board_id,
            sprint_id=sprint_id,
        )
        history_map = await self._load_item_history_map(
            organization_id=organization_id,
            provider=provider_key,
            item_ids=[item.id for item in items],
        )
        for item in items:
            hist = history_map.get(item.id, {})
            item.refined_before = bool(hist.get('refinement_count', 0))
            item.refinement_count = int(hist.get('refinement_count', 0))
            item.last_refined_at = hist.get('last_refined_at')
            item.last_refinement_comment = hist.get('last_refinement_comment')
            item.last_suggested_story_points = hist.get('last_suggested_story_points')
            item.last_writeback_at = hist.get('last_writeback_at')
        pointed = sum(1 for item in items if self._has_estimate(item))
        return RefinementItemsResponse(
            provider=provider_key,  # type: ignore[arg-type]
            sprint_name=resolved_name,
            sprint_ref=resolved_ref,
            items=items,
            unestimated_count=max(0, len(items) - pointed),
            pointed_count=pointed,
        )

    async def analyze(
        self,
        organization_id: int,
        user_id: int,
        request: RefinementAnalyzeRequest,
    ) -> RefinementAnalyzeResponse:
        started_at = datetime.utcnow()
        started_clock = time.perf_counter()
        usage_service = AIUsageEventService(self.db)

        items_response = await self.list_items(
            organization_id,
            provider=request.provider,
            project=request.project,
            team=request.team,
            sprint_path=request.sprint_path,
            sprint_name=request.sprint_name,
            board_id=request.board_id,
            sprint_id=request.sprint_id,
        )
        selected = self._select_target_items(items_response.items, request.item_ids, request.max_items)

        raw_provider = (request.agent_provider or '').strip().lower()
        use_cli = raw_provider in ('claude_cli', 'codex_cli')

        if use_cli:
            agent_provider = raw_provider
            agent_model = (request.agent_model or 'sonnet').strip()
        else:
            agent_provider, agent_model, llm = await self._resolve_llm(
                organization_id=organization_id,
                user_id=user_id,
                explicit_provider=request.agent_provider,
                explicit_model=request.agent_model,
            )

        total_usage = {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0}
        results: list[RefinementSuggestion] = []

        if selected:
            # Load prompts from DB (Prompt Studio editable) with YAML fallback.
            # When the user picked a repo for this sprint we ask the LLM for
            # a `file_changes` array; otherwise we skip code-aware to avoid
            # hallucinated paths against a repo we don't know about.
            code_aware = request.repo_mapping_id is not None
            system_tpl, desc_tpl, expected_tpl, agent_cfg = await self._load_prompt_config_from_db(
                code_aware=code_aware,
            )
            point_scale = self._normalize_point_scale(request.point_scale)

            if not use_cli:
                runner = CrewAIAgentRunner(llm)

            for item in selected:
                try:
                    similar_past = await self._fetch_similar_past(
                        organization_id,
                        item,
                        limit=5,
                        skip_external_id=item.id,
                    )
                    similar_past_prompt = self._format_similar_past_for_prompt(
                        similar_past,
                        is_turkish=self._is_turkish(request.language),
                    )
                    prompt_vars = self._build_prompt_vars(
                        provider=request.provider,
                        sprint_name=items_response.sprint_name,
                        language=request.language,
                        point_scale=point_scale,
                        item=item,
                        similar_past_block=similar_past_prompt,
                    )

                    # Pull discussion comments and append them to the
                    # description so the LLM sees clarifications, follow-up
                    # questions and acceptance-criteria tweaks made AFTER
                    # the original ticket body. Without this the model only
                    # sees the description text and misses every "ah but
                    # actually it should also..." comment that comes later.
                    raw_comments: list[dict[str, Any]] = []
                    try:
                        raw_comments = await self._fetch_comments_raw(
                            organization_id=organization_id,
                            provider=request.provider,
                            project=request.project,
                            external_id=item.id,
                        )
                        discussion_block = self._format_discussion_block(raw_comments)
                        if discussion_block:
                            prompt_vars['description'] = (
                                f"{prompt_vars.get('description') or ''}\n\n{discussion_block}".strip()
                            )
                    except Exception as exc:
                        logger.info('Discussion fetch skipped for item %s: %s', item.id, exc)

                    # Pull non-image attachments (PDF / DOCX / XLSX /
                    # plain text) via the work-item AttachedFile relations
                    # and append the extracted text to the description.
                    # Inline screenshots are still handled by the image
                    # path below — this covers files a PM staples on the
                    # work item that the description only references.
                    if request.provider == 'azure':
                        try:
                            _azcfg_doc = await self.integration_service.get_config(organization_id, 'azure')
                            if _azcfg_doc and _azcfg_doc.secret:
                                _docs = await self.azure_client.fetch_work_item_attachments(
                                    item.id,
                                    cfg={
                                        'org_url': _azcfg_doc.base_url or '',
                                        'pat': _azcfg_doc.secret,
                                    },
                                    max_files=4,
                                )
                                _doc_block = _extract_attachments_text(_docs)
                                if _doc_block:
                                    prompt_vars['description'] = (
                                        f"{prompt_vars.get('description') or ''}\n\n{_doc_block}".strip()
                                    )
                                    logger.info(
                                        'Refinement: injected %d attachment(s) into prompt for item %s',
                                        len(_docs), item.id,
                                    )
                        except Exception as exc:
                            logger.info('Attachment text fetch skipped for item %s: %s', item.id, exc)

                    # Pull image attachments. Description first; then walk
                    # comment HTML too — Azure work-item comments are HTML
                    # so a screenshot dropped into a comment lands here as
                    # well. Both API providers (data URLs) and CLI providers
                    # (file path @-references) work — the model just needs
                    # the bytes.
                    item_images_data_urls: list[str] = []
                    item_image_paths: list[str] = []
                    if request.provider == 'azure':
                        try:
                            azure_cfg_for_img = await self.integration_service.get_config(organization_id, 'azure')
                            if azure_cfg_for_img and azure_cfg_for_img.secret:
                                # Concat description + each comment body so
                                # one regex pass picks up <img> tags from
                                # both surfaces.
                                comment_html_chunks = [
                                    str(c.get('text') or '') for c in raw_comments if c.get('text')
                                ]
                                combined_html = (item.description or '') + '\n\n' + '\n\n'.join(comment_html_chunks)
                                if combined_html.strip():
                                    fetched = await self.azure_client.fetch_description_images(
                                        combined_html,
                                        cfg={
                                            'org_url': azure_cfg_for_img.base_url or '',
                                            'pat': azure_cfg_for_img.secret,
                                        },
                                        max_images=6,
                                    )
                                    if fetched:
                                        item_images_data_urls, item_image_paths = self._materialize_images_for_llm(
                                            fetched, item.id,
                                        )
                        except Exception as exc:
                            logger.info('Image fetch skipped for item %s: %s', item.id, exc)
                    elif request.provider == 'jira':
                        # Jira stores screenshots as ADF media nodes, not
                        # <img> tags, so the description string we hold
                        # has no image markers. fetch_issue_images asks
                        # Jira for the *rendered* HTML (description +
                        # comments), pulls every <img src=...> and Basic-
                        # auths the binary back so the multimodal model
                        # gets the same screenshots a human reviewer sees.
                        try:
                            jira_cfg_for_img = await self.integration_service.get_config(organization_id, 'jira')
                            if jira_cfg_for_img and jira_cfg_for_img.secret:
                                fetched = await self.jira_client.fetch_issue_images(
                                    item.id,
                                    cfg={
                                        'base_url': jira_cfg_for_img.base_url or '',
                                        'email': (jira_cfg_for_img.extra_config or {}).get('email') or '',
                                        'api_token': jira_cfg_for_img.secret,
                                    },
                                    max_images=6,
                                )
                                if fetched:
                                    item_images_data_urls, item_image_paths = self._materialize_images_for_llm(
                                        fetched, item.id,
                                    )
                        except Exception as exc:
                            logger.info('Jira image fetch skipped for item %s: %s', item.id, exc)

                    if use_cli:
                        # Run via CLI bridge instead of LLM API
                        full_prompt = (
                            self._format_template(system_tpl, prompt_vars) + '\n\n'
                            + self._format_template(desc_tpl, prompt_vars) + '\n\n'
                            + 'Expected output format:\n' + self._format_template(expected_tpl, prompt_vars)
                        )
                        if item_image_paths:
                            attach_block = '\n'.join(f'  - {p}' for p in item_image_paths)
                            full_prompt += (
                                '\n\nATTACHED SCREENSHOTS — read each one with the Read tool '
                                'before answering. They were attached to the work item and may '
                                'contain context the description does not.\n' + attach_block
                            )
                        content = await self._run_cli_refinement(
                            agent_provider, agent_model, full_prompt,
                            organization_id=organization_id,
                            repo_mapping_id=request.repo_mapping_id,
                        )
                        usage = {'prompt_tokens': len(full_prompt) // 4, 'completion_tokens': len(content) // 4, 'total_tokens': (len(full_prompt) + len(content)) // 4}
                        structured = None
                        model = agent_model
                    else:
                        content, usage, model, structured = await runner.run_configured_task(
                            role=str(agent_cfg.get('role') or 'Sprint Refinement Analyst'),
                            goal=str(agent_cfg.get('goal') or 'Refine and estimate backlog items.'),
                            backstory=str(agent_cfg.get('backstory') or ''),
                            system_prompt=self._format_template(system_tpl, prompt_vars),
                            user_prompt=self._format_template(desc_tpl, prompt_vars),
                            expected_output=self._format_template(expected_tpl, prompt_vars),
                            complexity_hint='normal',
                            max_output_tokens=4000,
                            structured_output=_RefinementStructuredOutput,
                            reasoning=False,
                            skip_cache=True,
                            image_inputs=item_images_data_urls or None,
                        )

                    total_usage = self._merge_usage(total_usage, usage)
                    # Convert structured Pydantic model to dict if needed
                    if structured is not None:
                        payload = structured.model_dump() if hasattr(structured, 'model_dump') else (structured.dict() if hasattr(structured, 'dict') else dict(structured))
                    else:
                        payload = self._extract_json_dict(content) or {}
                    # Debug: log raw payload to understand scoring issues
                    raw_fc_for_log = payload.get('file_changes')
                    logger.info(
                        'Refinement item %s raw payload: suggested_story_points=%r (type=%s), '
                        'confidence=%r, structured_type=%s, file_changes_count=%d, file_changes_first=%r',
                        item.id,
                        payload.get('suggested_story_points'),
                        type(payload.get('suggested_story_points')).__name__,
                        payload.get('confidence'),
                        type(structured).__name__ if structured else 'dict',
                        len(raw_fc_for_log) if isinstance(raw_fc_for_log, list) else -1,
                        (raw_fc_for_log[0] if isinstance(raw_fc_for_log, list) and raw_fc_for_log else None),
                    )
                    # Pull file_changes from the structured output and run
                    # git authorship over them so the suggestion can name
                    # who's worked there recently. Skipped when no repo
                    # was picked for this sprint — without a repo to scan,
                    # the LLM has no real paths to emit.
                    fc_paths: list[str] = []
                    raw_changes = payload.get('file_changes') or []
                    if code_aware and isinstance(raw_changes, list):
                        for entry in raw_changes:
                            if isinstance(entry, dict):
                                fc = str(entry.get('file') or '').strip()
                            else:
                                fc = str(entry).strip()
                            if fc:
                                fc_paths.append(fc)
                    if code_aware:
                        from agena_services.services.code_authorship import (
                            resolve_authorship_for_files as _resolve_authorship,
                        )
                        touched_files, recommended_authors = await _resolve_authorship(
                            self.db, organization_id, fc_paths, user_id=user_id,
                            repo_mapping_id=request.repo_mapping_id,
                        )
                    else:
                        touched_files, recommended_authors = [], []
                    logger.info(
                        'Refinement item %s authorship: code_aware=%s, repo_mapping_id=%s, '
                        'fc_paths=%d, touched=%d (with_repo=%d), authors=%d',
                        item.id,
                        code_aware,
                        request.repo_mapping_id,
                        len(fc_paths),
                        len(touched_files),
                        sum(1 for tf in touched_files if tf.repo_mapping_id),
                        len(recommended_authors),
                    )
                    # Reason text per touched-file: prefer LLM-provided
                    # description; fall back to the action.
                    if touched_files and isinstance(raw_changes, list):
                        reason_by_path: dict[str, str] = {}
                        for entry in raw_changes:
                            if isinstance(entry, dict):
                                key = str(entry.get('file') or '').strip()
                                desc = str(entry.get('description') or entry.get('reason') or '').strip()
                                action = str(entry.get('action') or 'modify').strip()
                                if key:
                                    reason_by_path[key] = desc
                                    reason_by_path.setdefault(key.lstrip('/'), desc)
                        for tf in touched_files:
                            if not tf.reason:
                                tf.reason = reason_by_path.get(tf.file, '') or reason_by_path.get(tf.file.lstrip('/'), '')
                    results.append(
                        self._to_suggestion(
                            item,
                            payload,
                            model=model,
                            provider=agent_provider,
                            language=request.language,
                            similar_items=similar_past,
                            touched_files=touched_files,
                            recommended_authors=recommended_authors,
                        )
                    )
                except Exception as exc:
                    results.append(
                        RefinementSuggestion(
                            item_id=item.id,
                            title=item.title,
                            current_story_points=self._current_estimate(item),
                            error=str(exc)[:300],
                            provider=agent_provider,
                            model=agent_model,
                        )
                    )

        estimated_cost_usd = self.cost_tracker.estimate_cost_usd(
            prompt_tokens=total_usage['prompt_tokens'],
            completion_tokens=total_usage['completion_tokens'],
            model=agent_model,
        ) if total_usage['total_tokens'] > 0 else 0.0

        ended_at = datetime.utcnow()
        duration_ms = int((time.perf_counter() - started_clock) * 1000)
        status = 'completed' if all(not r.error for r in results) else ('partial' if results else 'completed')
        await usage_service.create_event(
            organization_id=organization_id,
            user_id=user_id,
            task_id=None,
            operation_type='sprint_refinement',
            provider=agent_provider,
            model=agent_model,
            status=status,
            prompt_tokens=total_usage['prompt_tokens'],
            completion_tokens=total_usage['completion_tokens'],
            total_tokens=total_usage['total_tokens'],
            cost_usd=estimated_cost_usd,
            started_at=started_at,
            ended_at=ended_at,
            duration_ms=duration_ms,
            details_json={
                'source_provider': request.provider,
                'sprint_name': items_response.sprint_name,
                'sprint_ref': items_response.sprint_ref,
                'selected_count': len(selected),
                'total_items': len(items_response.items),
                'language': request.language,
            },
        )
        await self._save_analysis_history(
            organization_id=organization_id,
            user_id=user_id,
            provider=request.provider,
            sprint_ref=items_response.sprint_ref,
            sprint_name=items_response.sprint_name,
            results=results,
        )

        return RefinementAnalyzeResponse(
            provider=request.provider,
            sprint_name=items_response.sprint_name,
            sprint_ref=items_response.sprint_ref,
            language=request.language,
            agent_provider=agent_provider,
            agent_model=agent_model,
            analyzed_count=len(results),
            skipped_count=max(0, items_response.unestimated_count - len(selected)),
            total_items=len(items_response.items),
            total_tokens=total_usage['total_tokens'],
            estimated_cost_usd=estimated_cost_usd,
            results=results,
        )

    async def writeback(
        self,
        organization_id: int,
        request: RefinementWritebackRequest,
    ) -> RefinementWritebackResponse:
        provider = request.provider.strip().lower()
        items = [item for item in request.items if item.item_id.strip()]
        if not items:
            raise ValueError('No refinement items provided for writeback')

        signature = str(request.comment_signature or '').strip()
        results: list[RefinementWritebackResult] = []

        if provider == 'azure':
            config = await self.integration_service.get_config(organization_id, 'azure')
            if config is None or not config.secret:
                raise ValueError('Azure integration is not configured')
            cfg = {
                'org_url': config.base_url,
                'project': request.project or '',
                'pat': config.secret,
            }
            for item in items:
                comment = self._with_signature(item.comment, signature)
                assignee = (item.assignee_unique_name or '').strip()
                try:
                    await self.azure_client.writeback_refinement(
                        cfg=cfg,
                        work_item_id=item.item_id,
                        suggested_story_points=item.suggested_story_points,
                        comment=comment,
                        assignee_upn=assignee or None,
                    )
                    msg = 'ok' + (f' + assigned {assignee}' if assignee else '')
                    results.append(RefinementWritebackResult(item_id=item.item_id, success=True, message=msg))
                except Exception as exc:
                    results.append(RefinementWritebackResult(item_id=item.item_id, success=False, message=str(exc)[:220]))
                await self._save_writeback_history(
                    organization_id=organization_id,
                    user_id=None,
                    provider='azure',
                    sprint_ref=request.sprint_path or request.sprint_name or '',
                    sprint_name=request.sprint_name or '',
                    item_id=item.item_id,
                    suggested_story_points=int(item.suggested_story_points or 0),
                    comment=comment,
                    signature=signature,
                    success=results[-1].success,
                    error_message=results[-1].message if not results[-1].success else '',
                )
        elif provider == 'jira':
            config = await self.integration_service.get_config(organization_id, 'jira')
            if config is None or not config.secret:
                raise ValueError('Jira integration is not configured')
            cfg = {
                'base_url': config.base_url,
                'email': config.username or '',
                'api_token': config.secret,
            }
            for item in items:
                comment = self._with_signature(item.comment, signature)
                assignee = (item.assignee_unique_name or '').strip()
                try:
                    await self.jira_client.writeback_refinement(
                        cfg=cfg,
                        issue_key=item.item_id,
                        suggested_story_points=item.suggested_story_points,
                        comment=comment,
                        board_id=request.board_id or '',
                        assignee_email=assignee or None,
                    )
                    msg = 'ok' + (f' + assigned {assignee}' if assignee else '')
                    results.append(RefinementWritebackResult(item_id=item.item_id, success=True, message=msg))
                except Exception as exc:
                    results.append(RefinementWritebackResult(item_id=item.item_id, success=False, message=str(exc)[:220]))
                await self._save_writeback_history(
                    organization_id=organization_id,
                    user_id=None,
                    provider='jira',
                    sprint_ref=request.sprint_id or request.sprint_name or '',
                    sprint_name=request.sprint_name or '',
                    item_id=item.item_id,
                    suggested_story_points=int(item.suggested_story_points or 0),
                    comment=comment,
                    signature=signature,
                    success=results[-1].success,
                    error_message=results[-1].message if not results[-1].success else '',
                )
        else:
            raise ValueError(f'Unsupported provider: {request.provider}')

        success_count = sum(1 for row in results if row.success)
        failure_count = len(results) - success_count
        return RefinementWritebackResponse(
            provider=request.provider,
            total=len(results),
            success_count=success_count,
            failure_count=failure_count,
            results=results,
        )

    async def _fetch_items(
        self,
        *,
        organization_id: int,
        provider: str,
        project: str | None,
        team: str | None,
        sprint_path: str | None,
        sprint_name: str | None,
        board_id: str | None,
        sprint_id: str | None,
    ) -> tuple[list[ExternalTask], str, str]:
        provider_key = (provider or '').strip().lower()
        if provider_key == 'azure':
            config = await self.integration_service.get_config(organization_id, 'azure')
            if config is None or not config.secret:
                raise ValueError('Azure integration is not configured')
            normalized_project = (project or config.project or '').strip()
            normalized_sprint = (sprint_path or '').strip()
            if not normalized_project or not normalized_sprint:
                raise ValueError('Azure project and sprint are required')
            items = await self.azure_client.fetch_sprint_work_items(
                {
                    'org_url': config.base_url,
                    'project': normalized_project,
                    'pat': config.secret,
                    'team': (team or '').strip(),
                    'sprint_path': normalized_sprint,
                }
            )
            for item in items:
                item.sprint_name = sprint_name or normalized_sprint.split('\\')[-1]
                item.sprint_path = item.sprint_path or normalized_sprint
            return items, (sprint_name or normalized_sprint.split('\\')[-1]), normalized_sprint

        if provider_key == 'jira':
            config = await self.integration_service.get_config(organization_id, 'jira')
            if config is None or not config.secret:
                raise ValueError('Jira integration is not configured')
            normalized_board = (board_id or '').strip()
            normalized_sprint_id = (sprint_id or '').strip()
            if not normalized_board or not normalized_sprint_id:
                raise ValueError('Jira board and sprint are required')
            items = await self.jira_client.fetch_sprint_work_items(
                {
                    'base_url': config.base_url,
                    'email': config.username or '',
                    'api_token': config.secret,
                },
                board_id=normalized_board,
                sprint_id=normalized_sprint_id,
            )
            resolved_name = (sprint_name or normalized_sprint_id).strip()
            for item in items:
                item.sprint_name = resolved_name
                item.sprint_id = item.sprint_id or normalized_sprint_id
            return items, resolved_name, normalized_sprint_id

        raise ValueError(f'Unsupported provider: {provider}')

    async def _run_cli_refinement(
        self,
        cli_provider: str,
        model: str,
        prompt: str,
        organization_id: int | None = None,
        repo_mapping_id: int | None = None,
    ) -> str:
        """Run refinement prompt through CLI bridge (claude or codex) in
        analysis-only mode: the bridge restricts tools to Read/Grep/Glob
        + git bash so the CLI can scan the repo without touching it.

        When `repo_mapping_id` is set, the CLI is opened on THAT repo's
        checkout — that's the user's "this sprint targets repo X" pick.
        Without it we fall back to /tmp (no real code to grep, but the
        prompt is upstream-skipped from emitting `file_changes` anyway).
        """
        import os
        import httpx

        bridge_url = os.getenv('CLI_BRIDGE_URL', 'http://cli-bridge:9876')
        cli = 'claude' if cli_provider == 'claude_cli' else 'codex'

        repo_path = '/tmp'
        if organization_id is not None and repo_mapping_id is not None:
            try:
                from agena_models.models.repo_mapping import RepoMapping
                from sqlalchemy import select as _sel
                row = (await self.db.execute(
                    _sel(RepoMapping).where(
                        RepoMapping.id == repo_mapping_id,
                        RepoMapping.organization_id == organization_id,
                        RepoMapping.is_active.is_(True),
                    )
                )).scalar_one_or_none()
                if row is not None:
                    p = (row.local_repo_path or '').strip()
                    if p:
                        repo_path = p
            except Exception:
                pass

        try:
            async with httpx.AsyncClient(timeout=300) as client:
                resp = await client.post(
                    f'{bridge_url}/{cli}',
                    json={
                        'repo_path': repo_path,
                        'prompt': prompt,
                        'model': model or '',
                        'timeout': 240,
                        # Bridge enforces read-only tools (Claude:
                        # --allowedTools, Codex: --sandbox read-only)
                        'read_only': True,
                    },
                )
                data = resp.json()
        except httpx.ConnectError:
            raise RuntimeError(f'CLI bridge unreachable at {bridge_url} — is the cli-bridge service running?')
        except httpx.TimeoutException:
            raise RuntimeError(f'CLI bridge request timed out (300s)')
        except (httpx.RequestError, ValueError) as exc:
            raise RuntimeError(f'CLI bridge request failed: {exc}')

        if data.get('status') != 'ok':
            raise RuntimeError(f'{cli} bridge error: {data.get("message", data.get("stderr", "unknown"))}')

        content = (data.get('stdout') or '').strip()
        if not content:
            raise RuntimeError(f'{cli} bridge returned empty output')
        return content

    async def _resolve_llm(
        self,
        *,
        organization_id: int,
        user_id: int,
        explicit_provider: str | None,
        explicit_model: str | None,
    ) -> tuple[str, str, LLMProvider | HalProvider]:
        pref_provider, pref_model = await self._get_user_preferred_agent_selection(user_id)
        provider = (explicit_provider or pref_provider or 'openai').strip().lower()
        # Map CLI providers to their API equivalents for refinement
        if provider == 'claude_cli':
            provider = 'anthropic'
        elif provider == 'codex_cli':
            provider = 'openai'
        if provider not in {'openai', 'gemini', 'anthropic', 'hal'}:
            provider = 'openai'

        if provider == 'hal':
            integration = await self.integration_service.get_config(organization_id, 'hal')
            if not integration:
                raise ValueError('HAL integration is not configured')
            extra = integration.extra_config or {}
            hal = HalProvider(
                organization_id=organization_id,
                base_url=integration.base_url or '',
                login_endpoint=extra.get('login_url', '/auth/login'),
                chat_endpoint=extra.get('chat_url', '/api/chat'),
                username=integration.username or '',
                password=integration.secret,
            )
            return 'hal', 'hal', hal

        model = (explicit_model or pref_model or self.settings.llm_large_model or 'gpt-4.1').strip()

        integration = await self.integration_service.get_config(organization_id, provider)
        api_key = ((integration.secret if integration else '') or '').strip()
        base_url = ((integration.base_url if integration else '') or '').strip()

        if provider == 'openai':
            api_key = api_key or (self.settings.openai_api_key or '').strip()
            base_url = base_url or (self.settings.openai_base_url or '').strip()
        elif provider == 'anthropic':
            if not api_key:
                integration = await self.integration_service.get_config(organization_id, 'anthropic')
                api_key = ((integration.secret if integration else '') or '').strip()
            api_key = api_key or (getattr(self.settings, 'anthropic_api_key', '') or '').strip()
            if not base_url:
                base_url = 'https://api.anthropic.com'
        elif provider == 'gemini' and not base_url:
            base_url = 'https://generativelanguage.googleapis.com'

        if not api_key:
            raise ValueError(f'{provider} integration is not configured for refinement')

        llm = LLMProvider(
            provider=provider,
            api_key=api_key,
            base_url=base_url,
            small_model=model,
            large_model=model,
        )
        return provider, model, llm

    async def _get_user_preferred_agent_selection(self, user_id: int) -> tuple[str | None, str | None]:
        result = await self.db.execute(select(UserPreference).where(UserPreference.user_id == user_id))
        pref = result.scalar_one_or_none()
        if pref is None or not pref.profile_settings_json:
            return None, None
        try:
            settings = json.loads(pref.profile_settings_json)
        except Exception:
            return None, None
        if not isinstance(settings, dict):
            return None, None
        provider = settings.get('preferred_provider')
        model = settings.get('preferred_model')
        return (
            str(provider).strip() or None if isinstance(provider, str) else None,
            str(model).strip() or None if isinstance(model, str) else None,
        )

    def _select_target_items(self, items: list[ExternalTask], item_ids: list[str], max_items: int) -> list[ExternalTask]:
        selected_ids = {str(item_id).strip() for item_id in item_ids if str(item_id).strip()}
        pool = [item for item in items if not self._has_estimate(item)]
        if selected_ids:
            pool = [item for item in pool if item.id in selected_ids]
        limit = max(1, min(int(max_items or 1), 20))
        return pool[:limit]

    async def _load_prompt_config_from_db(
        self,
        *,
        code_aware: bool = False,
    ) -> tuple[str, str, str, dict[str, Any]]:
        """Load refinement prompts from PromptService (DB) with YAML fallback."""
        from agena_services.services.prompt_service import PromptService

        # Try DB first (Prompt Studio editable)
        try:
            system_tpl = await PromptService.get(self.db, 'refinement_system_prompt')
        except ValueError:
            system_tpl = ''
        try:
            desc_tpl = await PromptService.get(self.db, 'refinement_description_prompt')
        except ValueError:
            desc_tpl = ''
        try:
            expected_tpl = await PromptService.get(self.db, 'refinement_expected_output')
        except ValueError:
            expected_tpl = ''

        # Fallback to hardcoded defaults if DB prompts are empty
        if not system_tpl or not desc_tpl or not expected_tpl:
            from agena_agents.agents.prompts import (
                REFINEMENT_SYSTEM_PROMPT,
                REFINEMENT_DESCRIPTION_PROMPT,
                REFINEMENT_EXPECTED_OUTPUT,
            )
            if not system_tpl:
                system_tpl = REFINEMENT_SYSTEM_PROMPT
            if not desc_tpl:
                desc_tpl = REFINEMENT_DESCRIPTION_PROMPT
            if not expected_tpl:
                expected_tpl = REFINEMENT_EXPECTED_OUTPUT

        # Older DB-saved prompts (from Prompt Studio) may not contain the
        # {similar_past_items} placeholder. Append a grounding block so the
        # retrieved similar items and their prior SPs always reach the LLM,
        # regardless of whether the admin edited the template.
        if '{similar_past_items}' not in desc_tpl:
            desc_tpl = desc_tpl.rstrip() + (
                '\n\n'
                '--- SIMILAR PAST WORK (from your team\'s Qdrant index) ---\n'
                '{similar_past_items}\n'
                '--- END SIMILAR ---\n\n'
                'If similar past items are listed above, ANCHOR your SP on their distribution '
                'and NAME the closest one(s) + who worked on them in the rationale. '
                'If the block says none, say so explicitly in the rationale.'
            )
        if 'similar' not in expected_tpl.lower():
            expected_tpl = expected_tpl.rstrip() + (
                '\n\n'
                'IMPORTANT: The "estimation_rationale" MUST explicitly reference the closest similar '
                'past item(s) by ID/title and their previous assignee when any are provided above, '
                'e.g.: "En yakın: #12345 (Ali, 3 SP) ve #67890 (Ayşe, 5 SP). Bu iş X\'e daha yakın, '
                'o yüzden Y SP önerildi." If no similar items were provided, state that no history '
                'was found and estimate from scratch.'
            )
        # Code-aware directive: only when the user picked a repo for this
        # sprint do we ask for file_changes — without a repo to scan the
        # LLM would just hallucinate paths. Curly braces in the example
        # are doubled so `_format_template`'s `.format_map()` treats them
        # as literals.
        if code_aware and 'file_changes' not in expected_tpl:
            expected_tpl = expected_tpl.rstrip() + (
                '\n\n'
                'ALSO INCLUDE in the JSON output a "file_changes" array. Each entry is '
                '{{"file": "relative/path.ext", "action": "modify"|"create"|"delete", '
                '"description": "what would change in this file"}}. List only files you '
                'actually need to touch — do NOT invent paths. If the repo source is not '
                'available, leave file_changes empty. Refinement is analysis-only: '
                'never output code blocks; only describe the changes.'
            )

        agent_cfg = {
            'role': 'Sprint Refinement Analyst',
            'goal': 'Review backlog items that are still unestimated, remove ambiguity, and recommend the most defensible Fibonacci story point.',
            'backstory': 'You are a senior delivery lead who refines sprint scope before engineering starts. You do not invent hidden requirements. You work only from the work item content, you keep comments concise, and you reduce confidence when the item is underspecified.',
        }
        return system_tpl, desc_tpl, expected_tpl, agent_cfg

    def _build_prompt_vars(
        self,
        *,
        provider: str,
        sprint_name: str,
        language: str,
        point_scale: str,
        item: ExternalTask,
        similar_past_block: str = '',
    ) -> dict[str, Any]:
        return {
            'provider': provider,
            'sprint_name': sprint_name,
            'language': language.strip() or 'Turkish',
            'point_scale': point_scale,
            'item_id': item.id,
            'work_item_type': item.work_item_type or 'Task',
            'title': item.title,
            'state': item.state or '',
            'current_story_points': self._display_number(item.story_points),
            'current_effort': self._display_number(item.effort),
            'assigned_to': item.assigned_to or '',
            'description': self._normalize_description(item.description),
            'similar_past_items': similar_past_block,
        }

    @staticmethod
    def _safe_int(value: Any, default: int = 0) -> int:
        """Safely parse a value to int, handling LLM returning text like 'düşük' instead of numbers."""
        if value is None:
            return default
        if isinstance(value, (int, float)):
            return int(value)
        s = str(value).strip()
        # Try direct parse
        try:
            return int(s)
        except (ValueError, TypeError):
            pass
        # Try extracting first number from string like "3 points" or "~5"
        import re
        match = re.search(r'\d+', s)
        if match:
            return int(match.group())
        return default

    def _to_suggestion(
        self,
        item: ExternalTask,
        payload: dict[str, Any],
        *,
        model: str,
        provider: str,
        language: str,
        similar_items: list[SimilarPastItem] | None = None,
        touched_files: list['TouchedFile'] | None = None,
        recommended_authors: list['RecommendedAuthor'] | None = None,
    ) -> RefinementSuggestion:
        point = self._safe_int(payload.get('suggested_story_points', 0))
        confidence = max(0, min(100, self._safe_int(payload.get('confidence', 0))))

        # If point is still 0, try to extract from rationale text (LLM sometimes puts it there)
        if point == 0:
            rationale_text = str(payload.get('estimation_rationale') or '')
            comment_text = str(payload.get('comment') or '')
            for text in [rationale_text, comment_text]:
                import re
                # Match patterns like "5 puan", "5 points", "5 pts", "score: 5", "= 5"
                match = re.search(r'(\d+)\s*(?:puan|point|pts|story\s*point)', text, re.IGNORECASE)
                if match:
                    extracted = int(match.group(1))
                    if 1 <= extracted <= 21:  # valid fibonacci range
                        point = extracted
                        break
                # Also try "X puan uygun" or "X is appropriate"
                match = re.search(r'(\d+)\s*(?:uygun|appropriate|suitable|recommend)', text, re.IGNORECASE)
                if match:
                    extracted = int(match.group(1))
                    if 1 <= extracted <= 21:
                        point = extracted
                        break
        summary = str(payload.get('summary') or '').strip()
        rationale = str(payload.get('estimation_rationale') or '').strip()
        comment = str(payload.get('comment') or '').strip()
        ambiguities = self._coerce_str_list(payload.get('ambiguities'))
        questions = self._coerce_str_list(payload.get('questions'))

        fallback_fields: list[str] = []
        tr = self._is_turkish(language)
        point_value = max(0, self._safe_int(point))

        if not summary:
            fallback_fields.append('summary')
            summary = (
                f'Is maddesi yorumu: {item.title}. Aciklama sinirli oldugu icin kisa ozet uretildi.'
                if tr
                else f'Item interpretation: {item.title}. A short summary was generated because the description is limited.'
            )
        if not rationale:
            fallback_fields.append('estimation_rationale')
            rationale = (
                (
                    f'{point_value} puan onerildi; kapsam ve belirsizlik seviyesine gore dengeli efor varsayildi.'
                    if point_value > 0
                    else 'Aciklama ve kabul kriterleri yetersiz oldugu icin puan 0 onerildi.'
                )
                if tr
                else (
                    f'{point_value} points suggested based on scope and uncertainty level.'
                    if point_value > 0
                    else 'A score of 0 was suggested due to insufficient description and acceptance details.'
                )
            )
        if not comment:
            fallback_fields.append('comment')
            ambiguity_hint = ambiguities[0] if ambiguities else ''
            question_hint = questions[0] if questions else ''
            if tr:
                details = []
                if ambiguity_hint:
                    details.append(f'Belirsizlik: {ambiguity_hint}')
                if question_hint:
                    details.append(f'Soru: {question_hint}')
                suffix = f" {' | '.join(details)}" if details else ''
                comment = f"Refinement notu: Onerilen puan {point_value}.{suffix}".strip()
            else:
                details = []
                if ambiguity_hint:
                    details.append(f'Ambiguity: {ambiguity_hint}')
                if question_hint:
                    details.append(f'Question: {question_hint}')
                suffix = f" {' | '.join(details)}" if details else ''
                comment = f"Refinement note: Suggested score is {point_value}.{suffix}".strip()

        if confidence == 0 and point_value > 0:
            confidence = 55
            fallback_fields.append('confidence')

        fallback_applied = bool(fallback_fields)
        fallback_note = ''
        if fallback_applied:
            fields_text = ', '.join(fallback_fields)
            fallback_note = (
                f'AI cikti eksikti; su alanlar otomatik tamamlandi: {fields_text}.'
                if tr
                else f'AI output was incomplete; these fields were auto-filled: {fields_text}.'
            )

        return RefinementSuggestion(
            item_id=item.id,
            title=item.title,
            item_url=item.web_url,
            current_story_points=self._current_estimate(item),
            suggested_story_points=point_value,
            estimation_rationale=rationale,
            confidence=confidence,
            summary=summary,
            comment=comment,
            ambiguities=ambiguities,
            questions=questions,
            ready_for_planning=bool(payload.get('ready_for_planning')),
            fallback_applied=fallback_applied,
            fallback_note=fallback_note,
            model=model,
            provider=provider,
            similar_items=similar_items or [],
            touched_files=touched_files or [],
            recommended_authors=recommended_authors or [],
        )

    def _is_turkish(self, language: str) -> bool:
        value = str(language or '').strip().lower()
        return value.startswith('tr') or 'turk' in value

    def _materialize_images_for_llm(
        self,
        fetched: list[tuple[str, bytes, str]],
        item_id: str,
    ) -> tuple[list[str], list[str]]:
        """Take the (filename, bytes, mime) list produced by
        AzureDevOpsClient.fetch_description_images and return two views:

          • data URLs — for API providers that take base64 inputs
            (\`data:image/png;base64,...\`)
          • on-disk paths — written under /tmp/agena-attachments/<item>/
            so the CLI bridge can hand them to claude/codex via @-refs

        Both are returned regardless of which transport the caller picks
        — the call site uses one of them depending on use_cli.
        """
        import base64 as _b64
        import os as _os
        import re as _re

        data_urls: list[str] = []
        paths: list[str] = []
        if not fetched:
            return data_urls, paths
        safe_id = _re.sub(r'[^A-Za-z0-9_-]', '_', str(item_id) or 'item')
        out_dir = f'/tmp/agena-attachments/{safe_id}'
        try:
            _os.makedirs(out_dir, exist_ok=True)
        except Exception as exc:
            logger.info('Could not create attachment dir %s: %s', out_dir, exc)
            out_dir = ''
        for idx, (name, blob, mime) in enumerate(fetched):
            try:
                b64 = _b64.b64encode(blob).decode('ascii')
                data_urls.append(f'data:{mime or "image/png"};base64,{b64}')
            except Exception as exc:
                logger.info('Failed to b64-encode image %s for item %s: %s', name, item_id, exc)
            if out_dir:
                safe_name = _re.sub(r'[^A-Za-z0-9._-]', '_', name) or f'attachment-{idx + 1}'
                fpath = f'{out_dir}/{safe_name}'
                try:
                    with open(fpath, 'wb') as fh:
                        fh.write(blob)
                    paths.append(fpath)
                except Exception as exc:
                    logger.info('Failed to write image %s: %s', fpath, exc)
        return data_urls, paths

    async def _fetch_comments_raw(
        self,
        *,
        organization_id: int,
        provider: str,
        project: str | None,
        external_id: str,
    ) -> list[dict[str, Any]]:
        """Fetch comments for a work item, newest-first, with raw text
        (HTML for Azure, plain text for Jira). Returns [] on missing config
        or network error so callers can no-op."""
        prov = (provider or '').strip().lower()
        try:
            if prov == 'azure' and (project or '').strip():
                cfg = await self.integration_service.get_config(organization_id, 'azure')
                if cfg and cfg.secret:
                    return await self.azure_client.fetch_work_item_comments(
                        cfg={'org_url': cfg.base_url or '', 'pat': cfg.secret},
                        project=project or '',
                        work_item_id=str(external_id),
                    )
            elif prov == 'jira':
                cfg = await self.integration_service.get_config(organization_id, 'jira')
                if cfg and cfg.secret:
                    return await self.jira_client.fetch_issue_comments(
                        cfg={
                            'base_url': cfg.base_url or '',
                            'email': (cfg.extra_config or {}).get('email') or '',
                            'api_token': cfg.secret,
                        },
                        issue_key=str(external_id),
                    )
        except Exception as exc:
            logger.info('Comment fetch failed (provider=%s id=%s): %s', prov, external_id, exc)
        return []

    def _format_discussion_block(self, comments: list[dict[str, Any]]) -> str:
        """Render a fetched comments list into a chronological Discussion
        markdown block. Newest-first input is flipped so the LLM reads the
        conversation in order. Empty string when no usable text remains."""
        if not comments:
            return ''
        ordered = list(reversed(comments))
        lines: list[str] = []
        for idx, c in enumerate(ordered, start=1):
            text = self._normalize_description(str(c.get('text') or ''))
            if not text:
                continue
            who = (c.get('created_by') or 'unknown').strip()
            when = str(c.get('created_at') or '')
            when_short = when[:19].replace('T', ' ') if when else ''
            header = f'### Comment {idx} — {who}'
            if when_short:
                header += f' ({when_short})'
            lines.append(f'{header}\n{text}')
        if not lines:
            return ''
        return f'---\n## Discussion ({len(lines)} comment{"" if len(lines) == 1 else "s"})\n' + '\n\n'.join(lines)

    def _normalize_description(self, value: str | None) -> str:
        raw = str(value or '').strip()
        if not raw:
            return ''
        normalized = re.sub(r'(?i)<br\s*/?>', '\n', raw)
        normalized = re.sub(r'(?i)</p\s*>', '\n\n', normalized)
        normalized = re.sub(r'(?is)<[^>]+>', ' ', normalized)
        normalized = html.unescape(normalized)
        normalized = re.sub(r'\r\n?', '\n', normalized)
        normalized = re.sub(r'\n{3,}', '\n\n', normalized)
        normalized = re.sub(r'[ \t]{2,}', ' ', normalized)
        return normalized.strip()[:8000]

    def _format_template(self, template: str, values: dict[str, Any]) -> str:
        return template.format_map(_SafeDict({k: '' if v is None else v for k, v in values.items()})).strip()

    def _normalize_point_scale(self, values: list[int]) -> str:
        normalized = [str(int(v)) for v in values if isinstance(v, int) and v > 0]
        if not normalized:
            normalized = ['1', '2', '3', '5', '8', '13']
        return ', '.join(normalized)

    def _display_number(self, value: float | None) -> str:
        if value is None:
            return 'none'
        if float(value).is_integer():
            return str(int(value))
        return str(round(float(value), 2))

    def _current_estimate(self, item: ExternalTask) -> float | None:
        if item.story_points is not None and item.story_points > 0:
            return item.story_points
        if item.effort is not None and item.effort > 0:
            return item.effort
        return None

    def _has_estimate(self, item: ExternalTask) -> bool:
        return self._current_estimate(item) is not None

    def _coerce_str_list(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        result: list[str] = []
        for row in value:
            text = str(row or '').strip()
            if text:
                result.append(text)
        return result[:8]

    def _merge_usage(self, current: dict[str, int], nxt: dict[str, int]) -> dict[str, int]:
        return {
            'prompt_tokens': int(current.get('prompt_tokens', 0)) + int(nxt.get('prompt_tokens', 0)),
            'completion_tokens': int(current.get('completion_tokens', 0)) + int(nxt.get('completion_tokens', 0)),
            'total_tokens': int(current.get('total_tokens', 0)) + int(nxt.get('total_tokens', 0)),
        }

    def _extract_json_dict(self, text: str) -> dict[str, Any] | None:
        src = (text or '').strip()
        if not src:
            return None
        try:
            parsed = json.loads(src)
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            pass
        start = src.find('{')
        end = src.rfind('}')
        if start >= 0 and end > start:
            try:
                parsed = json.loads(src[start:end + 1])
                return parsed if isinstance(parsed, dict) else None
            except Exception:
                return None
        return None

    def _with_signature(self, comment: str, signature: str) -> str:
        body = str(comment or '').strip()
        sig = str(signature or '').strip()
        if not body:
            return ''
        if not sig:
            return body
        return f'[{sig}] {body}'

    async def _load_item_history_map(
        self,
        *,
        organization_id: int,
        provider: str,
        item_ids: list[str],
    ) -> dict[str, dict[str, Any]]:
        ids = [str(item_id).strip() for item_id in item_ids if str(item_id).strip()]
        if not ids:
            return {}
        result = await self.db.execute(
            select(RefinementRecord)
            .where(
                RefinementRecord.organization_id == organization_id,
                RefinementRecord.provider == provider,
                RefinementRecord.external_item_id.in_(ids),
            )
            .order_by(RefinementRecord.created_at.desc())
        )
        rows = result.scalars().all()
        history: dict[str, dict[str, Any]] = {}
        for row in rows:
            current = history.setdefault(
                row.external_item_id,
                {
                    'refinement_count': 0,
                    'last_refined_at': None,
                    'last_refinement_comment': None,
                    'last_suggested_story_points': None,
                    'last_writeback_at': None,
                },
            )
            # Analysis runs feed the refined_before / count / latest-comment
            # display. Writeback rows feed the "already pushed to provider"
            # signal that drives the Yaz vs Sil button on the suggestion
            # card — without it the row reverts to "Yaz" on every reload.
            phase = (row.phase or '').lower()
            if phase == 'writeback':
                # Only "completed" writebacks count as still active. Rows
                # whose status was flipped to 'deleted' by the
                # delete-comment endpoint reflect the comment having been
                # removed from the provider — the row stays for audit but
                # the UI shouldn't show "Yazıldı" anymore.
                if (row.status or '') == 'completed' and current['last_writeback_at'] is None:
                    current['last_writeback_at'] = row.created_at.isoformat() if row.created_at else None
                continue
            current['refinement_count'] += 1
            if current['last_refined_at'] is None:
                current['last_refined_at'] = row.created_at.isoformat() if row.created_at else None
                current['last_refinement_comment'] = row.comment
                current['last_suggested_story_points'] = float(row.suggested_story_points) if row.suggested_story_points is not None else None
        return history

    async def _save_analysis_history(
        self,
        *,
        organization_id: int,
        user_id: int,
        provider: str,
        sprint_ref: str,
        sprint_name: str,
        results: list[RefinementSuggestion],
    ) -> None:
        for row in results:
            record = RefinementRecord(
                organization_id=organization_id,
                user_id=user_id,
                provider=provider,
                external_item_id=row.item_id,
                sprint_ref=sprint_ref or None,
                sprint_name=sprint_name or None,
                item_title=row.title,
                item_url=row.item_url,
                phase='analysis',
                status='failed' if row.error else 'completed',
                suggested_story_points=row.suggested_story_points,
                confidence=row.confidence,
                summary=row.summary,
                estimation_rationale=row.estimation_rationale,
                comment=row.comment,
                error_message=row.error,
            )
            self.db.add(record)
        await self.db.commit()

    async def _save_writeback_history(
        self,
        *,
        organization_id: int,
        user_id: int | None,
        provider: str,
        sprint_ref: str,
        sprint_name: str,
        item_id: str,
        suggested_story_points: int,
        comment: str,
        signature: str,
        success: bool,
        error_message: str,
    ) -> None:
        record = RefinementRecord(
            organization_id=organization_id,
            user_id=user_id,
            provider=provider,
            external_item_id=item_id,
            sprint_ref=sprint_ref or None,
            sprint_name=sprint_name or None,
            phase='writeback',
            status='completed' if success else 'failed',
            suggested_story_points=suggested_story_points,
            comment=comment,
            signature=signature or None,
            error_message=error_message or None,
        )
        self.db.add(record)
        await self.db.commit()
