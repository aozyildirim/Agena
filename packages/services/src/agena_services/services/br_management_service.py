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

import base64
import hashlib
import json
import logging
import re
from datetime import datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.business_request import (
    BusinessRequestEval,
    BusinessRequestIntake,
    BusinessRequestSettings,
)

logger = logging.getLogger(__name__)

MODULE_SLUG = 'br_management'

# Closed-ish states excluded when listing BR work without a sprint filter,
# so the queue shows live requests rather than the whole archive.
CLOSED_STATES = ('Done', 'Closed', 'Removed', 'Resolved', 'Completed')

# LLM-call cap per org per scan cycle — a freshly enabled org with a big
# backlog drains over a few cycles instead of firing 100 calls at once.
MAX_AUTO_EVALS_PER_CYCLE = 8


def content_fingerprint(title: str, description: str) -> str:
    """Stable hash of the evaluated content — re-evaluate only when the
    work item's title/description actually changed, not on every state flip."""
    raw = f'{(title or "").strip()}\n{(description or "").strip()}'
    return hashlib.sha256(raw.encode('utf-8', errors='replace')).hexdigest()

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


# Readiness gate: an intake can be submitted to Azure once it reaches this.
INTAKE_SUBMIT_THRESHOLD = 70

DEFAULT_INTAKE_SYSTEM_PROMPT = """You are a warm, senior business analyst running a \
Business Request (BR) intake interview at a retail company. The requester is a \
non-technical business person. Everything you write in `reply`, `title`, `checklist` \
notes and `pack_markdown` is in TURKISH.

The BR must ultimately cover the company's "Decision Pack" sections:
""" + _SECTION_LIST + """

Each turn you receive the conversation so far plus the current Decision Pack state. Do:
1. Fold EVERYTHING the requester has said so far into the Decision Pack. Never invent \
facts they did not state — leave real gaps as missing.
2. `reply` — ONLY a short, warm Turkish acknowledgement (1-2 sentences) of what you \
captured this turn. NEVER put questions, numbered lists or examples inside `reply` — \
questions go in the structured `questions` field. When readiness_score >= \
""" + str(INTAKE_SUBMIT_THRESHOLD) + """, congratulate them and say the BR is ready \
to submit.
2b. `questions` — AT MOST 3 focused questions targeting the most critical missing/\
partial sections (öncelik: Out-of-Scope, kabul kriterleri, paydaşlar/onaylar, Decision \
Gate riskleri, etki/öncelik). Each: {"id": "q1", "text": "<short Turkish question>", \
"examples": ["<2-3 short example answers, max ~8 words each>"]}. The examples must be \
plausible for THIS request so the user can tap one and edit. Empty array when ready \
or not_br.
3. `title` — a short Azure work item title in Turkish (max ~90 chars).
4. `checklist` — ALL sections above, each with status ok|partial|missing and a short \
Turkish note.
5. `readiness_score` — 0-100, the share of sections covered, with extra penalty when \
critical ones are missing.
6. `br_type` — improvement|epic|not_br (not_br = pure bug/technical task).
7. `pack_markdown` — the FULL composed Decision Pack document in Turkish markdown: one \
`##` heading per section with the current content, writing `_(eksik)_` under sections \
that are still missing. This document is what gets submitted to Azure DevOps, so keep \
it clean and self-contained — but COMPACT: 1-3 tight lines (or a few bullets) per \
section, no filler prose, never repeat the section list or these instructions.

Keep the total response fast to generate: short reply, short notes, compact pack.

Respond with ONLY a JSON object, no prose, exactly:
{"reply": "...", "title": "...", "br_type": "improvement|epic|not_br", \
"readiness_score": 0, "questions": [{"id": "q1", "text": "...", "examples": ["..."]}], \
"checklist": [{"section": "...", "status": "ok|partial|missing", "note": "..."}], \
"pack_markdown": "..."}"""


