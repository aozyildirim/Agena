from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import tempfile
from pathlib import Path
from typing import Any

from crewai import Agent, Crew, LLM, Process, Task
from pydantic import BaseModel, Field

from agents.prompts import (
    AI_CODE_SYSTEM_PROMPT,
    AI_PLAN_SYSTEM_PROMPT,
    DEV_DIRECT_SYSTEM_PROMPT,
    DEV_SYSTEM_PROMPT,
    FETCH_CONTEXT_SYSTEM_PROMPT,
    FINALIZE_SYSTEM_PROMPT,
    PM_SYSTEM_PROMPT,
    REVIEWER_SYSTEM_PROMPT,
)
from services.llm.provider import LLMProvider

logger = logging.getLogger(__name__)

# Centralized output token limits per agent role.
# Adjust these values to control max generation length for each step.
# See docs/ai-pipeline.md for documentation.
AGENT_TOKEN_LIMITS: dict[str, int] = {
    # --- Core pipeline (orchestration_service / crewai_agents) ---
    'context': 2_000,        # fetch_context: memory & context summary
    'pm': 16_000,            # product manager: spec/analysis JSON
    'planner': 8_000,        # AI planner: plan + file list JSON
    'developer': 128_000,    # developer: code patches (ai & flow mode)
    'reviewer': 128_000,     # reviewer: reviewed patches
    'finalizer': 128_000,    # finalizer: cleaned final output
    # --- Flow executor & misc ---
    'flow_node': 8_000,      # generic flow LLM nodes
    'agent_node': 2_000,     # generic agent nodes in flows
    'pr_review': 4_000,      # PR review comments
    'agent_test': 2_000,     # agent test/preview from settings
}


class FileChangeOutput(BaseModel):
    file: str = ''
    description: str = ''


class ProductManagerOutput(BaseModel):
    goal: str = ''
    requirements: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list)
    technical_notes: list[str] = Field(default_factory=list)
    file_changes: list[FileChangeOutput] = Field(default_factory=list)


class AIPlanOutput(BaseModel):
    plan: str = ''
    files: list[str] = Field(default_factory=list)
    changes: list[FileChangeOutput] = Field(default_factory=list)


