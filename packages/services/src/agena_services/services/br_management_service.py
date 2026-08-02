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


def discussion_fingerprint(comments: list[dict[str, Any]] | None) -> str:
    """Stable hash of a work item's discussion thread. Answers to the AI's
    questions usually land in comments, so the poller re-scores a
    needs_info item when this changes even though the description didn't."""
    raw = '\n'.join(
        f'{c.get("id")}:{(c.get("text") or "").strip()}' for c in (comments or [])
    )
    return hashlib.sha256(raw.encode('utf-8', errors='replace')).hexdigest()

VALID_TYPES = {'improvement', 'epic', 'not_br'}
VALID_VERDICTS = {'ready', 'needs_info', 'not_br'}
VALID_CHECK = {'ok', 'partial', 'missing'}

# Turkish labels for the comment Agena posts back on the work item — the
# audience there is the business requester, not the Agena UI.
BR_TYPE_LABELS = {'improvement': 'Improvement', 'epic': 'Epic', 'not_br': 'BR değil'}
VERDICT_LABELS = {
    'ready': 'Hazır', 'needs_info': 'Bilgi eksik', 'not_br': 'BR değil',
}

# The Business Request "Decision Pack" — the sections a BR must cover before
# it can go to the Decision Gate. The evaluation checks the work item against
# each of these and reports per-section coverage. This is the built-in
# default; an org can replace the list from BR settings. `critical` sections
# carry an extra scoring penalty when they are missing.
DECISION_PACK_SECTIONS: list[dict[str, Any]] = [
    {'title': 'Genel Talep Bilgileri (başlık, talep sahibi, iş birimi, BR ID, proje tipi)', 'critical': False},
    {'title': 'Proje Özeti ve İş Gerekçesi (kısa özet, mevcut problem/ihtiyaç, beklenen iş faydası)', 'critical': False},
    {'title': 'Etki ve Öncelik (etki alanı, etki seviyesi, hedef tarih/deadline + gerekçesi)', 'critical': False},
    {'title': 'Zaman Çerçevesi ve Varsayımlar (başlangıç, bitiş/çeyrek, varsayımlar ve kısıtlar)', 'critical': False},
    {'title': 'Scope — In-Scope (yapılacaklar)', 'critical': False},
    {'title': 'Scope — Out-of-Scope (yapılmayacaklar; BOŞ BIRAKILAMAZ)', 'critical': True},
    {'title': 'Fonksiyonel Gereksinimler ve Kabul Kriterleri', 'critical': True},
    {'title': 'Marka, Kanal ve Platform Kapsamı', 'critical': False},
    {'title': 'Paydaşlar ve Sahiplik (Business Owner, Product/Project Owner, Teknik Sahip, onaylayıcılar)', 'critical': True},
    {'title': 'Sistemler ve Entegrasyonlar (dahil sistemler, harici entegrasyon detayları)', 'critical': False},
    {'title': 'Uygulama Akışı / Workflow (akış tipi ve adımlar)', 'critical': False},
    {'title': 'Onaylar ve Risk Netliği — Decision Gate (hukuk/finansal/operasyonel etki, gerekli onaylar)', 'critical': True},
    {'title': 'Yönetici Özeti — Decision Pack (amaç/iş etkisi, kapsam özeti, kritik risk ve bağımlılıklar)', 'critical': False},
]

# Both system prompts carry this token instead of a baked-in section list, so
# the org's own Decision Pack is rendered in at call time.
SECTIONS_TOKEN = '{{DECISION_PACK_SECTIONS}}'


def normalize_sections(raw: Any) -> list[dict[str, Any]]:
    """Accept a list of plain strings or {title, critical} objects and return
    the object form. Empty/garbage input falls back to the built-in pack."""
    out: list[dict[str, Any]] = []
    if isinstance(raw, list):
        for entry in raw:
            if isinstance(entry, str):
                title, critical = entry.strip(), False
            elif isinstance(entry, dict):
                title = str(entry.get('title') or '').strip()
                critical = bool(entry.get('critical'))
            else:
                continue
            if title:
                out.append({'title': title[:500], 'critical': critical})
    return out[:40] or [dict(s) for s in DECISION_PACK_SECTIONS]


DEFAULT_PACK_KEY = 'default'