def _normalize_intake(raw: dict[str, Any]) -> dict[str, Any]:
    base = _normalize(raw)
    # Structured questions with tappable example answers.
    q_raw = raw.get('questions') or []
    questions: list[dict[str, Any]] = []
    if isinstance(q_raw, list):
        for i, q in enumerate(q_raw[:3]):
            if isinstance(q, dict):
                text = str(q.get('text') or '').strip()
                examples = [
                    str(e).strip() for e in (q.get('examples') or [])
                    if str(e).strip()
                ][:3]
            else:
                text, examples = str(q).strip(), []
            if text:
                questions.append({'id': f'q{i + 1}', 'text': text, 'examples': examples})
    return {
        'reply': str(raw.get('reply') or '').strip(),
        'title': str(raw.get('title') or '').strip(),
        'br_type': base['br_type'],
        'readiness_score': base['readiness_score'],
        'questions': questions,
        'checklist': base['checklist'],
        'pack_markdown': str(raw.get('pack_markdown') or '').strip(),
    }


def _markdown_to_html(md: str) -> str:
    """Tiny markdown→HTML for the Azure Description field (headings, bullets,
    bold, paragraphs). Good enough for the composed Decision Pack."""
    import html as _html

    out: list[str] = []
    in_list = False
    for line in (md or '').splitlines():
        stripped = line.strip()
        esc = _html.escape(stripped)
        esc = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', esc)
        esc = re.sub(r'_\((.+?)\)_', r'<i>(\1)</i>', esc)
        if stripped.startswith('- ') or stripped.startswith('* '):
            if not in_list:
                out.append('<ul>')
                in_list = True
            out.append(f'<li>{esc[2:].strip()}</li>')
            continue
        if in_list:
            out.append('</ul>')
            in_list = False
        if stripped.startswith('#'):
            level = min(4, len(stripped) - len(stripped.lstrip('#')))
            text = esc.lstrip('#').strip()
            out.append(f'<h{max(2, level)}>{text}</h{max(2, level)}>')
        elif stripped:
            out.append(f'<p>{esc}</p>')
    if in_list:
        out.append('</ul>')
    return '\n'.join(out)


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


def _azure_headers(pat: str) -> dict[str, str]:
    token = base64.b64encode(f':{pat}'.encode()).decode()
    return {'Authorization': f'Basic {token}', 'Content-Type': 'application/json'}


async def resolve_azure_creds(
    db: AsyncSession, organization_id: int,
    settings: BusinessRequestSettings | None,
) -> tuple[str, str]:
    """Resolve (base_url, pat) for BR Azure calls — the BR-scoped PAT first
    (the org's main PAT often can't see the BR team's project), then the
    main Azure integration. Raises ValueError when nothing is configured."""
    from agena_services.services.integration_config_service import IntegrationConfigService

    base_url = (settings.azure_base_url if settings else '') or ''
    pat = (settings.azure_pat if settings else '') or ''
    if not pat or not base_url:
        cfg = await IntegrationConfigService(db).get_config(organization_id, 'azure')
        if not base_url:
            base_url = (cfg.base_url if cfg else '') or ''
        if not pat:
            pat = (cfg.secret if cfg else '') or ''
    base_url = base_url.rstrip('/')
    if not base_url or not pat:
        raise ValueError(
            'No Azure access — set a BR PAT in settings or configure the Azure integration.'
        )
    return base_url, pat


