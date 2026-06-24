"""BR Management evaluation engine.

Evaluates a single work item from a Business-Request perspective and
persists the result. Shares the org-scoped LLM routing the triage
feature uses (claude_cli / codex_cli via the bridge, or an org-configured
API provider) — no new LLM plumbing. Output is a small structured JSON
object: classification (Improvement / Epic / not-a-BR), a readiness
score, a verdict, the AI's clarifying questions, and reasoning.

Saved answers (captured from stakeholders) are folded back into the
prompt on re-evaluation, so the readiness score rises as gaps close.
"""
from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.business_request import (
    BusinessRequestEval,
    BusinessRequestSettings,
)

VALID_TYPES = {'improvement', 'epic', 'not_br'}
VALID_VERDICTS = {'ready', 'needs_info', 'not_br'}
VALID_CHECK = {'ok', 'partial', 'missing'}

# The Business Request "Decision Pack" — the sections a BR must cover before
# it can go to the Decision Gate. The evaluation checks the work item against
# each of these and reports per-section coverage. Org-specific tweaks come
# from the `rubric` field, which is appended to the prompt.
DECISION_PACK_SECTIONS = [
    'Genel Talep Bilgileri (başlık, talep sahibi, iş birimi, BR ID, proje tipi)',
    'Proje Özeti ve İş Gerekçesi (kısa özet, mevcut problem/ihtiyaç, beklenen iş faydası)',
    'Etki ve Öncelik (etki alanı, etki seviyesi, hedef tarih/deadline + gerekçesi)',
    'Zaman Çerçevesi ve Varsayımlar (başlangıç, bitiş/çeyrek, varsayımlar ve kısıtlar)',
    'Scope — In-Scope (yapılacaklar)',
    'Scope — Out-of-Scope (yapılmayacaklar; BOŞ BIRAKILAMAZ)',
    'Fonksiyonel Gereksinimler ve Kabul Kriterleri',
    'Marka, Kanal ve Platform Kapsamı',
    'Paydaşlar ve Sahiplik (Business Owner, Product/Project Owner, Teknik Sahip, onaylayıcılar)',
    'Sistemler ve Entegrasyonlar (dahil sistemler, harici entegrasyon detayları)',
    'Uygulama Akışı / Workflow (akış tipi ve adımlar)',
    'Onaylar ve Risk Netliği — Decision Gate (hukuk/finansal/operasyonel etki, gerekli onaylar)',
    'Yönetici Özeti — Decision Pack (amaç/iş etkisi, kapsam özeti, kritik risk ve bağımlılıklar)',
]

_SECTION_LIST = '\n'.join(f'{i + 1}. {s}' for i, s in enumerate(DECISION_PACK_SECTIONS))

DEFAULT_SYSTEM_PROMPT = """You are a Business Request (BR) intake analyst at a retail company. \
You assess whether a work item, as written, is a complete, well-formed Business Request \
ready to pass the Decision Gate.

A BR is evaluated against the company's "Decision Pack" — these required sections:
""" + _SECTION_LIST + """

For the given work item (its description + discussion comments), produce:
1. checklist — for EACH Decision Pack section above, decide coverage: "ok" (clearly \
covered), "partial" (mentioned but incomplete/vague) or "missing" (absent). Add a short \
Turkish `note` saying what is missing or weak. Out-of-Scope being empty = "missing".
2. br_type — "improvement" (small bounded enhancement), "epic" (large/multi-team/multi-story \
initiative that must be broken down), or "not_br" (a pure bug/technical task, not a business request).
3. readiness_score — 0-100, driven by the checklist: roughly the share of sections that are \
"ok", with extra penalty when critical ones are missing (Out-of-Scope, Kabul Kriterleri, \
Paydaşlar/onaylar, Decision Gate riskleri).
4. verdict — "ready" (no critical section missing, score high), "needs_info" (gaps remain), \
or "not_br".
5. questions — concrete Turkish clarifying questions that would fill the missing/partial \
sections. Empty when ready or not_br.
6. reasoning — 2-4 sentences in Turkish.

Evaluate strictly from the provided content and any answers. Do not invent requirements. \
Be conservative: when a section is unclear, mark it partial/missing and lower the score.

Respond with ONLY a JSON object, no prose, exactly:
{"checklist": [{"section": "<section name>", "status": "ok|partial|missing", "note": "<tr>"}], \
"br_type": "improvement|epic|not_br", "readiness_score": 0, "verdict": "ready|needs_info|not_br", \
"questions": ["..."], "reasoning": "..."}"""


