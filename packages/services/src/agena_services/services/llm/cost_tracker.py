from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.usage_record import UsageRecord


# Per-million-token published list prices, matched by case-insensitive
# substring against the model identifier. Order matters — most specific
# prefixes come first so e.g. "gpt-5-mini" doesn't fall through to "gpt-5".
# Tuple shape: (substring, input_rate, cached_input_rate, output_rate).
_MODEL_PRICES: list[tuple[str, float, float, float]] = [
    # Anthropic
    ('claude-opus',      15.00, 1.50, 75.00),
    ('claude-sonnet',     3.00, 0.30, 15.00),
    ('claude-haiku',      0.80, 0.08,  4.00),
    ('opus',             15.00, 1.50, 75.00),
    ('sonnet',            3.00, 0.30, 15.00),
    ('haiku',             0.80, 0.08,  4.00),
    # OpenAI
    ('gpt-5-mini',        0.25, 0.025, 2.00),
    ('gpt-5-nano',        0.05, 0.005, 0.40),
    ('gpt-5',             1.25, 0.125, 10.00),
    ('gpt-4.1-mini',      0.40, 0.10,  1.60),
    ('gpt-4.1-nano',      0.10, 0.025, 0.40),
    ('gpt-4.1',           2.00, 0.50,  8.00),
    ('gpt-4o-mini',       0.15, 0.075, 0.60),
    ('gpt-4o',            2.50, 1.25, 10.00),
    ('o4-mini',           1.10, 0.275, 4.40),
    ('o3-mini',           1.10, 0.55,  4.40),
    ('o3',                2.00, 0.50,  8.00),
    ('o1-mini',           1.10, 0.55,  4.40),
    ('o1',               15.00, 7.50, 60.00),
    # Google
    ('gemini-2.5-pro',    1.25, 0.31, 10.00),
    ('gemini-2.5-flash',  0.30, 0.075, 2.50),
    ('gemini-1.5-pro',    1.25, 0.31,  5.00),
    ('gemini-1.5-flash',  0.075, 0.019, 0.30),
    ('gemini',            0.30, 0.075, 2.50),
]
# Fallback used when nothing matches — kept conservative-ish (close to
# gpt-4.1 / claude-sonnet midrange) so unknown models don't silently
# under-bill the way the old tier-based heuristic did.
_DEFAULT_PRICE: tuple[float, float, float] = (3.00, 0.30, 15.00)


def _lookup_price(model: str | None) -> tuple[float, float, float]:
    key = (model or '').strip().lower()
    if not key:
        return _DEFAULT_PRICE
    for sub, in_rate, cached_rate, out_rate in _MODEL_PRICES:
        if sub in key:
            return in_rate, cached_rate, out_rate
    return _DEFAULT_PRICE


class CostTracker:
    def estimate_cost_usd(
        self,
        prompt_tokens: int,
        completion_tokens: int,
        model: str,
        cached_input_tokens: int = 0,
    ) -> float:
        in_rate, cached_rate, out_rate = _lookup_price(model)
        cached = max(0, int(cached_input_tokens or 0))
        prompt = max(0, int(prompt_tokens or 0))
        fresh = max(0, prompt - cached)
        completion = max(0, int(completion_tokens or 0))
        cost = (
            fresh * in_rate
            + cached * cached_rate
            + completion * out_rate
        ) / 1_000_000.0
        return round(cost, 6)

    async def add_usage(
        self,
        db: AsyncSession,
        organization_id: int,
        task_delta: int,
        token_delta: int,
    ) -> UsageRecord:
        period = datetime.now(tz=UTC).strftime('%Y-%m')
        result = await db.execute(
            select(UsageRecord).where(
                UsageRecord.organization_id == organization_id,
                UsageRecord.period_month == period,
            )
        )
        usage = result.scalar_one_or_none()
        if usage is None:
            usage = UsageRecord(
                organization_id=organization_id,
                period_month=period,
                tasks_used=0,
                tokens_used=0,
            )
            db.add(usage)

        usage.tasks_used += task_delta
        usage.tokens_used += token_delta
        await db.commit()
        await db.refresh(usage)
        return usage
