from __future__ import annotations

import json
import logging
from typing import Any

from agents.prompts import (
    DEV_SYSTEM_PROMPT,
    FETCH_CONTEXT_SYSTEM_PROMPT,
    FINALIZE_SYSTEM_PROMPT,
    PM_SYSTEM_PROMPT,
    REVIEWER_SYSTEM_PROMPT,
)
from services.llm.provider import LLMProvider

logger = logging.getLogger(__name__)


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
        content, usage, model, _ = await self.llm.generate(
            system_prompt=FETCH_CONTEXT_SYSTEM_PROMPT,
            user_prompt=prompt,
            complexity_hint='simple',
            max_output_tokens=1200,
        )
        return content, usage, model

    async def run_product_manager(self, task_payload: dict[str, str], context_summary: str) -> tuple[dict[str, Any], dict[str, int], str]:
        prompt = (
            'Task details:\n'
            f"ID: {task_payload.get('id', '')}\n"
            f"Title: {task_payload.get('title', '')}\n"
            f"Description: {task_payload.get('description', '')}\n\n"
            f'Context and source files:\n{context_summary}\n\n'
            'Analyze the source files above carefully. Identify which files and structs/functions need changes. '
            'Return only valid JSON with: goal, requirements, acceptance_criteria, technical_notes, file_changes.'
        )
        content, usage, model = await self._run_with_crewai_or_llm(
            role='Product Manager Agent',
            goal='Analyze tasks and generate a structured specification with file-level change plan.',
            system_prompt=PM_SYSTEM_PROMPT,
            user_prompt=prompt,
            complexity_hint='normal',
            max_output_tokens=8000,
        )
        spec = self._safe_json(content)
        return spec, usage, model

    async def run_developer(self, spec: dict[str, Any], context_summary: str, task_description: str = '', target_files_context: str = '') -> tuple[str, dict[str, int], str]:
        prompt = (
            'Use this specification to generate code:\n'
            f'{json.dumps(spec, indent=2)}\n\n'
        )
        # Target files from PM spec — full file contents for modification
        if target_files_context:
            prompt += f'{target_files_context}\n\n'

        prompt += (
            'IMPORTANT: You must modify the EXISTING source files shown above. '
            'Do NOT create placeholder markdown files. Return actual code changes.\n'
            'Return complete file outputs using **File: relative/path.ext** format with fenced code blocks.\n'
            'Output the FULL updated file content, not just changed parts.'
        )
        return await self._run_with_crewai_or_llm(
            role='Developer Agent',
            goal='Generate production-ready code from a specification.',
            system_prompt=DEV_SYSTEM_PROMPT,
            user_prompt=prompt,
            complexity_hint='high',
            max_output_tokens=32000,
        )

    async def run_reviewer(self, generated_code: str, spec: dict[str, Any], context_summary: str = '') -> tuple[str, dict[str, int], str]:
        prompt = (
            'Review and improve this generated code according to the specification.\n'
            'IMPORTANT: Keep the **File: path** markers and fenced code blocks in your output.\n\n'
            f'Specification:\n{json.dumps(spec, indent=2)}\n\n'
            f'Context:\n{context_summary}\n\n'
            f'Generated code:\n{generated_code}\n'
        )
        return await self._run_with_crewai_or_llm(
            role='Reviewer Agent',
            goal='Review and improve generated code quality and correctness.',
            system_prompt=REVIEWER_SYSTEM_PROMPT,
            user_prompt=prompt,
            complexity_hint='normal',
            max_output_tokens=32000,
        )

    async def finalize(self, reviewed_code: str) -> tuple[str, dict[str, int], str]:
        prompt = (
            'Normalize and clean this code output for final commit.\n'
            'CRITICAL: You MUST preserve all **File: path** markers and fenced code blocks exactly.\n'
            'If the input already has proper **File: path** + code blocks, return them as-is.\n'
            'Do NOT remove code or replace it with commentary.\n\n'
            f'{reviewed_code}'
        )
        return await self._run_with_crewai_or_llm(
            role='Finalize Agent',
            goal='Prepare final code artifacts for git commit.',
            system_prompt=FINALIZE_SYSTEM_PROMPT,
            user_prompt=prompt,
            complexity_hint='simple',
            max_output_tokens=32000,
        )

    async def _run_with_crewai_or_llm(
        self,
        role: str,
        goal: str,
        system_prompt: str,
        user_prompt: str,
        complexity_hint: str,
        max_output_tokens: int = 2500,
    ) -> tuple[str, dict[str, int], str]:
        raw_key = (self.llm.settings.openai_api_key or '').strip()
        if not raw_key or raw_key.startswith('your_'):
            content, usage, model, _ = await self.llm.generate(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                complexity_hint=complexity_hint,
                max_output_tokens=max_output_tokens,
            )
            return content, usage, model
        try:
            from crewai import Agent, Crew, Process, Task

            agent = Agent(role=role, goal=goal, backstory='You are part of a production delivery pipeline.')
            task = Task(description=user_prompt, expected_output='High quality output', agent=agent)
            crew = Crew(agents=[agent], tasks=[task], process=Process.sequential)
            result = crew.kickoff()
            content = str(result)
            usage = {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0}
            return content, usage, 'crewai-runtime'
        except Exception as exc:
            logger.info('CrewAI execution fallback to LLM provider due to: %s', exc)
            content, usage, model, _ = await self.llm.generate(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                complexity_hint=complexity_hint,
                max_output_tokens=max_output_tokens,
            )
            return content, usage, model

    def _safe_json(self, content: str) -> dict[str, Any]:
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            return {
                'goal': 'Implement the requested task',
                'requirements': [content],
                'acceptance_criteria': ['Code compiles and follows best practices'],
                'technical_notes': [],
            }