async def fetch_azure_items(
    *, base_url: str, pat: str, project: str, emails: list[str],
    sprint_path: str = '',
) -> list[dict[str, Any]]:
    """Work items assigned to the BR people. sprint_path optional: empty =
    ALL open (non-closed) work in the project — BRs are often pre-sprint.
    A member whose query/PAT fails is skipped so the rest still surface."""
    sprint_path = (sprint_path or '').strip()
    out: list[dict[str, Any]] = []
    headers = _azure_headers(pat)
    async with httpx.AsyncClient(timeout=30) as client:
        for email in emails:
            if sprint_path:
                where = (
                    f"[System.IterationPath] UNDER '{sprint_path}' "
                    f"And [System.AssignedTo] = '{email}'"
                )
                order = 'Order By [System.State] Asc'
            else:
                closed = ', '.join(f"'{s}'" for s in CLOSED_STATES)
                where = (
                    f"[System.TeamProject] = '{project}' "
                    f"And [System.AssignedTo] = '{email}' "
                    f"And [System.State] NOT IN ({closed})"
                )
                order = 'Order By [System.ChangedDate] Desc'
            wiql_payload = {'query': f'Select [System.Id] From WorkItems Where {where} {order}'}
            try:
                r = await client.post(
                    f'{base_url}/{project}/_apis/wit/wiql?api-version=7.1-preview.2',
                    headers=headers, json=wiql_payload,
                )
                r.raise_for_status()
                refs = r.json().get('workItems', [])
                if not refs:
                    continue
                ids = ','.join(str(i['id']) for i in refs[:100])
                dr = await client.get(
                    f'{base_url}/_apis/wit/workitems?ids={ids}&fields='
                    'System.Id,System.Title,System.State,System.WorkItemType,System.Description,'
                    'System.CreatedDate,System.ChangedDate'
                    '&api-version=7.1-preview.3',
                    headers=headers,
                )
                dr.raise_for_status()
            except (httpx.HTTPError, KeyError):
                continue
            for item in dr.json().get('value', []):
                f = item.get('fields', {})
                ext_id = str(f.get('System.Id', ''))
                out.append({
                    'source': 'azure',
                    'external_id': ext_id,
                    'title': f.get('System.Title', '') or '',
                    'state': f.get('System.State', '') or '',
                    'work_item_type': f.get('System.WorkItemType', '') or '',
                    'description': f.get('System.Description', '') or '',
                    'created_date': f.get('System.CreatedDate', '') or '',
                    'changed_date': f.get('System.ChangedDate', '') or '',
                    'assignee_email': email,
                    'url': f'{base_url}/{project}/_workitems/edit/{ext_id}',
                })
    return out


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
        max_output_tokens: int = 900,
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
                        # Quick structured extraction — low reasoning effort
                        # cuts codex latency a lot (ignored by claude).
                        'effort': 'low',
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
            max_output_tokens=max_output_tokens,
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
        existing.content_hash = content_fingerprint(title, description)
        existing.evaluated_at = datetime.utcnow()

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

    # ── Conversational intake (chat) ─────────────────────────────────

    async def intake_turn(
        self, *, intake: BusinessRequestIntake, user_text: str,
    ) -> BusinessRequestIntake:
        """One chat turn: append the user message, run the interviewer LLM,
        fold the reply + updated Decision Pack back onto the intake row."""
        from agena_services.services.prompt_service import PromptService

        settings = await self.get_settings(intake.organization_id)

        base = DEFAULT_INTAKE_SYSTEM_PROMPT
        try:
            db_prompt = await PromptService.get(self.db, 'br_intake_system_prompt')
            if db_prompt and db_prompt.strip():
                base = db_prompt
        except ValueError:
            pass
        system_prompt = _build_system_prompt(base, settings)

        messages = list(intake.messages or [])
        messages.append({
            'role': 'user',
            'text': user_text.strip(),
            'ts': datetime.utcnow().isoformat(),
        })

        # Transcript (recent turns) + current pack as state for the LLM.
        transcript = '\n'.join(
            f'{"Talep sahibi" if m["role"] == "user" else "Analist"}: {m["text"]}'
            for m in messages[-30:]
        )
        user_prompt_parts = [f'## Görüşme\n{transcript[:12000]}']
        if intake.pack_markdown:
            user_prompt_parts.append(
                f'## Mevcut Decision Pack (önceki tur)\n{intake.pack_markdown[:8000]}'
            )
        user_prompt = '\n\n'.join(user_prompt_parts)

        output, usage, provider = await self._run_llm(
            organization_id=intake.organization_id,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            provider_override=(settings.provider if settings else None),
            model_override=(settings.model if settings else None),
            max_output_tokens=2500,
        )
        result = _normalize_intake(_extract_json(output))
        if not result['reply']:
            raise RuntimeError('The interviewer model returned no usable reply — try again.')

        messages.append({
            'role': 'assistant',
            'text': result['reply'],
            'questions': result['questions'],
            'ts': datetime.utcnow().isoformat(),
        })
        intake.messages = messages
        if result['title']:
            intake.title = result['title']
        intake.br_type = result['br_type'] or intake.br_type
        if result['readiness_score'] is not None:
            intake.readiness_score = result['readiness_score']
        if result['checklist']:
            intake.checklist = result['checklist']
        if result['pack_markdown']:
            intake.pack_markdown = result['pack_markdown']

        await self.db.commit()
        await self.db.refresh(intake)

        try:
            from agena_services.services.ai_usage_event_service import AIUsageEventService
            await AIUsageEventService(self.db).record_llm_usage(
                organization_id=intake.organization_id,
                task_id=None,
                operation_type='br_intake',
                provider=provider,
                model=(settings.model if settings else None),
                usage=usage,
                details={'intake_id': intake.id},
            )
        except Exception:
            pass

        return intake

    async def submit_intake(
        self, *, intake: BusinessRequestIntake, project: str,
        work_item_type: str = 'Product Backlog Item',
        assignee_email: str | None = None,
        title_override: str | None = None,
        pack_override: str | None = None,
    ) -> BusinessRequestIntake:
        """Create the Azure DevOps work item from a ready intake, then mirror
        it into the BR queue as an already-evaluated item. The submit panel
        may hand-edit the title/pack right before creation — persist those."""
        if intake.status == 'submitted':
            raise ValueError('This intake was already submitted.')
        if title_override:
            intake.title = title_override
        if pack_override:
            intake.pack_markdown = pack_override
        if (intake.readiness_score or 0) < INTAKE_SUBMIT_THRESHOLD:
            raise ValueError(
                f'Readiness score {intake.readiness_score or 0} is below the '
                f'submit gate ({INTAKE_SUBMIT_THRESHOLD}). Answer the open questions first.'
            )
        if not (intake.title or '').strip() or not (intake.pack_markdown or '').strip():
            raise ValueError('Intake has no composed title/Decision Pack yet.')

        settings = await self.get_settings(intake.organization_id)
        base_url, pat = await resolve_azure_creds(self.db, intake.organization_id, settings)

        patch = [
            {'op': 'add', 'path': '/fields/System.Title', 'value': intake.title.strip()[:250]},
            {
                'op': 'add', 'path': '/fields/System.Description',
                'value': _markdown_to_html(intake.pack_markdown),
            },
            {'op': 'add', 'path': '/fields/System.Tags', 'value': 'BR; Agena Intake'},
        ]
        if assignee_email:
            patch.append({
                'op': 'add', 'path': '/fields/System.AssignedTo', 'value': assignee_email,
            })

        wi_type = (work_item_type or 'Product Backlog Item').strip()
        headers = _azure_headers(pat)
        headers['Content-Type'] = 'application/json-patch+json'
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f'{base_url}/{project}/_apis/wit/workitems/${wi_type}'
                '?api-version=7.1-preview.3',
                headers=headers, json=patch,
            )
            if r.status_code >= 400:
                detail = ''
                try:
                    detail = (r.json() or {}).get('message', '')
                except ValueError:
                    detail = r.text[:300]
                raise ValueError(f'Azure work item creation failed ({r.status_code}): {detail}')
            data = r.json()

        ext_id = str(data.get('id') or '')
        intake.azure_work_item_id = ext_id
        intake.azure_url = f'{base_url}/{project}/_workitems/edit/{ext_id}'
        intake.status = 'submitted'

        # Mirror into the BR queue as an already-evaluated item so it shows
        # up scored the moment it lands in Azure.
        if ext_id:
            existing = (
                await self.db.execute(
                    select(BusinessRequestEval).where(
                        BusinessRequestEval.organization_id == intake.organization_id,
                        BusinessRequestEval.source == 'azure',
                        BusinessRequestEval.external_id == ext_id,
                    )
                )
            ).scalar_one_or_none()
            if existing is None:
                existing = BusinessRequestEval(
                    organization_id=intake.organization_id,
                    source='azure',
                    external_id=ext_id,
                )
                self.db.add(existing)
            existing.title = intake.title
            existing.br_type = intake.br_type
            existing.readiness_score = intake.readiness_score
            existing.verdict = 'ready'
            existing.reasoning = 'Agena BR Intake görüşmesiyle oluşturuldu.'
            existing.checklist = intake.checklist
            existing.questions = []
            existing.status = 'evaluated'
            existing.content_hash = content_fingerprint(
                intake.title or '', _markdown_to_html(intake.pack_markdown),
            )
            existing.evaluated_at = datetime.utcnow()
            if assignee_email:
                existing.assignee_email = assignee_email

        await self.db.commit()
        await self.db.refresh(intake)
        return intake


