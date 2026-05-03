# Architecture Fixes — Copy-Paste Ready

---

## Fix #1 — _bc_cache → Redis (bot/handlers/barcode.py)

```python
# bot/handlers/barcode.py — replace _bc_cache dict with Redis

import redis.asyncio as redis_asyncio
import json
from config import REDIS_URL

_BC_TTL = 60  # seconds
_KEY_PREFIX = "wishmotors:barcode:pending:"

async def bc_store(user_id: int, data: dict, redis_client) -> None:
    key = f"{_KEY_PREFIX}{user_id}"
    await redis_client.setex(key, _BC_TTL, json.dumps(data))

async def bc_consume(user_id: int, redis_client) -> dict | None:
    key = f"{_KEY_PREFIX}{user_id}"
    raw = await redis_client.getdel(key)
    if raw is None:
        return None
    return json.loads(raw)

async def bc_exists(user_id: int, redis_client) -> bool:
    key = f"{_KEY_PREFIX}{user_id}"
    return bool(await redis_client.exists(key))
```

---

## Fix #2 — Rate limiter → Redis (bot/handlers/__init__.py)

```python
# bot/handlers/__init__.py — replace _last_called dict

_RATE_KEY_PREFIX = "wishmotors:rate_limit:user:"
_RATE_WINDOW = 86400  # 1 day in seconds

async def is_rate_limited(user_id: int, daily_limit: int, redis_client) -> bool:
    key = f"{_RATE_KEY_PREFIX}{user_id}"
    try:
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, _RATE_WINDOW)
        return count > daily_limit
    except Exception:
        # Redis down → allow through (fail open for UX)
        return False
```

---

## Fix #3 — AsyncAnthropic singleton (bot/financial_ai/analyzer.py)

```python
# bot/financial_ai/analyzer.py — replace per-call instantiation

from anthropic import AsyncAnthropic
import config

_client: AsyncAnthropic | None = None

def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY)
    return _client

# In generate_weekly_advice():
# Replace: client = AsyncAnthropic(...)
# With:    client = _get_client()
```

---

## Fix #4 — Prompt caching on catalog search (bot/search_ai/catalog_search.py)

```python
# catalog_search.py — add cache_control to system message

response = await client.messages.create(
    model=_MODEL,
    max_tokens=512,
    system=[
        {
            "type": "text",
            "text": _SYSTEM,
            "cache_control": {"type": "ephemeral"},  # ← TTL 5 minutes
        }
    ],
    messages=[{"role": "user", "content": user_prompt}],
)
```

---

## Fix #5 — Pool acquire timeout (database/db.py)

```python
# database/db.py:44 — add timeout + connection lifetime

self._pool = await asyncpg.create_pool(
    dsn=database_url,
    min_size=2,
    max_size=10,
    ssl=_ssl_ctx,
    command_timeout=30,            # max query duration
    max_inactive_connection_lifetime=300,  # release idle connections
)

# In every pool.acquire() usage:
async with self._pool.acquire(timeout=5.0) as conn:  # fail fast on exhaustion
    ...
```