def normalize_packs(raw: Any) -> list[dict[str, Any]]:
    """Coerce stored packs into {key, name, applies_to, sections}."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    if isinstance(raw, list):
        for i, entry in enumerate(raw):
            if not isinstance(entry, dict):
                continue
            sections = normalize_sections(entry.get('sections'))
            key = (str(entry.get('key') or '').strip() or f'pack{i + 1}')[:64]
            if key in seen:
                key = f'{key}-{i + 1}'[:64]
            seen.add(key)
            applies = str(entry.get('applies_to') or 'default').strip().lower()
            if applies not in ('default', 'epic', 'improvement'):
                applies = 'default'
            out.append({
                'key': key,
                'name': (str(entry.get('name') or '').strip() or key)[:120],
                'applies_to': applies,
                'sections': sections,
            })
    return out[:8]


def org_packs(settings: BusinessRequestSettings | None) -> list[dict[str, Any]]:
    """Every pack this org evaluates against, always at least one.

    An org that only ever configured the single `decision_pack_sections`
    list keeps working — it becomes the default pack."""
    if settings is not None and settings.decision_packs:
        packs = normalize_packs(settings.decision_packs)
        if packs:
            return packs
    return [{
        'key': DEFAULT_PACK_KEY,
        'name': 'Decision Pack',
        'applies_to': 'default',
        'sections': (
            normalize_sections(settings.decision_pack_sections)
            if settings is not None and settings.decision_pack_sections
            else [dict(s) for s in DECISION_PACK_SECTIONS]
        ),
    }]


def resolve_pack(
    settings: BusinessRequestSettings | None, *,
    pack_key: str | None = None, br_type: str | None = None,
) -> dict[str, Any]:
    """Pick the pack to judge against: an explicit choice wins, then one
    matching the classification, then the default, then the first."""
    packs = org_packs(settings)
    if pack_key:
        for p in packs:
            if p['key'] == pack_key:
                return p
    if br_type in ('epic', 'improvement'):
        for p in packs:
            if p['applies_to'] == br_type:
                return p
    for p in packs:
        if p['applies_to'] == 'default':
            return p
    return packs[0]


def org_sections(
    settings: BusinessRequestSettings | None, *,
    pack_key: str | None = None, br_type: str | None = None,
) -> list[dict[str, Any]]:
    return resolve_pack(settings, pack_key=pack_key, br_type=br_type)['sections']


def included_states(settings: BusinessRequestSettings | None) -> list[str]:
    """States the BR queue covers. Empty list = every state except the
    closed ones, which is the historical behaviour."""
    if settings is not None and settings.included_states:
        return [str(s).strip() for s in settings.included_states if str(s).strip()][:30]
    return []


def state_allowed(settings: BusinessRequestSettings | None, state: str) -> bool:
    allow = included_states(settings)
    if allow:
        return (state or '') in allow
    return (state or '') not in CLOSED_STATES


def render_sections(sections: list[dict[str, Any]]) -> str:
    """The numbered list the prompt shows the model, criticality inline."""
    return '\n'.join(
        f'{i + 1}. {s["title"]}' + (' [KRİTİK]' if s.get('critical') else '')
        for i, s in enumerate(sections)
    )

DEFAULT_SYSTEM_PROMPT = """You are a Business Request (BR) intake analyst at a retail company. \
You assess whether a work item, as written, is a complete, well-formed Business Request \
ready to pass the Decision Gate.

A BR is evaluated against the company's "Decision Pack" — these required sections:
""" + SECTIONS_TOKEN + """

For the given work item (its description + discussion comments), produce:
1. checklist — for EACH Decision Pack section above, decide coverage: "ok" (clearly \
covered), "partial" (mentioned but incomplete/vague) or "missing" (absent). Add a short \
Turkish `note` saying what is missing or weak. Out-of-Scope being empty = "missing".
2. br_type — "improvement" (small bounded enhancement), "epic" (large/multi-team/multi-story \
initiative that must be broken down), or "not_br" (a pure bug/technical task, not a business request).
3. readiness_score — 0-100, driven by the checklist: roughly the share of sections that are \
"ok", with extra penalty when a section marked [KRİTİK] is missing or partial.
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
""" + SECTIONS_TOKEN + """

Each turn you receive the conversation so far plus the current Decision Pack state. Do:
1. Fold EVERYTHING the requester has said so far into the Decision Pack. Never invent \
facts they did not state — leave real gaps as missing.
2. `reply` — ONLY a short, warm Turkish acknowledgement (1-2 sentences) of what you \
captured this turn. NEVER put questions, numbered lists or examples inside `reply` — \
questions go in the structured `questions` field. When readiness_score >= \
""" + str(INTAKE_SUBMIT_THRESHOLD) + """, congratulate them and say the BR is ready \
to submit.
2b. `questions` — ONE question for EVERY section still missing or partial, in the \
section order above (sections marked [KRİTİK] matter most, but do not skip the \
others). Each: {"id": "q1", "text": "<short Turkish question>", "section": "<the \
EXACT section name from the list above that this question fills>", "examples": \
["<2-3 short example answers, max ~8 words each>"]}. `section` must be copied \
verbatim from the numbered list — the UI shows each question inside its own section \
of the document, so a wrong or missing `section` strands the question. Keep every \
question to one short sentence. The examples must be plausible for THIS request so \
the user can tap one and edit. Empty array when ready or not_br.
3. `title` — a short Azure work item title in Turkish (max ~90 chars).
4. `checklist` — ALL sections above, each with status ok|partial|missing and a short \
Turkish note.
5. `readiness_score` — 0-100, the share of sections covered, with extra penalty when \
a section marked [KRİTİK] is missing.
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


