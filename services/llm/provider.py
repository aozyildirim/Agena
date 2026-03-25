from __future__ import annotations

import json
import re
from typing import Any

import httpx
from openai import AsyncOpenAI

from core.settings import get_settings
from services.llm.cache import PromptCache

# Reasoning models that do not support the temperature parameter
_NO_TEMP_PATTERNS = {'o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini', 'o3-pro', 'codex'}


def _skip_temperature(model: str) -> bool:
    m = model.lower()
    for pat in _NO_TEMP_PATTERNS:
        if pat in m:
            return True
    return False


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
        import os
        _ssl_verify = os.getenv('SSL_VERIFY', 'true').strip().lower() not in ('false', '0', 'no')
        self.client = (
            AsyncOpenAI(api_key=self.api_key, base_url=self.base_url, http_client=httpx.AsyncClient(verify=_ssl_verify))
            if self.provider == 'openai'
            else None
        )

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        complexity_hint: str = 'normal',
        max_output_tokens: int = 2500,
        skip_cache: bool = False,
    ) -> tuple[str, dict[str, int], str, bool]:
        raw_key = (self.api_key or '').strip()
        if not raw_key or raw_key.startswith('your_'):
            output = self._mock_output(system_prompt=system_prompt, user_prompt=user_prompt)
            usage = {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0}
            return output, usage, 'mock-local', True

        model = self._select_model(complexity_hint)
        truncated_user = self._truncate(user_prompt)
        cache_key = self.cache.build_key(model=model, system_prompt=system_prompt, user_prompt=truncated_user)
        cached = await self.cache.get(cache_key) if not skip_cache else None
        if cached:
            cached_output = (cached.get('output', '') or '').strip()
            if cached_output:
                usage = cached.get('usage', {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0})
                return cached_output, usage, model, True

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
            kwargs: dict[str, Any] = {
                'model': model,
                'input': [
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': truncated_user},
                ],
                'max_output_tokens': max_output_tokens,
            }
            if not _skip_temperature(model):
                kwargs['temperature'] = 0.2
            response = await self.client.responses.create(**kwargs)
            output = self._extract_openai_output_text(response)
            usage = self._parse_usage(response)
            if not output.strip():
                try:
                    fallback_output, fallback_usage = await self._generate_openai_chat_fallback(
                        model=model,
                        system_prompt=system_prompt,
                        user_prompt=truncated_user,
                        max_output_tokens=max_output_tokens,
                    )
                    if fallback_output.strip():
                        output = fallback_output
                        usage = fallback_usage
                except Exception:
                    pass  # chat completions not available for this model
        # Cache meaningful outputs (code blocks, JSON specs, substantial text)
        # Skip caching refusals, empty outputs, and skip_cache calls
        if not skip_cache:
            stripped = output.strip()
            is_refusal = stripped.lower().startswith("i'm sorry") or stripped.lower().startswith("i can't")
            if stripped and len(stripped) > 50 and not is_refusal:
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

    def _extract_openai_output_text(self, response: Any) -> str:
        text = (getattr(response, 'output_text', '') or '').strip()
        if text:
            return text

        chunks: list[str] = []
        outputs = getattr(response, 'output', None) or []
        for item in outputs:
            content_items = getattr(item, 'content', None) or []
            for content in content_items:
                ctype = getattr(content, 'type', '')
                if ctype == 'output_text':
                    ctext = getattr(content, 'text', None)
                    if ctext:
                        chunks.append(str(ctext))
                    continue
                # SDK object may expose text directly even when type differs.
                ctext = getattr(content, 'text', None)
                if ctext:
                    chunks.append(str(ctext))
        return '\n'.join(chunks).strip()

    async def _generate_openai_chat_fallback(
        self,
        *,
        model: str,
        system_prompt: str,
        user_prompt: str,
        max_output_tokens: int,
    ) -> tuple[str, dict[str, int]]:
        if self.client is None:
            return '', {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0}
        chat_kwargs: dict[str, Any] = {
            'model': model,
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
            'max_tokens': max_output_tokens,
        }
        if not _skip_temperature(model):
            chat_kwargs['temperature'] = 0.2
        chat = await self.client.chat.completions.create(**chat_kwargs)
        text = ''
        if chat.choices:
            msg = chat.choices[0].message
            text = (msg.content or '').strip()
        usage_obj = getattr(chat, 'usage', None)
        usage = {
            'prompt_tokens': int(getattr(usage_obj, 'prompt_tokens', 0) or 0),
            'completion_tokens': int(getattr(usage_obj, 'completion_tokens', 0) or 0),
            'total_tokens': int(getattr(usage_obj, 'total_tokens', 0) or 0),
        }
        return text, usage

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
