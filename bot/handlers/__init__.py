import time
from typing import Optional, Union

from aiogram.filters import Filter
from aiogram.types import CallbackQuery, Message

import config


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
        return bool(
            event.from_user and event.from_user.id in config.ADMIN_IDS
        )


# ─── Simple per-user rate limiter ────────────────────────────────────────────
# Tracks the last call timestamp per (user_id, command) pair.
# Default: max 1 call per 2 seconds per user per command.

_last_called: dict[str, float] = {}


def is_rate_limited(user_id: int, command: str, min_interval: float = 2.0) -> bool:
    """Return True if the user called this command too recently.

    Args:
        user_id: Telegram user ID.
        command: Command name (e.g. 'deletesale').
        min_interval: Minimum seconds between calls (default 2s).
    """
    key = f"{user_id}:{command}"
    now = time.monotonic()
    last = _last_called.get(key, 0.0)
    if now - last < min_interval:
        return True
    _last_called[key] = now
    return False