DEFAULT_BREAKDOWN_SYSTEM_PROMPT = """You are a delivery lead breaking a matured \
Business Request into work an engineering team can pick up. Everything you write \
is in TURKISH.

You receive the BR's Decision Pack and its classification. Produce the work \
hierarchy that sits UNDER the BR:

- An **Epic** BR breaks into Features; each Feature into User Stories; a Story \
into Tasks only where the technical work is genuinely separable.
- An **Improvement** BR breaks into User Stories directly (no Feature layer), \
each with its Tasks.

Rules:
- Derive ONLY from what the Decision Pack states. Never invent scope. If the pack \
says something is out of scope, no item may cover it.
- Every item: a short imperative Turkish title (max ~90 chars) and a 1-3 sentence \
`description` saying what "done" means for it. Acceptance criteria belong in the \
User Story descriptions.
- Keep the tree small enough to be real: at most 6 Features, at most 8 Stories per \
Feature, at most 6 Tasks per Story. Fewer, meaningful items beat an exhaustive list.
- No item may restate the BR itself, and no two items may cover the same work.

Respond with ONLY a JSON object, no prose, exactly:
{"items": [{"type": "Feature|User Story|Task", "title": "...", \
"description": "...", "children": [ ...same shape... ]}]}"""

# Which child types are legal under which parent, so a hallucinated level
# can't produce an Azure link Azure will reject.
BREAKDOWN_CHILD_TYPES = {
    'Feature': ('User Story',),
    'User Story': ('Task',),
    'Task': (),
}
BREAKDOWN_ROOT_TYPES = {
    'epic': ('Feature', 'User Story'),
    'improvement': ('User Story',),
}
BREAKDOWN_MAX = {'Feature': 6, 'User Story': 8, 'Task': 6}