# ── Continuous auto-evaluation (worker poller) ───────────────────────

async def _module_enabled_orgs(db: AsyncSession, org_ids: list[int]) -> set[int]:
    """Of the given orgs, the ones with the br_management module effectively
    enabled (org override wins; the module is default-off)."""
    if not org_ids:
        return set()
    from agena_models.models.module import Module, OrganizationModule

    mod = (
        await db.execute(select(Module).where(Module.slug == MODULE_SLUG))
    ).scalar_one_or_none()
    default_on = bool(mod and (mod.is_core or mod.default_enabled))
    rows = (
        await db.execute(
            select(OrganizationModule.organization_id, OrganizationModule.enabled).where(
                OrganizationModule.module_slug == MODULE_SLUG,
                OrganizationModule.organization_id.in_(org_ids),
            )
        )
    ).all()
    overrides = {org_id: bool(enabled) for org_id, enabled in rows}
    return {oid for oid in org_ids if overrides.get(oid, default_on)}


async def _org_owner_user_id(db: AsyncSession, organization_id: int) -> int | None:
    from agena_models.models.organization_member import OrganizationMember

    owner = (
        await db.execute(
            select(OrganizationMember.user_id).where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.role == 'owner',
            ).limit(1)
        )
    ).scalar_one_or_none()
    if owner:
        return owner
    return (
        await db.execute(
            select(OrganizationMember.user_id).where(
                OrganizationMember.organization_id == organization_id,
            ).order_by(OrganizationMember.id).limit(1)
        )
    ).scalar_one_or_none()


