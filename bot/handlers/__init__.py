import logging
import time
from typing import Optional, Union

from aiogram.filters import Filter
from aiogram.types import CallbackQuery, Message

import config
from bot.handlers import _redis as _redis_mod

logger = logging.getLogger(__name__)


class InTopic(Filter):
    """Passes only when a message belongs to a specific forum topic in the group.

    Accepts `None` as topic_id — in that case the filter never matches. This keeps
    handlers registered against optional topics (e.g. INVENTORY_TOPIC_ID) safe when
    the environment variable is not configured.
    """

    def __init__(self, topic_id: Optional[int]) -> None:
        self.topic_id = topic_id

    async def __call__(self, message: Message) -> bool:
        if self.topic_id is None:
            return False
        return (
            message.chat.id == config.GROUP_ID
            and message.message_thread_id == self.topic_id
        )


class IsAdmin(Filter):
    """Passes only when the sender's user ID is in the ADMIN_IDS whitelist.
    Works for both Message and CallbackQuery events."""

    async def __call__(self, event: Union[Message, CallbackQuery]) -> bool:
        return bool(event.from_user and event.from_user.id in config.ADMIN_IDS)


# ─── Simple per-user rate limiter ────────────────────────────────────────────
# Redis-backed when available; falls back to in-process dict.
# Default: max 1 call per 2 seconds per user per command.

_last_called: dict[str, float] = {}
_RL_KEY = "wishmotors:rate_limit:{}:{}"


async def is_rate_limited(
    user_id: int, command: str, min_interval: float = 2.0
) -> bool:
    """Return True if the user called this command too recently."""
    r = _redis_mod.get()
    if r is not None:
        try:
            key = _RL_KEY.format(user_id, command)
            ttl = int(min_interval) or 1
            # SET NX EX: succeeds only on first call within the window
            set_result = await r.set(key, 1, nx=True, ex=ttl)  # type: ignore[attr-defined]
            return set_result is None  # None means key existed → rate limited
        except Exception as exc:
            logger.warning("Redis rate_limit check failed, using memory: %s", exc)

    key = f"{user_id}:{command}"
    now = time.monotonic()
    last = _last_called.get(key, 0.0)
    if now - last < min_interval:
        return True
    _last_called[key] = now
    return False