def _build_system_prompt(base: str, settings: BusinessRequestSettings | None) -> str:
    parts = [base.strip()]
    if settings is not None:
        rubric = (settings.rubric or '').strip()
        epic_rule = (settings.epic_rule or '').strip()
        if rubric:
            parts.append(f'## Sufficiency rubric (org-specific)\n{rubric}')
        if epic_rule:
            parts.append(f'## Improvement vs Epic rule (org-specific)\n{epic_rule}')
    return '\n\n'.join(parts)


def _build_user_prompt(
    *, title: str, description: str, answers: dict[str, Any] | None,
) -> str:
    lines = [
        f'## Work item title\n{title or "(untitled)"}',
        f'## Description\n{(description or "")[:6000] or "(empty)"}',
    ]
    if answers:
        rendered = '\n'.join(
            f'- Q{qid}: {ans}' for qid, ans in answers.items() if str(ans).strip()
        )
        if rendered:
            lines.append(
                '## Stakeholder answers to earlier questions\n'
                'Re-evaluate taking these into account — they may close prior gaps '
                'and raise the readiness score.\n' + rendered
            )
    return '\n\n'.join(lines)


def _extract_json(text: str) -> dict[str, Any]:
    """Pull the first JSON object out of an LLM response (handles code fences
    and surrounding prose)."""
    s = (text or '').strip()
    if s.startswith('```'):
        s = re.sub(r'^```(?:json)?\s*', '', s)
        s = re.sub(r'\s*```$', '', s).strip()
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        pass
    match = re.search(r'\{.*\}', s, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except (ValueError, TypeError):
            pass
    return {}


def _normalize(raw: dict[str, Any]) -> dict[str, Any]:
    br_type = str(raw.get('br_type') or '').strip().lower()
    if br_type not in VALID_TYPES:
        br_type = None
    verdict = str(raw.get('verdict') or '').strip().lower()
    if verdict not in VALID_VERDICTS:
        verdict = None
    try:
        score = int(round(float(raw.get('readiness_score'))))
        score = max(0, min(100, score))
    except (TypeError, ValueError):
        score = None
    q_raw = raw.get('questions') or []
    questions: list[dict[str, str]] = []
    if isinstance(q_raw, list):
        for i, q in enumerate(q_raw):
            text = (q.get('text') if isinstance(q, dict) else str(q)).strip()
            if text:
                questions.append({'id': f'q{i + 1}', 'text': text})
    cl_raw = raw.get('checklist') or []
    checklist: list[dict[str, str]] = []
    if isinstance(cl_raw, list):
        for c in cl_raw:
            if not isinstance(c, dict):
                continue
            section = str(c.get('section') or '').strip()
            status = str(c.get('status') or '').strip().lower()
            if not section:
                continue
            if status not in VALID_CHECK:
                status = 'partial'
            checklist.append({
                'section': section,
                'status': status,
                'note': str(c.get('note') or '').strip(),
            })
    # If the model said not_br, mirror that into the verdict for consistency.
    if br_type == 'not_br':
        verdict = 'not_br'
    return {
        'br_type': br_type,
        'readiness_score': score,
        'verdict': verdict,
        'reasoning': str(raw.get('reasoning') or '').strip(),
        'questions': questions,
        'checklist': checklist,
    }


class BRManagementService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_settings(self, organization_id: int) -> BusinessRequestSettings | None:
        return (
            await self.db.execute(
                select(BusinessRequestSettings).where(
                    BusinessRequestSettings.organization_id == organization_id
                )
            )
        ).scalar_one_or_none()

    async def _run_llm(
        self, *, organization_id: int, system_prompt: str, user_prompt: str,
        provider_override: str | None, model_override: str | None,
    ) -> tuple[str, dict[str, Any], str]:
        """Returns (output_text, usage, provider). Mirrors triage routing."""
        from agena_services.services.triage_service import _resolve_org_agent

        provider, model = ('', '')
        if provider_override:
            provider, model = provider_override.strip().lower(), (model_override or '').strip()
        else:
            provider, model = await _resolve_org_agent(self.db, organization_id)
        if not provider:
            raise RuntimeError(
                'No agent configured for this organization. Add a claude_cli / '
                'codex_cli / openai / gemini / anthropic agent under '
                '/dashboard/agents to enable BR evaluation.'
            )

        if provider in ('claude_cli', 'codex_cli'):
            import os as _os
            import httpx as _httpx
            bridge_url = _os.getenv('CLI_BRIDGE_URL', 'http://cli-bridge:9876')
            cli = 'claude' if provider == 'claude_cli' else 'codex'
            full_prompt = f'{system_prompt}\n\n---\n\n{user_prompt}'
            async with _httpx.AsyncClient(timeout=180) as client:
                resp = await client.post(
                    f'{bridge_url}/{cli}',
                    json={
                        'repo_path': '/tmp',
                        'prompt': full_prompt,
                        'model': model or '',
                        'timeout': 150,
                        'read_only': True,
                    },
                )
                data = resp.json() if resp.content else {}
            if data.get('status') != 'ok':
                raise RuntimeError(
                    f'{cli} bridge error: {data.get("message", data.get("stderr", "unknown"))}'
                )
            return (data.get('stdout') or '').strip(), {}, provider

        from agena_services.services.review_service import _build_llm_for_org
        llm = await _build_llm_for_org(
            self.db, organization_id=organization_id, provider=provider, model=model or None,
        )
        output, usage, _model, _cached = await llm.generate(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            complexity_hint='normal',
            max_output_tokens=900,
        )
        return output or '', usage or {}, provider

    async def evaluate_item(
        self,
        *,
        organization_id: int,
        source: str,
        external_id: str,
        title: str,
        description: str,
        assignee_email: str | None = None,
        answers: dict[str, Any] | None = None,
    ) -> BusinessRequestEval:
        """Run one BR evaluation and upsert the result row."""
        from agena_services.services.prompt_service import PromptService

        settings = await self.get_settings(organization_id)

        base = DEFAULT_SYSTEM_PROMPT
        try:
            db_prompt = await PromptService.get(self.db, 'br_evaluation_system_prompt')
            if db_prompt and db_prompt.strip():
                base = db_prompt
        except ValueError:
            pass

        system_prompt = _build_system_prompt(base, settings)
        user_prompt = _build_user_prompt(
            title=title, description=description, answers=answers,
        )

        output, usage, provider = await self._run_llm(
            organization_id=organization_id,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            provider_override=(settings.provider if settings else None),
            model_override=(settings.model if settings else None),
        )
        result = _normalize(_extract_json(output))

        existing = (
            await self.db.execute(
                select(BusinessRequestEval).where(
                    BusinessRequestEval.organization_id == organization_id,
                    BusinessRequestEval.source == source,
                    BusinessRequestEval.external_id == str(external_id),
                )
            )
        ).scalar_one_or_none()

        if existing is None:
            existing = BusinessRequestEval(
                organization_id=organization_id,
                source=source,
                external_id=str(external_id),
            )
            self.db.add(existing)

        existing.title = title or existing.title
        if assignee_email:
            existing.assignee_email = assignee_email
        existing.br_type = result['br_type']
        existing.readiness_score = result['readiness_score']
        existing.verdict = result['verdict']
        existing.reasoning = result['reasoning']
        existing.questions = result['questions']
        existing.checklist = result['checklist']
        if answers is not None:
            existing.answers = answers
        existing.status = 'evaluated'

        await self.db.commit()
        await self.db.refresh(existing)

        try:
            from agena_services.services.ai_usage_event_service import AIUsageEventService
            await AIUsageEventService(self.db).record_llm_usage(
                organization_id=organization_id,
                task_id=None,
                operation_type='br_evaluation',
                provider=provider,
                model=(settings.model if settings else None),
                usage=usage,
                details={'external_id': str(external_id), 'br_type': result['br_type']},
            )
        except Exception:
            pass

        return existing
