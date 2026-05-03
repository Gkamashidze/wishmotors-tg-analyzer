"""Module-level Redis client shared by barcode cache and rate limiter.

Initialized from main.py when REDIS_URL is configured.
Handlers gracefully fall back to in-process dicts when Redis is unavailable.
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import redis.asyncio as _redis_asyncio  # type: ignore[import-untyped]
    _Redis = _redis_asyncio.Redis
except ImportError:  # pragma: no cover
    _redis_asyncio = None  # type: ignore[assignment]
    _Redis = None  # type: ignore[assignment]

_client: Optional[object] = None


def init(url: str) -> None:
    """Initialize the shared Redis client. Called once from main.py."""
    global _client
    if _redis_asyncio is None:
        logger.warning("redis-py not installed — falling back to in-process caches.")
        return
    _client = _redis_asyncio.from_url(url, decode_responses=True)
    logger.info("Redis client initialized for barcode/rate-limit caches.")


def get() -> Optional[object]:
    """Return the Redis client, or None if Redis is not configured."""
    return _client
