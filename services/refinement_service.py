from __future__ import annotations

import html
import json
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agents.crewai_agents import CrewAIAgentRunner
from core.settings import get_settings
from integrations.azure_client import AzureDevOpsClient
from integrations.jira_client import JiraClient
from models.user_preference import UserPreference
from schemas.refinement import (
    RefinementAnalyzeRequest,
    RefinementAnalyzeResponse,
    RefinementItemsResponse,
    RefinementSuggestion,
    RefinementWritebackRequest,
    RefinementWritebackResponse,
    RefinementWritebackResult,
)
from schemas.task import ExternalTask
from services.ai_usage_event_service import AIUsageEventService
from services.integration_config_service import IntegrationConfigService
from services.llm.cost_tracker import CostTracker
from services.llm.provider import LLMProvider


class _SafeDict(dict[str, Any]):
    def __missing__(self, key: str) -> str:
        return ''


class _RefinementStructuredOutput(BaseModel):
    summary: str = ''
    suggested_story_points: int = 0
    estimation_rationale: str = ''
    confidence: int = 0
    comment: str = ''
    ambiguities: list[str] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)
    ready_for_planning: bool = False


class RefinementService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.settings = get_settings()
        self.azure_client = AzureDevOpsClient()
        self.jira_client = JiraClient()
        self.integration_service = IntegrationConfigService(db)
        self.cost_tracker = CostTracker()

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

        agent_provider, agent_model, llm = await self._resolve_llm(
            organization_id=organization_id,
            user_id=user_id,
            explicit_provider=request.agent_provider,
            explicit_model=request.agent_model,
        )

        total_usage = {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0}
        results: list[RefinementSuggestion] = []

        if selected:
            runner = CrewAIAgentRunner(llm)
            agent_cfg, task_cfg = self._load_prompt_config()
            point_scale = self._normalize_point_scale(request.point_scale)

            for item in selected:
                try:
                    prompt_vars = self._build_prompt_vars(
                        provider=request.provider,
                        sprint_name=items_response.sprint_name,
                        language=request.language,
                        point_scale=point_scale,
                        item=item,
                    )
                    content, usage, model, structured = await runner.run_configured_task(
                        role=str(agent_cfg.get('role') or 'Sprint Refinement Analyst'),
                        goal=str(agent_cfg.get('goal') or 'Refine and estimate backlog items.'),
                        backstory=str(agent_cfg.get('backstory') or ''),
                        system_prompt=self._format_template(str(task_cfg.get('system_prompt') or ''), prompt_vars),
                        user_prompt=self._format_template(str(task_cfg.get('description') or ''), prompt_vars),
                        expected_output=self._format_template(str(task_cfg.get('expected_output') or ''), prompt_vars),
                        complexity_hint='normal',
                        max_output_tokens=4000,
                        structured_output=_RefinementStructuredOutput,
                        reasoning=False,
                        skip_cache=True,
                    )
                    total_usage = self._merge_usage(total_usage, usage)
                    payload = structured or self._extract_json_dict(content) or {}
                    results.append(
                        self._to_suggestion(
                            item,
                            payload,
                            model=model,
                            provider=agent_provider,
                            language=request.language,
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
                try:
                    await self.azure_client.writeback_refinement(
                        cfg=cfg,
                        work_item_id=item.item_id,
                        suggested_story_points=item.suggested_story_points,
                        comment=comment,
                    )
                    results.append(RefinementWritebackResult(item_id=item.item_id, success=True, message='ok'))
                except Exception as exc:
                    results.append(RefinementWritebackResult(item_id=item.item_id, success=False, message=str(exc)[:220]))
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
                try:
                    await self.jira_client.writeback_refinement(
                        cfg=cfg,
                        issue_key=item.item_id,
                        suggested_story_points=item.suggested_story_points,
                        comment=comment,
                        board_id=request.board_id or '',
                    )
                    results.append(RefinementWritebackResult(item_id=item.item_id, success=True, message='ok'))
                except Exception as exc:
                    results.append(RefinementWritebackResult(item_id=item.item_id, success=False, message=str(exc)[:220]))
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

    async def _resolve_llm(
        self,
        *,
        organization_id: int,
        user_id: int,
        explicit_provider: str | None,
        explicit_model: str | None,
    ) -> tuple[str, str, LLMProvider]:
        pref_provider, pref_model = await self._get_user_preferred_agent_selection(user_id)
        provider = (explicit_provider or pref_provider or 'openai').strip().lower()
        if provider not in {'openai', 'gemini'}:
            provider = 'openai'
        model = (explicit_model or pref_model or self.settings.llm_large_model or 'gpt-4.1').strip()

        integration = await self.integration_service.get_config(organization_id, provider)
        api_key = ((integration.secret if integration else '') or '').strip()
        base_url = ((integration.base_url if integration else '') or '').strip()

        if provider == 'openai':
            api_key = api_key or (self.settings.openai_api_key or '').strip()
            base_url = base_url or (self.settings.openai_base_url or '').strip()
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

    def _load_prompt_config(self) -> tuple[dict[str, Any], dict[str, Any]]:
        base = Path(__file__).resolve().parents[1] / 'agents' / 'config'
        with (base / 'refinement_agents.yaml').open('r', encoding='utf-8') as fh:
            agents = yaml.safe_load(fh) or {}
        with (base / 'refinement_tasks.yaml').open('r', encoding='utf-8') as fh:
            tasks = yaml.safe_load(fh) or {}
        return agents.get('sprint_refiner') or {}, tasks.get('refine_backlog_item') or {}

    def _build_prompt_vars(
        self,
        *,
        provider: str,
        sprint_name: str,
        language: str,
        point_scale: str,
        item: ExternalTask,
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
        }

    def _to_suggestion(
        self,
        item: ExternalTask,
        payload: dict[str, Any],
        *,
        model: str,
        provider: str,
        language: str,
    ) -> RefinementSuggestion:
        point = payload.get('suggested_story_points', 0)
        confidence = max(0, min(100, int(payload.get('confidence', 0) or 0)))
        summary = str(payload.get('summary') or '').strip()
        rationale = str(payload.get('estimation_rationale') or '').strip()
        comment = str(payload.get('comment') or '').strip()
        ambiguities = self._coerce_str_list(payload.get('ambiguities'))
        questions = self._coerce_str_list(payload.get('questions'))

        fallback_fields: list[str] = []
        tr = self._is_turkish(language)
        point_value = max(0, int(point or 0))

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
        )

    def _is_turkish(self, language: str) -> bool:
        value = str(language or '').strip().lower()
        return value.startswith('tr') or 'turk' in value

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
