"""AI Financial Manager — orchestrates data fetch + Claude API call.

Public function:
    generate_weekly_advice(db, period_start, period_end) -> Optional[str]

Returns a Telegram-ready HTML block or None if the AI call cannot be made
(missing API key, network error, empty data, etc.). Failures are logged but
never crash the report — the report goes out with or without AI.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any, Optional

import config
from bot.financial_ai.data_access import FinancialDataReader, FinancialSnapshot
from bot.financial_ai.prompt import SYSTEM_PROMPT, build_messages
from database.db import Database

logger = logging.getLogger(__name__)

# ─── Tunables ─────────────────────────────────────────────────────────────────

_MODEL = "claude-haiku-4-5-20251001"  # cheap + fast for short-form analysis
_MAX_TOKENS = 600  # ≥ 500-char output cap with safety margin
_TEMPERATURE = 0.2  # decisive, low variance
_MAX_OUTPUT_CHARS = 1200  # hard cap on what we paste into the report
_REQUEST_TIMEOUT_SECONDS = 30.0

# In-process cache: key=(start_iso, end_iso), value=(timestamp, advice_text).
# Avoids burning tokens when /report is invoked multiple times for the same week.
_CACHE_TTL_SECONDS = 60 * 60  # 1 hour
_advice_cache: dict[tuple[str, str], tuple[float, str]] = {}

# Module-level singleton — one HTTP connection pool for the lifetime of the process.
_anthropic_client: Optional[Any] = None


def _get_client(api_key: str) -> Any:
    global _anthropic_client
    if _anthropic_client is None:
        from anthropic import AsyncAnthropic
        _anthropic_client = AsyncAnthropic(api_key=api_key, timeout=_REQUEST_TIMEOUT_SECONDS)
    return _anthropic_client


def _format_period_label(start: datetime, end: datetime) -> str:
    return f"{start.strftime('%d.%m.%Y')} — {end.strftime('%d.%m.%Y')}"


def _cache_get(start: datetime, end: datetime) -> Optional[str]:
    key = (start.isoformat(), end.isoformat())
    entry = _advice_cache.get(key)
    if not entry:
        return None
    ts, text = entry
    if (time.time() - ts) > _CACHE_TTL_SECONDS:
        _advice_cache.pop(key, None)
        return None
    return text


def _cache_put(start: datetime, end: datetime, text: str) -> None:
    key = (start.isoformat(), end.isoformat())
    _advice_cache[key] = (time.time(), text)


def _snapshot_has_signal(snap: FinancialSnapshot) -> bool:
    """Skip the AI call when there's literally nothing to analyse."""
    return (
        snap.overview.sales_count > 0
        or snap.overview.expenses_gel > 0
        or snap.cashflow.cash_on_hand_gel != 0
        or snap.cashflow.accounts_receivable_gel > 0
    )


async def generate_weekly_advice(
    db: Database,
    period_start: datetime,
    period_end: datetime,
) -> Optional[str]:
    """Generate the AI Financial Manager block for a given period.

    Returns:
        Telegram-safe HTML string (already starts with the section header), or
        None if the call cannot or should not be made.
    """
    api_key = getattr(config, "ANTHROPIC_API_KEY", None)
    if not api_key:
        logger.info("ANTHROPIC_API_KEY not set — skipping AI financial analysis.")
        return None

    cached = _cache_get(period_start, period_end)
    if cached:
        return cached

    try:
        reader = FinancialDataReader(db.pool)
        snapshot = await reader.get_financial_snapshot(period_start, period_end)
    except Exception as exc:
        logger.warning("Financial snapshot failed: %s", exc)
        return None

    if not _snapshot_has_signal(snapshot):
        logger.info("Empty period — skipping AI analysis.")
        return None

    try:
        # Lazy import: keep `anthropic` an optional dependency so the bot still
        # starts on deployments that haven't installed it yet.
        from anthropic import (
            AsyncAnthropic,  # noqa: F401
            APIConnectionError,
            APITimeoutError,
            RateLimitError,
        )
    except ImportError:
        logger.warning(
            "`anthropic` package not installed — AI financial analysis unavailable."
        )
        return None

    client = _get_client(api_key)
    messages = build_messages(snapshot.to_dict(), _format_period_label(period_start, period_end))

    try:
        response = await client.messages.create(
            model=_MODEL,
            max_tokens=_MAX_TOKENS,
            temperature=_TEMPERATURE,
            system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            messages=messages,
        )
        usage = response.usage
        logger.info(
            "financial_ai tokens: in=%d out=%d cache_read=%d",
            usage.input_tokens,
            usage.output_tokens,
            getattr(usage, "cache_read_input_tokens", 0),
        )
    except RateLimitError as exc:
        logger.warning("Financial AI rate-limited: %s", exc)
        return None
    except APITimeoutError as exc:
        logger.warning("Financial AI API timeout: %s", exc)
        return None
    except APIConnectionError as exc:
        logger.warning("Financial AI API connection error: %s", exc)
        return None
    except Exception as exc:
        logger.warning("Anthropic API call failed: %s", exc)
        return None

    text_parts: list[str] = []
    for block in response.content:
        text_value = getattr(block, "text", None)
        if isinstance(text_value, str):
            text_parts.append(text_value)
    advice = "".join(text_parts).strip()
    if not advice:
        logger.warning("Anthropic returned empty content.")
        return None

    if len(advice) > _MAX_OUTPUT_CHARS:
        advice = advice[:_MAX_OUTPUT_CHARS].rstrip() + "…"

    _cache_put(period_start, period_end, advice)
    logger.info("AI financial advice generated (%d chars).", len(advice))
    return advice
