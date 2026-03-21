from __future__ import annotations

import json
import re
from typing import Any

import httpx
from openai import AsyncOpenAI

from core.settings import get_settings
from services.llm.cache import PromptCache


class LLMProvider:
    def __init__(
        self,
        provider: str = 'openai',
        api_key: str | None = None,
        base_url: str | None = None,
        small_model: str | None = None,
        large_model: str | None = None,
    ) -> None:
        self.settings = get_settings()
        self.cache = PromptCache()
        self.provider = (provider or 'openai').strip().lower()
        self.api_key = (api_key if api_key is not None else self.settings.openai_api_key).strip()
        self.base_url = (base_url if base_url is not None else self.settings.openai_base_url).strip()
        self.small_model = (small_model if small_model is not None else self.settings.llm_small_model).strip()
        self.large_model = (large_model if large_model is not None else self.settings.llm_large_model).strip()
        self.client = (
            AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)
            if self.provider == 'openai'
            else None
        )

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        complexity_hint: str = 'normal',
        max_output_tokens: int = 2500,
    ) -> tuple[str, dict[str, int], str, bool]:
        raw_key = (self.api_key or '').strip()
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

        if self.provider == 'gemini':
            output, usage = await self._generate_gemini(
                model=model,
                system_prompt=system_prompt,
                user_prompt=truncated_user,
                max_output_tokens=max_output_tokens,
            )
        else:
            if self.client is None:
                raise RuntimeError('OpenAI client is not initialized')
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
        if self.provider == 'gemini':
            base = self.small_model if complexity_hint in {'simple', 'low'} else self.large_model
            if base.startswith('gemini'):
                return base
            # If existing env is still gpt-* defaults, map safely for Gemini provider.
            return 'gemini-2.5-flash' if complexity_hint in {'simple', 'low'} else 'gemini-2.5-pro'
        if complexity_hint in {'simple', 'low'}:
            return self.small_model
        return self.large_model

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

    async def _generate_gemini(
        self,
        *,
        model: str,
        system_prompt: str,
        user_prompt: str,
        max_output_tokens: int,
    ) -> tuple[str, dict[str, int]]:
        base = self.base_url or 'https://generativelanguage.googleapis.com'
        base = re.sub(r'/+$', '', base)
        url = f'{base}/v1beta/models/{model}:generateContent?key={self.api_key}'
        payload = {
            'systemInstruction': {'parts': [{'text': system_prompt}]},
            'contents': [{'role': 'user', 'parts': [{'text': user_prompt}]}],
            'generationConfig': {'temperature': 0.2, 'maxOutputTokens': max_output_tokens},
        }
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(url, json=payload)
            r.raise_for_status()
            data = r.json()
        text_parts: list[str] = []
        for cand in data.get('candidates', []) or []:
            content = cand.get('content', {})
            for part in content.get('parts', []) or []:
                txt = part.get('text')
                if txt:
                    text_parts.append(str(txt))
        output = '\n'.join(text_parts).strip()
        usage_meta = data.get('usageMetadata', {}) or {}
        usage = {
            'prompt_tokens': int(usage_meta.get('promptTokenCount', 0) or 0),
            'completion_tokens': int(usage_meta.get('candidatesTokenCount', 0) or 0),
            'total_tokens': int(usage_meta.get('totalTokenCount', 0) or 0),
        }
        return output, usage