def normalize_breakdown(
    raw: Any, *, allowed: tuple[str, ...], depth: int = 0,
) -> list[dict[str, Any]]:
    """Validate the proposed tree: legal types, legal nesting, sane counts.

    Anything the model got wrong is dropped rather than passed on to Azure,
    where a bad link type fails the whole create."""
    if not isinstance(raw, list) or depth > 2:
        return []
    out: list[dict[str, Any]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        wi_type = str(entry.get('type') or '').strip().title()
        if wi_type == 'Userstory':
            wi_type = 'User Story'
        if wi_type not in allowed:
            continue
        title = str(entry.get('title') or '').strip()
        if not title:
            continue
        if len(out) >= BREAKDOWN_MAX.get(wi_type, 6):
            break
        out.append({
            'type': wi_type,
            'title': title[:250],
            'description': str(entry.get('description') or '').strip()[:4000],
            'children': normalize_breakdown(
                entry.get('children'),
                allowed=BREAKDOWN_CHILD_TYPES.get(wi_type, ()),
                depth=depth + 1,
            ),
            'azure_id': str(entry.get('azure_id') or '').strip() or None,
        })
    return out


def count_breakdown(items: list[dict[str, Any]] | None) -> int:
    total = 0
    for item in items or []:
        total += 1 + count_breakdown(item.get('children'))
    return total


def _normalize_intake(raw: dict[str, Any]) -> dict[str, Any]:
    base = _normalize(raw)
    # Structured questions with tappable example answers.
    q_raw = raw.get('questions') or []
    questions: list[dict[str, Any]] = []
    if isinstance(q_raw, list):
        # One per Decision Pack section at most — the UI places each inside
        # the gap it fills, so there is no reason to cap lower.
        for i, q in enumerate(q_raw[:20]):
            if isinstance(q, dict):
                text = str(q.get('text') or '').strip()
                section = str(q.get('section') or '').strip()
                examples = [
                    str(e).strip() for e in (q.get('examples') or [])
                    if str(e).strip()
                ][:3]
            else:
                text, section, examples = str(q).strip(), '', []
            if text:
                # `section` anchors the question to a Decision Pack row so the
                # UI can show it in place, inside the gap it fills.
                questions.append({
                    'id': f'q{i + 1}', 'text': text,
                    'section': section, 'examples': examples,
                })
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


def pack_field_values(
    pack_markdown: str | None, field_map: dict[str, Any] | None,
) -> dict[str, str]:
    """Split the composed pack by section and return {azure field ref: text}.

    Headings are matched loosely (case, punctuation and numbering ignored)
    because the model writes the heading, not us. Sections with no mapping,
    or with nothing written under them, are left out."""
    if not pack_markdown or not field_map:
        return {}

    def key(s: str) -> str:
        return re.sub(r'[^0-9a-zçğıöşü]+', ' ', (s or '').lower()).strip()

    blocks: dict[str, list[str]] = {}
    current: str | None = None
    for line in pack_markdown.splitlines():
        heading = re.match(r'^#{1,4}\s+(.*)$', line.strip())
        if heading:
            current = key(heading.group(1))
            blocks.setdefault(current, [])
        elif current is not None:
            blocks[current].append(line)

    out: dict[str, str] = {}
    for section, ref in field_map.items():
        ref = str(ref or '').strip()
        if not ref:
            continue
        wanted = key(str(section))
        if not wanted:
            continue
        match = next(
            (v for k, v in blocks.items() if k and (k == wanted or wanted in k or k in wanted)),
            None,
        )
        text = '\n'.join(match or []).strip()
        text = re.sub(r'^_\(eksik\)_$', '', text, flags=re.I | re.M).strip()
        if text:
            out[ref] = text[:8000]
    return out


def _build_system_prompt(
    base: str, settings: BusinessRequestSettings | None, *,
    pack_key: str | None = None, br_type: str | None = None,
) -> str:
    sections = render_sections(org_sections(settings, pack_key=pack_key, br_type=br_type))
    text = (base or '').strip()
    if SECTIONS_TOKEN in text:
        text = text.replace(SECTIONS_TOKEN, sections)
    else:
        # A hand-edited prompt that dropped the token still needs the pack —
        # the checklist the model must return is keyed on these sections.
        text = f'{text}\n\n## Decision Pack sections\n{sections}'
    parts = [text]
    if settings is not None:
        rubric = (settings.rubric or '').strip()
        epic_rule = (settings.epic_rule or '').strip()
        if rubric:
            parts.append(f'## Sufficiency rubric (org-specific)\n{rubric}')
        if epic_rule:
            parts.append(f'## Improvement vs Epic rule (org-specific)\n{epic_rule}')
    return '\n\n'.join(parts)


def _strip_html(raw: str) -> str:
    """Azure comments come back as HTML. Flatten to text for the prompt."""
    import html as _html

    text = re.sub(r'<br\s*/?>|</p>|</div>|</li>', '\n', raw or '', flags=re.I)
    text = re.sub(r'<[^>]+>', '', text)
    text = _html.unescape(text)
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def format_comments(comments: list[dict[str, Any]] | None, limit: int = 30) -> str:
    """Oldest-first transcript of the discussion thread, trimmed for prompts.

    Azure returns newest-first; the thread reads as a conversation, so the
    model gets it in chronological order with the latest turns intact."""
    rows = list(comments or [])[:limit]
    rows.reverse()
    out: list[str] = []
    for c in rows:
        text = _strip_html(str(c.get('text') or ''))
        if not text:
            continue
        who = str(c.get('created_by') or 'bilinmiyor')
        when = str(c.get('created_at') or '')[:10]
        out.append(f'[{when}] {who}: {text}')
    return '\n'.join(out)[:8000]


def _build_user_prompt(
    *, title: str, description: str, answers: dict[str, Any] | None,
    comments: list[dict[str, Any]] | None = None, state: str | None = None,
) -> str:
    lines = [
        f'## Work item title\n{title or "(untitled)"}',
        f'## Description\n{_strip_html(description or "")[:6000] or "(empty)"}',
    ]
    if state:
        lines.append(
            f'## Workflow state\n{state}\n'
            'A request already in progress or delivered is judged the same way — '
            'report what the written request still fails to cover. Do not soften '
            'the score because work has started.'
        )
    discussion = format_comments(comments)
    if discussion:
        lines.append(
            '## Discussion thread (oldest → newest)\n'
            'Requirements are often clarified, narrowed or expanded here — treat '
            'the thread as part of the request. A later comment overrides the '
            'description when they conflict.\n' + discussion
        )
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
    sprint_path: str = '', states: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Work items assigned to the BR people. sprint_path optional: empty =
    the whole project — BRs are often pre-sprint. `states` names exactly
    which workflow states count; empty means every non-closed state.
    A member whose query/PAT fails is skipped so the rest still surface."""
    sprint_path = (sprint_path or '').strip()
    # The same state rule on both paths — a sprint filter used to smuggle in
    # closed items while the project-wide query excluded them.
    if states:
        state_clause = (
            'And [System.State] IN ('
            + ', '.join(f"'{s}'" for s in states) + ')'
        )
    else:
        state_clause = (
            'And [System.State] NOT IN ('
            + ', '.join(f"'{s}'" for s in CLOSED_STATES) + ')'
        )
    out: list[dict[str, Any]] = []
    headers = _azure_headers(pat)
    async with httpx.AsyncClient(timeout=30) as client:
        for email in emails:
            if sprint_path:
                where = (
                    f"[System.IterationPath] UNDER '{sprint_path}' "
                    f"And [System.AssignedTo] = '{email}' {state_clause}"
                )
                order = 'Order By [System.ChangedDate] Desc'
            else:
                where = (
                    f"[System.TeamProject] = '{project}' "
                    f"And [System.AssignedTo] = '{email}' {state_clause}"
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


async def upload_azure_attachment(
    *, base_url: str, pat: str, project: str, work_item_id: str,
    filename: str, data: bytes,
) -> str:
    """Upload one file and link it to the work item. Returns the Azure URL.

    Two calls, per the Azure API: store the bytes, then add an
    `AttachedFile` relation pointing at what came back."""
    headers = _azure_headers(pat)
    async with httpx.AsyncClient(timeout=60) as client:
        up = await client.post(
            f'{base_url}/{project}/_apis/wit/attachments'
            f'?fileName={httpx.QueryParams({"n": filename})["n"]}&api-version=7.1-preview.3',
            headers={**headers, 'Content-Type': 'application/octet-stream'},
            content=data,
        )
        up.raise_for_status()
        url = str((up.json() or {}).get('url') or '')
        if not url:
            raise ValueError(f'Azure returned no attachment URL for {filename}')

        patch = [{
            'op': 'add', 'path': '/relations/-',
            'value': {
                'rel': 'AttachedFile', 'url': url,
                'attributes': {'comment': 'Agena BR Intake'},
            },
        }]
        link = await client.patch(
            f'{base_url}/_apis/wit/workitems/{work_item_id}?api-version=7.1-preview.3',
            headers={**headers, 'Content-Type': 'application/json-patch+json'},
            json=patch,
        )
        link.raise_for_status()
    return url


async def fetch_azure_item(
    *, base_url: str, pat: str, work_item_id: str,
) -> dict[str, Any] | None:
    """One work item by id, in the same shape fetch_azure_items returns.

    The webhook path needs this: a service-hook payload varies by event type,
    so we take only the id from it and read the current state from Azure."""
    headers = _azure_headers(pat)
    url = (
        f'{base_url}/_apis/wit/workitems/{work_item_id}?fields='
        'System.Id,System.Title,System.State,System.WorkItemType,System.Description,'
        'System.AssignedTo,System.TeamProject,System.CreatedDate,System.ChangedDate'
        '&api-version=7.1-preview.3'
    )
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            r = await client.get(url, headers=headers)
            r.raise_for_status()
        except httpx.HTTPError:
            logger.warning('BR webhook: work item %s not readable', work_item_id)
            return None
    f = (r.json() or {}).get('fields', {})
    assigned = f.get('System.AssignedTo') or {}
    email = ''
    if isinstance(assigned, dict):
        email = str(assigned.get('uniqueName') or assigned.get('mailAddress') or '')
    project = str(f.get('System.TeamProject') or '')
    ext_id = str(f.get('System.Id') or work_item_id)
    return {
        'source': 'azure',
        'external_id': ext_id,
        'title': f.get('System.Title', '') or '',
        'state': f.get('System.State', '') or '',
        'work_item_type': f.get('System.WorkItemType', '') or '',
        'description': f.get('System.Description', '') or '',
        'created_date': f.get('System.CreatedDate', '') or '',
        'changed_date': f.get('System.ChangedDate', '') or '',
        'assignee_email': email.lower(),
        'project': project,
        'url': f'{base_url}/{project}/_workitems/edit/{ext_id}',
    }


async def fetch_azure_comments(
    *, base_url: str, pat: str, project: str, work_item_id: str,
) -> list[dict[str, Any]]:
    """Discussion thread for one work item. Best-effort: a thread we can't
    read must not block the evaluation, so failures return []."""
    from agena_services.integrations.azure_client import AzureDevOpsClient

    if not project or not work_item_id:
        return []
    try:
        return await AzureDevOpsClient().fetch_work_item_comments(
            cfg={'org_url': base_url, 'pat': pat},
            project=project,
            work_item_id=str(work_item_id),
        )
    except Exception:
        logger.warning('BR comment fetch failed for item %s', work_item_id, exc_info=True)
        return []


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

    async def _base_prompt(
        self, settings: BusinessRequestSettings | None, *,
        slug: str, org_override: str | None, fallback: str,
    ) -> str:
        """Prompt precedence: the org's own text → the system-level row in
        the `prompts` table → the constant shipped with the code."""
        from agena_services.services.prompt_service import PromptService

        if org_override and org_override.strip():
            return org_override
        try:
            db_prompt = await PromptService.get(self.db, slug)
            if db_prompt and db_prompt.strip():
                return db_prompt
        except ValueError:
            pass
        return fallback

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
        project: str | None = None,
        comments: list[dict[str, Any]] | None = None,
        state: str | None = None,
        pack_key: str | None = None,
    ) -> BusinessRequestEval:
        """Run one BR evaluation and upsert the result row.

        `comments` is the work item's discussion thread. Pass it when the
        caller already has it (the auto-scanner does); otherwise an Azure
        item's thread is fetched here — requirements are routinely
        clarified in comments rather than the description."""
        settings = await self.get_settings(organization_id)

        if comments is None and source == 'azure':
            proj = (project or (settings.azure_project if settings else '') or '').strip()
            if proj:
                try:
                    base_url, pat = await resolve_azure_creds(
                        self.db, organization_id, settings
                    )
                    comments = await fetch_azure_comments(
                        base_url=base_url, pat=pat,
                        project=proj, work_item_id=str(external_id),
                    )
                except ValueError:
                    # No usable Azure creds — evaluate on the description alone.
                    comments = None

        base = await self._base_prompt(
            settings, slug='br_evaluation_system_prompt',
            org_override=(settings.eval_prompt if settings else None),
            fallback=DEFAULT_SYSTEM_PROMPT,
        )
        # A re-evaluation keeps judging against the pack it was first scored
        # on unless the caller names one, so a score doesn't jump because the
        # classification moved between packs mid-conversation.
        chosen_pack = resolve_pack(
            settings, pack_key=pack_key, br_type=None,
        ) if pack_key else None
        system_prompt = _build_system_prompt(base, settings, pack_key=pack_key)
        user_prompt = _build_user_prompt(
            title=title, description=description, answers=answers,
            comments=comments, state=state,
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
        if state:
            existing.state = state
        existing.pack_key = (
            chosen_pack['key'] if chosen_pack
            else resolve_pack(settings, br_type=result['br_type'])['key']
        )
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
        existing.discussion_hash = discussion_fingerprint(comments)
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

    async def propose_breakdown(
        self, *, organization_id: int, row: BusinessRequestEval,
        project: str | None = None,
    ) -> BusinessRequestEval:
        """Ask the model for the delivery tree under a matured BR.

        Nothing is created in Azure here — the proposal is saved so a human
        edits it first."""
        settings = await self.get_settings(organization_id)
        if (row.readiness_score or 0) < INTAKE_SUBMIT_THRESHOLD:
            raise ValueError(
                f'Readiness {row.readiness_score or 0} is below the gate '
                f'({INTAKE_SUBMIT_THRESHOLD}) — mature the request before breaking it down.'
            )
        if row.br_type == 'not_br':
            raise ValueError('This item is not a business request, so there is nothing to break down.')

        # The checklist notes are the only record of what the pack actually
        # says for an Azure-sourced BR, so they carry the scope.
        pack = resolve_pack(settings, pack_key=row.pack_key, br_type=row.br_type)
        covered = '\n'.join(
            f'- {c.get("section")}: [{c.get("status")}] {c.get("note") or ""}'.strip()
            for c in (row.checklist or [])
        )
        answers = '\n'.join(
            f'- {k}: {v}' for k, v in (row.answers or {}).items() if str(v).strip()
        )
        parts = [
            f'## BR title\n{row.title or "(untitled)"}',
            f'## Classification\n{row.br_type or "improvement"}',
            f'## Decision Pack ({pack["name"]}) coverage\n{covered or "(empty)"}',
        ]
        if row.reasoning:
            parts.append(f'## Evaluation reasoning\n{row.reasoning}')
        if answers:
            parts.append(f'## Stakeholder answers\n{answers}')

        base = await self._base_prompt(
            settings, slug='br_breakdown_system_prompt',
            org_override=None, fallback=DEFAULT_BREAKDOWN_SYSTEM_PROMPT,
        )
        output, usage, provider = await self._run_llm(
            organization_id=organization_id,
            system_prompt=base,
            user_prompt='\n\n'.join(parts),
            provider_override=(settings.provider if settings else None),
            model_override=(settings.model if settings else None),
            max_output_tokens=4000,
        )
        items = normalize_breakdown(
            _extract_json(output).get('items'),
            allowed=BREAKDOWN_ROOT_TYPES.get(row.br_type or 'improvement', ('User Story',)),
        )
        if not items:
            raise RuntimeError('The model returned no usable breakdown — try again.')
        row.breakdown = items
        await self.db.commit()
        await self.db.refresh(row)

        try:
            from agena_services.services.ai_usage_event_service import AIUsageEventService
            await AIUsageEventService(self.db).record_llm_usage(
                organization_id=organization_id, task_id=None,
                operation_type='br_breakdown', provider=provider,
                model=(settings.model if settings else None), usage=usage,
                details={'external_id': row.external_id, 'items': count_breakdown(items)},
            )
        except Exception:
            pass
        return row

    async def create_breakdown_in_azure(
        self, *, organization_id: int, row: BusinessRequestEval, project: str,
    ) -> BusinessRequestEval:
        """Create the saved tree in Azure, each item linked to its parent.

        Items that already carry an azure_id are skipped, so a partially
        failed run can be re-run without duplicating work."""
        if row.source != 'azure':
            raise ValueError('Creating the breakdown currently supports Azure only.')
        if not row.breakdown:
            raise ValueError('No breakdown to create — propose one first.')
        project = (project or '').strip()
        if not project:
            raise ValueError('An Azure project is required.')

        settings = await self.get_settings(organization_id)
        base_url, pat = await resolve_azure_creds(self.db, organization_id, settings)
        headers = _azure_headers(pat)
        headers['Content-Type'] = 'application/json-patch+json'
        created = 0

        async def create_one(
            client: httpx.AsyncClient, item: dict[str, Any], parent_id: str,
        ) -> None:
            nonlocal created
            if not item.get('azure_id'):
                patch: list[dict[str, Any]] = [
                    {'op': 'add', 'path': '/fields/System.Title', 'value': item['title'][:250]},
                    {'op': 'add', 'path': '/fields/System.Tags', 'value': 'BR; Agena Breakdown'},
                ]
                if item.get('description'):
                    patch.append({
                        'op': 'add', 'path': '/fields/System.Description',
                        'value': _markdown_to_html(item['description']),
                    })
                patch.append({
                    'op': 'add', 'path': '/relations/-',
                    'value': {
                        'rel': 'System.LinkTypes.Hierarchy-Reverse',
                        'url': f'{base_url}/_apis/wit/workItems/{parent_id}',
                    },
                })
                resp = await client.post(
                    f'{base_url}/{project}/_apis/wit/workitems/'
                    f'${item["type"]}?api-version=7.1-preview.3',
                    headers=headers, json=patch,
                )
                if resp.status_code >= 400:
                    detail = ''
                    try:
                        detail = (resp.json() or {}).get('message', '')
                    except ValueError:
                        detail = resp.text[:200]
                    raise ValueError(
                        f'Azure rejected {item["type"]} "{item["title"][:60]}": {detail}'
                    )
                item['azure_id'] = str((resp.json() or {}).get('id') or '')
                created += 1
            for child in item.get('children') or []:
                await create_one(client, child, item['azure_id'])

        async with httpx.AsyncClient(timeout=60) as client:
            try:
                for item in row.breakdown:
                    await create_one(client, item, str(row.external_id))
            finally:
                # Persist whatever got created, even if a later item failed —
                # otherwise a re-run duplicates the successful ones.
                row.breakdown = normalize_breakdown(
                    row.breakdown,
                    allowed=BREAKDOWN_ROOT_TYPES.get(row.br_type or 'improvement', ('User Story',)),
                )
                if created:
                    row.breakdown_created_at = datetime.utcnow()
                await self.db.commit()
                await self.db.refresh(row)
        return row

    async def push_eval_to_source(
        self, *, organization_id: int, row: BusinessRequestEval,
    ) -> BusinessRequestEval:
        """Post the evaluation's gaps back to the work item as a comment, so
        the requester sees what to fill in without opening Agena."""
        import html as _html

        if row.source != 'azure':
            raise ValueError('Pushing back to the source currently supports Azure only.')
        if not row.checklist and not row.questions:
            raise ValueError('Nothing to push — evaluate the item first.')

        settings = await self.get_settings(organization_id)
        base_url, pat = await resolve_azure_creds(self.db, organization_id, settings)

        def esc(text: Any) -> str:
            return _html.escape(str(text or '').strip())

        gaps = [
            c for c in (row.checklist or [])
            if c.get('status') in ('missing', 'partial')
        ]
        parts = [
            '<p><b>Agena — Business Request değerlendirmesi</b></p>',
            f'<p>Hazırlık puanı: <b>{row.readiness_score if row.readiness_score is not None else "-"}/100</b>'
            f' · Tip: <b>{esc(BR_TYPE_LABELS.get(row.br_type or "", row.br_type))}</b>'
            f' · Sonuç: <b>{esc(VERDICT_LABELS.get(row.verdict or "", row.verdict))}</b></p>',
        ]
        if row.reasoning:
            parts.append(f'<p>{esc(row.reasoning)}</p>')
        if gaps:
            parts.append('<p><b>Eksik veya yetersiz bölümler</b></p><ul>')
            for c in gaps:
                mark = 'eksik' if c.get('status') == 'missing' else 'kısmen var'
                note = f' — {esc(c.get("note"))}' if c.get('note') else ''
                parts.append(f'<li><b>{esc(c.get("section"))}</b> ({mark}){note}</li>')
            parts.append('</ul>')
        questions = [q for q in (row.questions or []) if str(q.get('text') or '').strip()]
        if questions:
            parts.append('<p><b>Netleştirilmesi gerekenler</b></p><ul>')
            for q in questions:
                parts.append(f'<li>{esc(q.get("text"))}</li>')
            parts.append('</ul>')

        from agena_services.integrations.azure_client import AzureDevOpsClient
        await AzureDevOpsClient().post_raw_html_comment(
            cfg={'org_url': base_url, 'pat': pat},
            work_item_id=str(row.external_id),
            html_body='\n'.join(parts),
        )
        row.pushed_to_source_at = datetime.utcnow()
        await self.db.commit()
        await self.db.refresh(row)
        return row

    # ── Conversational intake (chat) ─────────────────────────────────

    async def intake_turn(
        self, *, intake: BusinessRequestIntake, user_text: str,
    ) -> BusinessRequestIntake:
        """One chat turn: append the user message, run the interviewer LLM,
        fold the reply + updated Decision Pack back onto the intake row."""
        settings = await self.get_settings(intake.organization_id)

        base = await self._base_prompt(
            settings, slug='br_intake_system_prompt',
            org_override=(settings.intake_prompt if settings else None),
            fallback=DEFAULT_INTAKE_SYSTEM_PROMPT,
        )
        system_prompt = _build_system_prompt(base, settings, pack_key=intake.pack_key)

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
            # A question per open section plus the full pack — a tight budget
            # here truncates the JSON and the whole turn is lost.
            max_output_tokens=4500,
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
        # Sections the org mapped to Azure custom fields are written there as
        # well, so the BR is filterable and reportable in Azure rather than
        # living only inside one description blob.
        for ref, value in pack_field_values(
            intake.pack_markdown, (settings.azure_field_map if settings else None),
        ).items():
            patch.append({'op': 'add', 'path': f'/fields/{ref}', 'value': value})
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

        # Carry the requester's screenshots onto the work item. Best-effort:
        # the BR itself is already created, so a failed upload must not undo it.
        if ext_id:
            from pathlib import Path as _Path

            from agena_models.models.business_request_attachment import (
                BusinessRequestIntakeAttachment,
            )
            files = (
                await self.db.execute(
                    select(BusinessRequestIntakeAttachment).where(
                        BusinessRequestIntakeAttachment.intake_id == intake.id
                    )
                )
            ).scalars().all()
            for att in files:
                try:
                    att.azure_url = await upload_azure_attachment(
                        base_url=base_url, pat=pat, project=project,
                        work_item_id=ext_id, filename=att.filename,
                        data=_Path(att.storage_path).read_bytes(),
                    )
                except Exception:
                    logger.warning(
                        'BR intake %s: attachment %s not uploaded to work item %s',
                        intake.id, att.filename, ext_id, exc_info=True,
                    )

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


def extract_webhook_item_id(payload: dict[str, Any]) -> str:
    """The work item id out of an Azure DevOps service-hook body.

    The shape moves around by event type — workitem.created carries it on
    `resource.id`, workitem.updated on `resource.workItemId`, and the comment
    events nest it under `resource.workItemId` or the comment's parent url —
    so every known spot is checked rather than assuming one."""
    resource = payload.get('resource') or {}
    if not isinstance(resource, dict):
        return ''
    for key in ('workItemId', 'id'):
        value = resource.get(key)
        if isinstance(value, (int, str)) and str(value).strip().isdigit():
            return str(value).strip()
    # Comment events: .../workItems/12345/comments/6
    match = re.search(r'/workItems/(\d+)', str(resource.get('url') or ''), re.I)
    return match.group(1) if match else ''


async def handle_azure_webhook(db: AsyncSession, *, token: str, payload: dict[str, Any]) -> str:
    """Evaluate the work item an Azure service hook just told us about.

    Returns a short status string for the log/response. Everything that is
    simply "not for us" (unknown token, item outside the BR team) is a quiet
    no-op — a service hook fires for every item in the project, and Azure
    disables a hook that keeps erroring."""
    cfg = (
        await db.execute(
            select(BusinessRequestSettings).where(
                BusinessRequestSettings.webhook_token == token
            )
        )
    ).scalar_one_or_none()
    if cfg is None:
        return 'unknown token'
    if not await _module_enabled_orgs(db, [cfg.organization_id]):
        return 'module disabled'

    item_id = extract_webhook_item_id(payload)
    if not item_id:
        return 'no work item id in payload'

    base_url, pat = await resolve_azure_creds(db, cfg.organization_id, cfg)
    item = await fetch_azure_item(base_url=base_url, pat=pat, work_item_id=item_id)
    if item is None:
        return f'work item {item_id} not readable'

    emails = {e.strip().lower() for e in (cfg.br_emails or []) if e}
    if item['assignee_email'] not in emails:
        # Assigned to someone outside the BR team — not our queue.
        return f'work item {item_id} not assigned to the BR team'
    if not state_allowed(cfg, item['state']):
        # The hook fires on every state change; only the states the org
        # includes in its queue are scored.
        return f'work item {item_id} is in state {item["state"]}, which is out of scope'

    existing = (
        await db.execute(
            select(BusinessRequestEval).where(
                BusinessRequestEval.organization_id == cfg.organization_id,
                BusinessRequestEval.source == 'azure',
                BusinessRequestEval.external_id == item_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None and existing.status in ('accepted', 'rejected'):
        return f'work item {item_id} already settled'

    comments = await fetch_azure_comments(
        base_url=base_url, pat=pat,
        project=item['project'], work_item_id=item_id,
    )
    # Nothing changed since the last scoring — a state flip or a field edit
    # that doesn't touch the request itself shouldn't burn an LLM call.
    if (
        existing is not None
        and existing.content_hash == content_fingerprint(item['title'], item['description'])
        and existing.discussion_hash == discussion_fingerprint(comments)
    ):
        return f'work item {item_id} unchanged'

    is_new = existing is None
    prev_score = existing.readiness_score if existing else None
    row = await BRManagementService(db).evaluate_item(
        organization_id=cfg.organization_id,
        source='azure',
        external_id=item_id,
        title=item['title'],
        description=item['description'],
        assignee_email=item['assignee_email'],
        answers=(existing.answers if existing else None),
        project=item['project'],
        comments=comments,
        state=item.get('state'),
        pack_key=(existing.pack_key if existing else None),
    )
    if is_new or prev_score != row.readiness_score:
        await _notify_eval(
            db, organization_id=cfg.organization_id,
            user_id=await _org_owner_user_id(db, cfg.organization_id),
            item=item, row=row, is_new=is_new, prev_score=prev_score,
        )
    return f'work item {item_id} evaluated: {row.readiness_score}'


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
        states=included_states(cfg),
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
    project = (cfg.azure_project or '').strip()
    for item in items:
        key = (item['source'], item['external_id'])
        existing = eval_map.get(key)
        # Accepted/rejected items are settled — don't churn them on edits.
        if existing is not None and existing.status in ('accepted', 'rejected'):
            continue
        fingerprint = content_fingerprint(item['title'], item['description'])
        text_changed = existing is None or existing.content_hash != fingerprint
        # A needs_info item is waiting on answers, and answers arrive as
        # comments — so only for those do we pay for a thread fetch when the
        # description itself is unchanged.
        awaiting_answers = existing is not None and existing.verdict == 'needs_info'
        if not text_changed and not awaiting_answers:
            continue
        comments = await fetch_azure_comments(
            base_url=base_url, pat=pat,
            project=project, work_item_id=item['external_id'],
        )
        if not text_changed and existing.discussion_hash == discussion_fingerprint(comments):
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
                comments=comments,
                state=item.get('state'),
                pack_key=(existing.pack_key if existing else None),
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