class CrewAIAgentRunner:
    def __init__(self, llm_provider: LLMProvider | None = None) -> None:
        self.llm = llm_provider or LLMProvider()

    async def fetch_context(self, task_payload: dict[str, str], memory_context: list[dict[str, Any]]) -> tuple[str, dict[str, int], str]:
        prompt = (
            f'Task title: {task_payload.get("title", "")}\n'
            f'Task description: {task_payload.get("description", "")}\n'
            f'Memory context: {json.dumps(memory_context, indent=2)}\n'
            'Return concise context guidance.'
        )
        content, usage, model, _ = await self._run_with_crewai_or_llm(
            role='Context Analyst',
            goal='Summarize memory and repository context into short guidance for the next agent.',
            system_prompt=FETCH_CONTEXT_SYSTEM_PROMPT,
            user_prompt=prompt,
            expected_output='A concise text summary with implementation-relevant context only.',
            complexity_hint='simple',
            max_output_tokens=AGENT_TOKEN_LIMITS['context'],
        )
        return content, usage, model

    async def run_product_manager(self, task_payload: dict[str, str], context_summary: str) -> tuple[dict[str, Any], dict[str, int], str]:
        prompt = (
            'Task details:\n'
            f"ID: {task_payload.get('id', '')}\n"
            f"Title: {task_payload.get('title', '')}\n"
            f"Description: {task_payload.get('description', '')}\n\n"
            f'Context and source files:\n{context_summary}\n\n'
            'Analyze the source files above carefully. Identify which files and structs/functions need changes.'
        )
        content, usage, model, structured = await self._run_with_crewai_or_llm(
            role='Product Manager Agent',
            goal='Analyze tasks and generate a structured specification with file-level change plan.',
            system_prompt=PM_SYSTEM_PROMPT,
            user_prompt=prompt,
            expected_output=(
                'Return valid JSON with keys: goal, requirements, acceptance_criteria, '
                'technical_notes, file_changes.'
            ),
            complexity_hint='normal',
            max_output_tokens=AGENT_TOKEN_LIMITS['pm'],
            structured_output=ProductManagerOutput,
            reasoning=True,
        )
        spec = structured or self._safe_json(content)
        return spec, usage, model

    async def run_ai_plan(
        self,
        task_title: str,
        task_description: str,
        agents_md: str,
        task_images: list[str] | None = None,
    ) -> tuple[dict[str, Any], dict[str, int], str]:
        prompt = (
            f'TASK: {task_title}\n'
            f'DESCRIPTION: {task_description}\n\n'
            f'REPOSITORY GUIDE:\n{agents_md}\n\n'
            'Analyze the task and return JSON with: plan, files, changes.'
        )
        content, usage, model, structured = await self._run_with_crewai_or_llm(
            role='AI Planner',
            goal='Plan implementation changes for a task against the current repository state.',
            system_prompt=AI_PLAN_SYSTEM_PROMPT,
            user_prompt=prompt,
            expected_output='Return valid JSON with keys: plan, files, changes.',
            complexity_hint='high',
            max_output_tokens=AGENT_TOKEN_LIMITS['planner'],
            image_inputs=task_images,
            structured_output=AIPlanOutput,
            multimodal=bool(task_images),
            reasoning=True,
        )
        return (structured or self._safe_json(content)), usage, model

    async def run_ai_code(
        self,
        task_title: str,
        task_description: str,
        plan: dict[str, Any],
        file_contents: str,
        task_images: list[str] | None = None,
    ) -> tuple[str, dict[str, int], str]:
        changes_text = ''
        for c in plan.get('changes', []):
            if isinstance(c, dict):
                changes_text += f'- {c.get("file","")}: {c.get("description","")}\n'
            else:
                changes_text += f'- {c}\n'

        file_list = '\n'.join(
            f'  - {c.get("file","") if isinstance(c, dict) else c}'
            for c in plan.get('changes', [])
        )
        prompt = (
            f'TASK: {task_title}\n'
            f'DESCRIPTION: {task_description}\n\n'
            f'IMPLEMENTATION PLAN:\n{plan.get("plan", "")}\n\n'
            f'CHANGES TO MAKE:\n{changes_text}\n\n'
            f'SOURCE FILES TO MODIFY:\n{file_contents}\n\n'
            f'CRITICAL REQUIREMENT: You MUST produce a **File: path** + ``` patch block for EVERY file listed below. '
            f'Do NOT stop after the first file. Do NOT skip any file. '
            f'There are {len(plan.get("changes", []))} files that need changes:\n{file_list}\n\n'
            f'Output a separate **File: path** block for EACH of the {len(plan.get("changes", []))} files above.'
        )
        content, usage, model, _ = await self._run_with_crewai_or_llm(
            role='Developer Agent',
            goal='Implement planned code changes with minimal, accurate patches.',
            system_prompt=AI_CODE_SYSTEM_PROMPT,
            user_prompt=prompt,
            expected_output='Patch output only, using **File: path** blocks and fenced patch sections.',
            complexity_hint='high',
            max_output_tokens=AGENT_TOKEN_LIMITS['developer'],
            skip_cache=True,
            image_inputs=task_images,
            multimodal=bool(task_images),
            reasoning=True,
        )
        return content, usage, model

    async def run_developer(
        self,
        spec: dict[str, Any],
        context_summary: str,
        task_description: str = '',
        target_files_context: str = '',
        direct_mode: bool = False,
    ) -> tuple[str, dict[str, int], str]:
        prompt = (
            'Use this specification to generate code:\n'
            f'{json.dumps(spec, indent=2)}\n\n'
        )
        if target_files_context:
            prompt += f'{target_files_context}\n\n'
        prompt += (
            'IMPORTANT: Modify the EXISTING source files shown above. '
            'Return **File: relative/path.ext** blocks with fenced code.\n'
        )
        content, usage, model, _ = await self._run_with_crewai_or_llm(
            role='Developer Agent',
            goal='Generate production-ready code from a specification.',
            system_prompt=DEV_DIRECT_SYSTEM_PROMPT if direct_mode else DEV_SYSTEM_PROMPT,
            user_prompt=prompt,
            expected_output='Code output only, using **File: relative/path.ext** blocks.',
            complexity_hint='high',
            max_output_tokens=AGENT_TOKEN_LIMITS['developer'],
            skip_cache=True,
            reasoning=True,
        )
        return content, usage, model

    async def run_reviewer(self, generated_code: str, spec: dict[str, Any], context_summary: str = '') -> tuple[str, dict[str, int], str]:
        prompt = (
            'Review and improve this generated code according to the specification.\n'
            'IMPORTANT: Keep the **File: path** markers and fenced code blocks in your output.\n\n'
            f'Specification:\n{json.dumps(spec, indent=2)}\n\n'
            f'Context:\n{context_summary}\n\n'
            f'Generated code:\n{generated_code}\n'
        )
        content, usage, model, _ = await self._run_with_crewai_or_llm(
            role='Reviewer Agent',
            goal='Review and improve generated code quality and correctness.',
            system_prompt=REVIEWER_SYSTEM_PROMPT,
            user_prompt=prompt,
            expected_output='Return corrected **File: path** patch blocks only.',
            complexity_hint='normal',
            max_output_tokens=AGENT_TOKEN_LIMITS['reviewer'],
            reasoning=True,
        )
        return content, usage, model

    async def finalize(self, reviewed_code: str) -> tuple[str, dict[str, int], str]:
        prompt = (
            'Normalize and clean this code output for final commit.\n'
            'CRITICAL: You MUST preserve all **File: path** markers and fenced code blocks exactly.\n'
            'If the input already has proper **File: path** + code blocks, return them as-is.\n'
            'Do NOT remove code or replace it with commentary.\n\n'
            f'{reviewed_code}'
        )
        content, usage, model, _ = await self._run_with_crewai_or_llm(
            role='Finalize Agent',
            goal='Prepare final code artifacts for git commit.',
            system_prompt=FINALIZE_SYSTEM_PROMPT,
            user_prompt=prompt,
            expected_output='Return final **File: path** blocks only.',
            complexity_hint='simple',
            max_output_tokens=AGENT_TOKEN_LIMITS['finalizer'],
        )
        return content, usage, model

    async def _run_with_crewai_or_llm(
        self,
        role: str,
        goal: str,
        system_prompt: str,
        user_prompt: str,
        expected_output: str,
        complexity_hint: str,
        max_output_tokens: int = 2500,
        skip_cache: bool = False,
        image_inputs: list[str] | None = None,
        structured_output: type[BaseModel] | None = None,
        multimodal: bool = False,
        reasoning: bool = False,
    ) -> tuple[str, dict[str, int], str, dict[str, Any] | None]:
        selected_model = self._select_model(complexity_hint)
        crewai_model = self._normalize_crewai_model(selected_model)
        materialized_images = self._materialize_image_inputs(image_inputs)

        try:
            llm = self._build_crewai_llm(crewai_model, max_output_tokens, complexity_hint)
            agent_kwargs: dict[str, Any] = {
                'role': role,
                'goal': goal,
                'backstory': (
                    f'You are {role} inside Tiqr. '
                    'Follow the provided system instructions exactly and return only the requested output.'
                ),
                'llm': llm,
                'verbose': False,
                'allow_delegation': False,
                'respect_context_window': True,
            }
            if multimodal and materialized_images:
                agent_kwargs['multimodal'] = True
            if reasoning:
                agent_kwargs['reasoning'] = True
                agent_kwargs['max_reasoning_attempts'] = 2
            agent = Agent(**agent_kwargs)

            task_kwargs: dict[str, Any] = {
                'description': self._compose_task_description(system_prompt, user_prompt, materialized_images),
                'expected_output': expected_output,
                'agent': agent,
                'markdown': False,
            }
            if structured_output is not None:
                task_kwargs['output_json'] = structured_output
            task = Task(**task_kwargs)

            crew = Crew(
                agents=[agent],
                tasks=[task],
                process=Process.sequential,
                planning=False,
                verbose=False,
            )
            result = await crew.kickoff_async()
            content = self._extract_raw_output(result)
            usage = self._extract_usage(result)
            structured = self._extract_structured_output(result)
            return content, usage, selected_model, structured
        except Exception as exc:
            logger.warning('CrewAI runtime failed for %s, falling back to direct LLM: %s', role, exc)
            content, usage, model, _ = await self.llm.generate(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                complexity_hint=complexity_hint,
                max_output_tokens=max_output_tokens,
                skip_cache=skip_cache,
                image_inputs=image_inputs,
            )
            return content, usage, model, None

    def _select_model(self, complexity_hint: str) -> str:
        if complexity_hint in {'simple', 'low'}:
            return self.llm.small_model
        return self.llm.large_model

    def _normalize_crewai_model(self, model: str) -> str:
        normalized = (model or '').strip()
        if not normalized:
            return normalized
        if '/' in normalized:
            return normalized
        provider = (self.llm.provider or 'openai').strip().lower()
        if provider in {'openai', 'gemini'}:
            return f'{provider}/{normalized}'
        return normalized

    def _build_crewai_llm(self, crewai_model: str, max_output_tokens: int, complexity_hint: str) -> LLM:
        kwargs: dict[str, Any] = {
            'model': crewai_model,
            'api_key': self.llm.api_key or None,
            'base_url': self.llm.base_url or None,
            'max_completion_tokens': max_output_tokens,
            'max_tokens': max_output_tokens,
        }
        if 'codex' not in crewai_model and '/o1' not in crewai_model and '/o3' not in crewai_model:
            kwargs['temperature'] = 0.2
        if crewai_model.startswith('openai/'):
            kwargs['api'] = 'responses'
        if any(token in crewai_model for token in ('gpt-5', 'codex', '/o1', '/o3')):
            kwargs['reasoning_effort'] = 'high' if complexity_hint == 'high' else 'medium'
        return LLM(**kwargs)

    def _compose_task_description(self, system_prompt: str, user_prompt: str, image_inputs: list[str]) -> str:
        parts = [
            f'SYSTEM INSTRUCTIONS:\n{system_prompt.strip()}',
            f'TASK INPUT:\n{user_prompt.strip()}',
        ]
        if image_inputs:
            image_lines = '\n'.join(f'- Analyze the image at {item}' for item in image_inputs)
            parts.append(
                'VISUAL INPUTS:\n'
                f'{image_lines}\n'
                'Use these images to identify service names, routes, labels, and UI details when relevant.'
            )
        return '\n\n'.join(parts)

    def _materialize_image_inputs(self, image_inputs: list[str] | None) -> list[str]:
        if not image_inputs:
            return []

        result: list[str] = []
        tmp_dir = Path(tempfile.gettempdir()) / 'tiqr-crewai-images'
        tmp_dir.mkdir(parents=True, exist_ok=True)

        for raw in image_inputs:
            value = str(raw or '').strip()
            if not value:
                continue
            if not value.startswith('data:image/'):
                result.append(value)
                continue
            try:
                header, encoded = value.split(',', 1)
                mime = header.split(';', 1)[0]
                ext = mime.split('/', 1)[1] if '/' in mime else 'png'
                digest = hashlib.sha256(value.encode('utf-8')).hexdigest()[:24]
                out = tmp_dir / f'{digest}.{ext}'
                if not out.exists():
                    out.write_bytes(base64.b64decode(encoded))
                result.append(str(out))
            except Exception as exc:
                logger.warning('Failed to materialize task image for CrewAI: %s', exc)
        return result

    def _extract_raw_output(self, result: Any) -> str:
        raw = getattr(result, 'raw', None)
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
        tasks_output = getattr(result, 'tasks_output', None) or []
        if tasks_output:
            task_raw = getattr(tasks_output[-1], 'raw', None)
            if isinstance(task_raw, str):
                return task_raw.strip()
        return str(result).strip()

    def _extract_structured_output(self, result: Any) -> dict[str, Any] | None:
        candidates = [
            getattr(result, 'pydantic', None),
            getattr(result, 'json_dict', None),
        ]
        tasks_output = getattr(result, 'tasks_output', None) or []
        if tasks_output:
            candidates.extend([
                getattr(tasks_output[-1], 'pydantic', None),
                getattr(tasks_output[-1], 'json_dict', None),
            ])

        for candidate in candidates:
            if candidate is None:
                continue
            if hasattr(candidate, 'model_dump'):
                return candidate.model_dump()
            if isinstance(candidate, dict):
                return candidate
        return None

    def _extract_usage(self, result: Any) -> dict[str, int]:
        usage = getattr(result, 'token_usage', None) or {}
        if not usage and hasattr(result, 'usage_metrics'):
            usage = getattr(result, 'usage_metrics', None) or {}

        prompt_tokens = 0
        completion_tokens = 0
        total_tokens = 0

        if isinstance(usage, dict):
            prompt_tokens = int(usage.get('prompt_tokens', usage.get('input_tokens', 0)) or 0)
            completion_tokens = int(usage.get('completion_tokens', usage.get('output_tokens', 0)) or 0)
            total_tokens = int(usage.get('total_tokens', 0) or 0)
        else:
            prompt_tokens = int(getattr(usage, 'prompt_tokens', getattr(usage, 'input_tokens', 0)) or 0)
            completion_tokens = int(getattr(usage, 'completion_tokens', getattr(usage, 'output_tokens', 0)) or 0)
            total_tokens = int(getattr(usage, 'total_tokens', 0) or 0)

        if total_tokens <= 0:
            total_tokens = prompt_tokens + completion_tokens
        return {
            'prompt_tokens': prompt_tokens,
            'completion_tokens': completion_tokens,
            'total_tokens': total_tokens,
        }

    def _safe_json(self, content: str) -> dict[str, Any]:
        text = content.strip()
        if text.startswith('```'):
            text = re.sub(r'^```[a-zA-Z]*\n?', '', text)
            text = re.sub(r'\n?```$', '', text.rstrip())
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r'\{.*\}', text, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    pass
            return {
                'goal': 'Implement the requested task',
                'requirements': [content],
                'acceptance_criteria': ['Code compiles and follows best practices'],
                'technical_notes': [],
            }
