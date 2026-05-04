"""Safe Telegram send helpers with TelegramRetryAfter retry logic."""

import asyncio
import logging
from typing import Any, Optional

from aiogram.exceptions import TelegramRetryAfter
from aiogram.types import InlineKeyboardMarkup, Message

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3


async def safe_reply(
    message: Message,
    text: str,
    reply_markup: Optional[InlineKeyboardMarkup] = None,
    **kwargs: Any,
) -> None:
    """Reply to a message; automatically retries once on TelegramRetryAfter."""
    for attempt in range(_MAX_RETRIES):
        try:
            await message.reply(text, reply_markup=reply_markup, **kwargs)
            return
        except TelegramRetryAfter as exc:
            if attempt < _MAX_RETRIES - 1:
                logger.warning("Rate limited on reply — sleeping %ss", exc.retry_after)
                await asyncio.sleep(exc.retry_after)
            else:
                logger.error(
                    "Rate limit exceeded after %d retries, dropping reply", _MAX_RETRIES
                )
                raise


async def safe_answer(
    message: Message,
    text: str,
    reply_markup: Optional[InlineKeyboardMarkup] = None,
    **kwargs: Any,
) -> None:
    """Answer a message; automatically retries once on TelegramRetryAfter."""
    for attempt in range(_MAX_RETRIES):
        try:
            await message.answer(text, reply_markup=reply_markup, **kwargs)
            return
        except TelegramRetryAfter as exc:
            if attempt < _MAX_RETRIES - 1:
                logger.warning("Rate limited on answer — sleeping %ss", exc.retry_after)
                await asyncio.sleep(exc.retry_after)
            else:
                logger.error(
                    "Rate limit exceeded after %d retries, dropping answer",
                    _MAX_RETRIES,
                )
                raise