async def _notify_eval(
    db: AsyncSession, *, organization_id: int, user_id: int | None,
    item: dict[str, Any], row: BusinessRequestEval, is_new: bool,
    prev_score: int | None,
) -> None:
    if user_id is None:
        return
    try:
        from agena_services.services.notification_service import NotificationService

        if is_new:
            title = f'New BR evaluated — #{row.external_id} scored {row.readiness_score}'
        else:
            title = (
                f'BR #{row.external_id} re-evaluated — '
                f'score {prev_score} → {row.readiness_score}'
            )
        message = (
            f'{(row.title or "").strip() or "(untitled)"} · '
            f'type: {row.br_type or "?"} · verdict: {row.verdict or "?"}'
        )
        await NotificationService(db).notify_event(
            organization_id=organization_id,
            user_id=user_id,
            event_type='br_evaluated',
            title=title,
            message=message,
            severity='info',
            payload={
                'external_id': row.external_id,
                'source': row.source,
                'readiness_score': row.readiness_score,
                'verdict': row.verdict,
                'br_type': row.br_type,
                'url': item.get('url') or '',
            },
        )
    except Exception:
        logger.exception('BR eval notification failed (org=%s)', organization_id)


async def auto_scan_all_orgs(db: AsyncSession) -> None:
    """One poll cycle: for every org with auto-eval on (module enabled,
    Azure project set, interval due), fetch the BR people's open work items
    and evaluate anything new or changed since the last evaluation.

    "New" = no eval row yet → evaluated the moment the business team opens
    the item. "Changed" = title/description hash differs → re-evaluated with
    the previously captured answers folded back in."""
    now = datetime.utcnow()
    candidates = list(
        (
            await db.execute(
                select(BusinessRequestSettings).where(
                    BusinessRequestSettings.auto_eval.is_(True),
                    BusinessRequestSettings.azure_project.is_not(None),
                )
            )
        ).scalars().all()
    )
    candidates = [c for c in candidates if (c.azure_project or '').strip() and c.br_emails]
    if not candidates:
        return
    enabled = await _module_enabled_orgs(db, [c.organization_id for c in candidates])

    for cfg in candidates:
        org_id = cfg.organization_id
        if org_id not in enabled:
            continue
        interval = max(1, int(cfg.auto_eval_interval_minutes or 5))
        if cfg.last_auto_eval_at and now < cfg.last_auto_eval_at + timedelta(minutes=interval):
            continue
        # Stamp the scan start before the (slow) LLM work so an overlapping
        # poll tick doesn't double-scan the same org.
        cfg.last_auto_eval_at = now
        await db.commit()
        try:
            await _auto_scan_org(db, cfg)
        except Exception:
            logger.exception('BR auto-scan failed for org=%s', org_id)


