"""Distil a completed task into a reusable Skill.

Runs fire-and-forget after a task reaches status='completed'. Uses the
existing LLM provider + structured output to summarise the solution in
a way future tasks can reuse. Failures are logged and swallowed — skill
extraction is a convenience, not a hard requirement for task completion.
"""
from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import select

from agena_agents.agents.crewai_agents import CrewAIAgentRunner
from agena_core.database import SessionLocal
from agena_models.models.integration_config import IntegrationConfig
from agena_models.models.run_record import RunRecord
from agena_models.models.skill import Skill
from agena_models.models.task_record import TaskRecord
from agena_models.schemas.skill import SkillCreate
from agena_services.services.llm.provider import LLMProvider
from agena_services.services.skill_service import SkillService

logger = logging.getLogger(__name__)


class _ExtractedSkill(BaseModel):
    name: str = ''
    description: str = ''
    pattern_type: str = 'other'
    tags: list[str] = Field(default_factory=list)
    approach_summary: str = ''
    prompt_fragment: str = ''
    confidence: int = 0  # 0-100 — below ~50 we skip creating a skill


_EXTRACTION_SYSTEM = (
    'You distil completed software engineering tasks into reusable patterns '
    '("skills") for an agent knowledge base. Goal: when a NEW task arrives '
    'that resembles a past one, the agent can pull the right skill and '
    'apply the approach without rediscovering it.\n\n'
    'Rules:\n'
    '- Do not copy task-specific details (ticket IDs, customer names, exact '
    'error messages). Extract the generalisable pattern.\n'
    '- Name must be a short imperative action (e.g. "Add noindex to 404 '
    'pages", "Retry flaky import job with jitter").\n'
    '- pattern_type: one of fix-bug, refactor, add-feature, config, '
    'migration, perf, test, docs, other.\n'
    '- tags: 2-5 short free-form keywords (lowercased).\n'
    '- approach_summary: 2-3 concise sentences explaining how the problem '
    'was solved — file paths / function names are fine, exact strings less '
    'so. This is the payload future agents see.\n'
    '- prompt_fragment: a directly usable bullet-form directive the agent '
    'can follow. If the task was too trivial or too unique to generalise, '
    'set confidence below 50 and keep prompt_fragment empty.\n'
    '- Language: same as the task title.\n'
    'Return valid JSON only.'
)


