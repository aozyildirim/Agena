from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class MemoryStore(ABC):
    @abstractmethod
    async def upsert_memory(self, key: str, input_text: str, output_text: str) -> None:
        raise NotImplementedError

    @abstractmethod
    async def search_similar(self, query: str, limit: int = 3) -> list[dict[str, Any]]:
        raise NotImplementedError