async def _auto_scan_org(db: AsyncSession, cfg: BusinessRequestSettings) -> None:
    org_id = cfg.organization_id
    emails = [e for e in (cfg.br_emails or []) if e]
    base_url, pat = await resolve_azure_creds(db, org_id, cfg)
    items = await fetch_azure_items(
        base_url=base_url, pat=pat,
        project=(cfg.azure_project or '').strip(), emails=emails,
    )
    if not items:
        return

    eval_rows = (
        await db.execute(
            select(BusinessRequestEval).where(
                BusinessRequestEval.organization_id == org_id
            )
        )
    ).scalars().all()
    eval_map = {(e.source, e.external_id): e for e in eval_rows}

    svc = BRManagementService(db)
    owner_id: int | None = None
    ran = 0
    for item in items:
        key = (item['source'], item['external_id'])
        existing = eval_map.get(key)
        fingerprint = content_fingerprint(item['title'], item['description'])
        if existing is not None and existing.content_hash == fingerprint:
            continue
        # Accepted/rejected items are settled — don't churn them on edits.
        if existing is not None and existing.status in ('accepted', 'rejected'):
            continue
        if ran >= MAX_AUTO_EVALS_PER_CYCLE:
            logger.info(
                'BR auto-scan org=%s hit the per-cycle cap (%s); '
                'remaining items evaluate next cycle',
                org_id, MAX_AUTO_EVALS_PER_CYCLE,
            )
            break
        is_new = existing is None
        prev_score = existing.readiness_score if existing else None
        try:
            row = await svc.evaluate_item(
                organization_id=org_id,
                source=item['source'],
                external_id=item['external_id'],
                title=item['title'],
                description=item['description'],
                assignee_email=item.get('assignee_email'),
                # Fold saved stakeholder answers back in on re-evaluation.
                answers=(existing.answers if existing else None),
            )
        except Exception:
            logger.exception(
                'BR auto-eval failed org=%s item=%s', org_id, item['external_id']
            )
            continue
        ran += 1
        if owner_id is None:
            owner_id = await _org_owner_user_id(db, org_id)
        if is_new or prev_score != row.readiness_score:
            await _notify_eval(
                db, organization_id=org_id, user_id=owner_id,
                item=item, row=row, is_new=is_new, prev_score=prev_score,
            )
    if ran:
        logger.info('BR auto-scan org=%s evaluated %s item(s)', org_id, ran)
