from __future__ import annotations

import os
from typing import Any

import httpx
from openai import AsyncOpenAI

from agena_core.settings import get_settings


class OpenAICompatibleClient:
    def __init__(self) -> None:
        self.settings = get_settings()
        _ssl_verify = os.getenv('SSL_VERIFY', 'true').strip().lower() not in ('false', '0', 'no')
        self.client = AsyncOpenAI(
            api_key=self.settings.openai_api_key,
            base_url=self.settings.openai_base_url,
            http_client=httpx.AsyncClient(verify=_ssl_verify),
        )

    @staticmethod
    def _skip_temperature(model: str) -> bool:
        m = model.lower()
        for pat in ('o1', 'o3', 'codex'):
            if pat in m:
                return True
        return False

    async def generate(self, system_prompt: str, user_prompt: str) -> tuple[str, dict[str, int]]:
        kwargs: dict[str, Any] = {
            'model': self.settings.llm_model,
            'input': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
        }
        if not self._skip_temperature(self.settings.llm_model):
            kwargs['temperature'] = 0.2
        response = await self.client.responses.create(**kwargs)

        output_text = getattr(response, 'output_text', '') or ''
        usage = self._parse_usage(response)
        return output_text, usage

    def _parse_usage(self, response: Any) -> dict[str, int]:
        usage = getattr(response, 'usage', None)
        if not usage:
            return {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0}
        return {
            'prompt_tokens': int(getattr(usage, 'input_tokens', 0) or 0),
            'completion_tokens': int(getattr(usage, 'output_tokens', 0) or 0),
            'total_tokens': int(getattr(usage, 'total_tokens', 0) or 0),
        }
