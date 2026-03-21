from __future__ import annotations

from typing import Any

from openai import AsyncOpenAI

from core.settings import get_settings


class OpenAICompatibleClient:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.client = AsyncOpenAI(
            api_key=self.settings.openai_api_key,
            base_url=self.settings.openai_base_url,
        )

    async def generate(self, system_prompt: str, user_prompt: str) -> tuple[str, dict[str, int]]:
        response = await self.client.responses.create(
            model=self.settings.llm_model,
            input=[
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
            temperature=0.2,
        )

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
