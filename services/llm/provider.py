from __future__ import annotations

import json
from typing import Any

from openai import AsyncOpenAI

from core.settings import get_settings
from services.llm.cache import PromptCache


class LLMProvider:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.cache = PromptCache()
        self.client = AsyncOpenAI(
            api_key=self.settings.openai_api_key,
            base_url=self.settings.openai_base_url,
        )

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        complexity_hint: str = 'normal',
        max_output_tokens: int = 2500,
    ) -> tuple[str, dict[str, int], str, bool]:
        raw_key = (self.settings.openai_api_key or '').strip()
        if not raw_key or raw_key.startswith('your_'):
            output = self._mock_output(system_prompt=system_prompt, user_prompt=user_prompt)
            usage = {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0}
            return output, usage, 'mock-local', True

        model = self._select_model(complexity_hint)
        truncated_user = self._truncate(user_prompt)
        cache_key = self.cache.build_key(model=model, system_prompt=system_prompt, user_prompt=truncated_user)
        cached = await self.cache.get(cache_key)
        if cached:
            usage = cached.get('usage', {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0})
            return cached.get('output', ''), usage, model, True

        response = await self.client.responses.create(
            model=model,
            input=[
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': truncated_user},
            ],
            max_output_tokens=max_output_tokens,
            temperature=0.2,
        )
        output = getattr(response, 'output_text', '') or ''
        usage = self._parse_usage(response)
        await self.cache.set(cache_key, {'output': output, 'usage': usage})
        return output, usage, model, False

    def _select_model(self, complexity_hint: str) -> str:
        if complexity_hint in {'simple', 'low'}:
            return self.settings.llm_small_model
        return self.settings.llm_large_model

    def _truncate(self, text: str) -> str:
        return text[: self.settings.max_context_chars]

    def _parse_usage(self, response: Any) -> dict[str, int]:
        usage = getattr(response, 'usage', None)
        if not usage:
            return {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0}
        return {
            'prompt_tokens': int(getattr(usage, 'input_tokens', 0) or 0),
            'completion_tokens': int(getattr(usage, 'output_tokens', 0) or 0),
            'total_tokens': int(getattr(usage, 'total_tokens', 0) or 0),
        }

    def _mock_output(self, system_prompt: str, user_prompt: str) -> str:
        lower_system = system_prompt.lower()
        if 'structured json spec' in lower_system or 'product manager' in lower_system:
            return json.dumps(
                {
                    'goal': 'Deliver requested backend feature',
                    'requirements': ['Implement endpoint', 'Add validation', 'Add logging'],
                    'acceptance_criteria': ['Endpoint returns 200', 'Errors handled', 'Code reviewed'],
                    'technical_notes': ['Generated via local mock mode because OPENAI_API_KEY is missing'],
                }
            )
        if 'release assistant' in lower_system or 'final clean output' in lower_system:
            return (
                '**File: generated/mock_output.py**\n'
                '```python\n'
                "def generated_feature() -> str:\n"
                "    return 'generated in mock mode'\n"
                '```\n'
            )
        return (
            '**File: generated/mock_output.py**\n'
            '```python\n'
            "def generated_feature() -> str:\n"
            "    return 'generated in mock mode'\n"
            '```\n'
        )