class SkillExtractor:
    def __init__(self, db) -> None:
        self.db = db

    async def extract_from_task(
        self,
        organization_id: int,
        task_id: int,
    ) -> Skill | None:
        # Guard: one skill per source task
        existing = await self.db.execute(
            select(Skill).where(
                Skill.organization_id == organization_id,
                Skill.source_task_id == task_id,
            )
        )
        if existing.scalar_one_or_none() is not None:
            return None

        task = await self.db.get(TaskRecord, task_id)
        if task is None or task.organization_id != organization_id:
            return None
        if (task.status or '').strip().lower() != 'completed':
            return None

        # Surface PR title / changed files as context so the LLM can spot
        # the actual code-level pattern, not just the PM's description.
        pr_url = task.pr_url or ''
        branch = task.branch_name or ''
        # Pull the last run record for this task (if any) so we can include
        # stage summaries in the context.
        run_ctx = ''
        try:
            run_row = (await self.db.execute(
                select(RunRecord)
                .where(RunRecord.task_id == task_id)
                .order_by(RunRecord.created_at.desc())
                .limit(1)
            )).scalar_one_or_none()
            if run_row:
                # reviewed_code is a MEDIUMTEXT containing the final accepted
                # output of the pipeline — a lot richer than the task's
                # original description for extracting what was actually done.
                if run_row.reviewed_code:
                    run_ctx = str(run_row.reviewed_code)[:2500]
        except Exception:
            pass

        user_prompt = (
            f'Task title: {task.title}\n'
            f"Description: {(task.description or '')[:2000]}\n"
            f'Status: completed\n'
            f'Branch: {branch}\n'
            f'PR: {pr_url}\n'
        )
        if run_ctx:
            user_prompt += f'\nLast run summary:\n{run_ctx}\n'

        expected_output = (
            'Return a JSON object with these keys:\n'
            '- name (string)\n'
            '- description (string)\n'
            '- pattern_type (one of fix-bug/refactor/add-feature/config/'
            'migration/perf/test/docs/other)\n'
            '- tags (array of 2-5 short strings)\n'
            '- approach_summary (string, 2-3 sentences)\n'
            '- prompt_fragment (string, directly-usable directive)\n'
            '- confidence (integer 0-100)'
        )

        # Resolve an LLM/CLI in priority order: OpenAI > Gemini > Claude
        # CLI > Codex CLI. The first one with usable credentials wins.
        provider_used = ''
        structured: _ExtractedSkill | None = None
        oa_row = (await self.db.execute(
            select(IntegrationConfig).where(
                IntegrationConfig.organization_id == organization_id,
                IntegrationConfig.provider == 'openai',
            ).limit(1)
        )).scalar_one_or_none()
        if oa_row and oa_row.secret:
            try:
                llm = LLMProvider(
                    provider='openai',
                    api_key=oa_row.secret,
                    base_url=oa_row.base_url or None,
                )
                runner = CrewAIAgentRunner(llm)
                _c, _u, _m, s = await runner.run_configured_task(
                    role='Skill Librarian',
                    goal='Distil a completed software engineering task into a reusable skill.',
                    backstory='You help a team of AI agents reuse past solutions instead of rediscovering them.',
                    system_prompt=_EXTRACTION_SYSTEM,
                    user_prompt=user_prompt,
                    expected_output=expected_output,
                    complexity_hint='normal',
                    max_output_tokens=1500,
                    structured_output=_ExtractedSkill,
                    reasoning=False,
                    skip_cache=True,
                )
                if isinstance(s, _ExtractedSkill):
                    structured = s
                    provider_used = 'openai'
            except Exception as exc:
                logger.info('OpenAI skill extraction failed for task %s: %s', task_id, exc)

        if structured is None:
            # CLI bridge fallback — claude, then codex. The bridge parses
            # the JSON-returning model output for us; we ask for plain JSON.
            cli_payload = (
                _EXTRACTION_SYSTEM
                + '\n\n--- TASK DETAILS ---\n'
                + user_prompt
                + '\n\n--- EXPECTED OUTPUT ---\n'
                + expected_output
                + '\n\nReturn JSON only, no commentary.'
            )
            for cli in ('claude', 'codex'):
                try:
                    content = await self._run_cli(cli, cli_payload)
                    parsed = self._parse_json(content)
                    if parsed:
                        structured = _ExtractedSkill(**parsed)
                        provider_used = f'{cli}_cli'
                        break
                except Exception as exc:
                    logger.info('%s CLI skill extraction failed for task %s: %s', cli, task_id, exc)

        if structured is None:
            logger.info(
                'Skill extraction skipped for task %s: no usable LLM/CLI.', task_id,
            )
            return None

        payload = structured
        if (payload.confidence or 0) < 50:
            logger.info(
                'Skill extraction for task %s skipped (confidence=%s, too unique).',
                task_id, payload.confidence,
            )
            return None
        if not (payload.name or '').strip():
            return None

        service = SkillService(self.db)
        create = SkillCreate(
            name=payload.name.strip()[:256],
            description=payload.description.strip(),
            pattern_type=(payload.pattern_type or 'other').strip().lower()[:48],
            tags=[t.strip().lower() for t in (payload.tags or []) if t and t.strip()][:10],
            approach_summary=payload.approach_summary.strip(),
            prompt_fragment=(payload.prompt_fragment or '').strip(),
            source_task_id=task_id,
        )
        skill = await service.create(organization_id, create, user_id=None)
        logger.info(
            'Skill extracted from task %s via %s: skill_id=%s name=%r confidence=%s',
            task_id, provider_used, skill.id, skill.name, payload.confidence,
        )
        return skill

    @staticmethod
    async def _run_cli(cli: str, prompt: str) -> str:
        """Call the host-side CLI bridge (claude / codex). Same pattern
        RefinementService uses. Returns the raw CLI stdout."""
        import os
        import httpx as _httpx
        bridge_url = os.getenv('CLI_BRIDGE_URL', 'http://host.docker.internal:9876')
        endpoint = 'claude' if cli == 'claude' else 'codex'
        async with _httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(f'{bridge_url}/{endpoint}', json={'prompt': prompt, 'model': 'sonnet'})
            resp.raise_for_status()
            data = resp.json()
            return str(data.get('output') or data.get('text') or '')

    @staticmethod
    def _parse_json(text: str) -> dict | None:
        """Extract the first JSON object from CLI output. CLIs sometimes
        wrap the JSON in code fences or narration."""
        import json as _json
        import re as _re
        if not text:
            return None
        # Try a fenced block first
        m = _re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, _re.DOTALL)
        candidate = m.group(1) if m else None
        if not candidate:
            # Fall back to the first balanced object
            m = _re.search(r'\{.*\}', text, _re.DOTALL)
            candidate = m.group(0) if m else None
        if not candidate:
            return None
        try:
            return _json.loads(candidate)
        except _json.JSONDecodeError:
            return None


async def run_skill_extraction_job(*, organization_id: int, task_id: int) -> None:
    """Entry point for orchestration's fire-and-forget task. Owns its own
    DB session so it doesn't piggyback on the orchestration session that
    is about to close."""
    try:
        async with SessionLocal() as session:
            extractor = SkillExtractor(session)
            await extractor.extract_from_task(organization_id, task_id)
    except Exception as exc:
        logger.exception('Skill extraction job crashed for task %s: %s', task_id, exc)


def _unused_pattern_constant_workaround() -> dict[str, Any]:
    """Placeholder to silence unused-import warnings in minimal envs."""
    return {}
