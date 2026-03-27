from __future__ import annotations

import json
import logging
from typing import Any

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
            'Analyze the source files above carefully. Identify which files and structs/functions need changes. '
            'Return only valid JSON with: goal, requirements, acceptance_criteria, technical_notes, file_changes.'
        )
        content, usage, model = await self._run_with_crewai_or_llm(
            role='Product Manager Agent',
            goal='Analyze tasks and generate a structured specification with file-level change plan.',
            system_prompt=PM_SYSTEM_PROMPT,
            user_prompt=prompt,
            complexity_hint='normal',
            max_output_tokens=AGENT_TOKEN_LIMITS['pm'],
        )
        spec = self._safe_json(content)
        return spec, usage, model

    async def run_ai_plan(self, task_title: str, task_description: str, agents_md: str) -> tuple[dict[str, Any], dict[str, int], str]:
        """Step 1: Plan — agents.md + task → which files to change."""
        prompt = (
            f'TASK: {task_title}\n'
            f'DESCRIPTION: {task_description}\n\n'
            f'REPOSITORY GUIDE:\n{agents_md}\n\n'
            'Analyze the task and return JSON with: plan, files, changes.'
        )
        content, usage, model = await self._run_with_crewai_or_llm(
            role='AI Planner',
            goal='Plan implementation changes for a task.',
            system_prompt=AI_PLAN_SYSTEM_PROMPT,
            user_prompt=prompt,
            complexity_hint='high',
            max_output_tokens=AGENT_TOKEN_LIMITS['planner'],
        )
        return self._safe_json(content), usage, model

    async def run_ai_code(self, task_title: str, task_description: str, plan: dict[str, Any], file_contents: str) -> tuple[str, dict[str, int], str]:
        """Step 2: Code — plan + actual file contents → code output."""
        changes_text = ''
        for c in plan.get('changes', []):
            changes_text += f'- {c.get("file","")}: {c.get("description","")}\n'

        file_list = '\n'.join(f'  - {c.get("file","")}' for c in plan.get('changes', []))
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
        return await self._run_with_crewai_or_llm(
            role='Developer Agent',
            goal='Implement planned code changes.',
            system_prompt=AI_CODE_SYSTEM_PROMPT,
            user_prompt=prompt,
            complexity_hint='high',
            max_output_tokens=AGENT_TOKEN_LIMITS['developer'],
            skip_cache=True,
        )

    async def run_developer(self, spec: dict[str, Any], context_summary: str, task_description: str = '', target_files_context: str = '', direct_mode: bool = False) -> tuple[str, dict[str, int], str]:
        """Flow mode developer — PM already analyzed."""
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
        return await self._run_with_crewai_or_llm(
            role='Developer Agent',
            goal='Generate production-ready code from a specification.',
            system_prompt=DEV_SYSTEM_PROMPT,
            user_prompt=prompt,
            complexity_hint='high',
            max_output_tokens=AGENT_TOKEN_LIMITS['developer'],
            skip_cache=True,
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
            max_output_tokens=AGENT_TOKEN_LIMITS['reviewer'],
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
            max_output_tokens=AGENT_TOKEN_LIMITS['finalizer'],
        )

    async def _run_with_crewai_or_llm(
        self,
        role: str,
        goal: str,
        system_prompt: str,
        user_prompt: str,
        complexity_hint: str,
        max_output_tokens: int = 2500,
        skip_cache: bool = False,
    ) -> tuple[str, dict[str, int], str]:
        raw_key = (self.llm.settings.openai_api_key or '').strip()
        if not raw_key or raw_key.startswith('your_'):
            content, usage, model, _ = await self.llm.generate(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                complexity_hint=complexity_hint,
                max_output_tokens=max_output_tokens,
                skip_cache=skip_cache,
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
                skip_cache=skip_cache,
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
