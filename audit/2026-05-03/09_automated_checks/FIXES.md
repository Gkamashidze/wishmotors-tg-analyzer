# Automated Checks Fixes — Copy-Paste Ready

---

## Fix #1 — Global @dp.errors() handler (bot/main.py)

```python
# bot/main.py — add after dp definition

from aiogram.types import ErrorEvent
from aiogram.exceptions import TelegramRetryAfter, TelegramBadRequest, TelegramNetworkError

@dp.errors()
async def global_error_handler(event: ErrorEvent) -> bool:
    exc = event.exception
    if isinstance(exc, TelegramRetryAfter):
        logger.warning(f"Rate limited — sleeping {exc.retry_after}s")
        await asyncio.sleep(exc.retry_after)
        return True  # retry
    if isinstance(exc, TelegramBadRequest):
        logger.warning(f"Telegram bad request: {exc}")
        return True  # swallow — message likely deleted
    if isinstance(exc, TelegramNetworkError):
        logger.error(f"Telegram network error: {exc}")
        return True
    # Unknown — log with traceback
    logger.exception(f"Unhandled exception in handler: {exc}")
    return True
```

---

## Fix #2 — Shared TelegramRetryAfter handler (bot/handlers/_utils.py)

```python
# bot/handlers/_utils.py — new file

import asyncio
import logging
from aiogram.exceptions import TelegramRetryAfter

logger = logging.getLogger(__name__)


async def safe_reply(message, text: str, **kwargs) -> None:
    """Send reply with automatic TelegramRetryAfter handling."""
    for attempt in range(3):
        try:
            await message.reply(text, **kwargs)
            return
        except TelegramRetryAfter as e:
            if attempt < 2:
                logger.warning(f"Rate limited, sleeping {e.retry_after}s")
                await asyncio.sleep(e.retry_after)
            else:
                raise
```

---

## Fix #3 — Typed Anthropic error handling + token logging

```python
# Replace in bot/financial_ai/analyzer.py and bot/search_ai/catalog_search.py

from anthropic import RateLimitError, APITimeoutError, APIConnectionError, APIError

try:
    response = await client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        system=[{"type": "text", "text": _SYSTEM, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user_prompt}],
    )
    # ✅ log token usage on every call
    logger.info(
        f"claude call: in={response.usage.input_tokens} "
        f"out={response.usage.output_tokens} "
        f"cache_read={getattr(response.usage, 'cache_read_input_tokens', 0)}"
    )
    return response.content[0].text

except RateLimitError as e:
    logger.warning(f"Anthropic rate limit: {e}. No retry in background job.")
    return None
except APITimeoutError as e:
    logger.warning(f"Anthropic timeout: {e}")
    return None
except APIConnectionError as e:
    logger.error(f"Anthropic connection error: {e}")
    return None
except APIError as e:
    logger.error(f"Anthropic API error {e.status_code}: {e.message}")
    return None
```
