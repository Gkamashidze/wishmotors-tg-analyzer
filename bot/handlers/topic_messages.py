"""Helpers for editing the bot's own topic-group confirmation messages.

When a transaction (sale / nisia / expense) is cancelled or edited, we
update the original confirmation post in the group topic in place —
instead of deleting it and posting a new one. That keeps a coherent,
non-jumpy history in the topic and preserves thread position.

All edits go through `_safe_edit`, which swallows the expected
`TelegramBadRequest` failure modes (message not modified / not found /
not editable) so a stale or deleted post never crashes the handler.
"""

from __future__ import annotations

import logging
from typing import Optional

from aiogram import Bot
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

logger = logging.getLogger(__name__)

CANCELLED_BANNER = "❌ <b>ეს ტრანზაქცია გაუქმებულია</b>"
UPDATED_BANNER = "✏️ <b>შეცვლილია</b>"

# Telegram caps message text at 4096 chars; leave headroom for banner.
_MAX_LEN = 4000


# ─── Topic keyboards ──────────────────────────────────────────────────────────
# Compact Edit/Delete (+Complete) keyboards attached to bot confirmation posts
# in group topics so admins can fully manage transactions from the group
# without touching DM-only commands.


def _kb(*rows: list[InlineKeyboardButton]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=list(rows))


def _btn(text: str, data: str) -> InlineKeyboardButton:
    return InlineKeyboardButton(text=text, callback_data=data)


def topic_sale_kb(sale_id: int) -> InlineKeyboardMarkup:
    """Edit/Delete keyboard for a sale topic post."""
    return _kb(
        [
            _btn("✏️ რედაქტირება", f"edit:sale:{sale_id}"),
            _btn("❌ წაშლა", f"ds:{sale_id}"),
        ],
    )


def topic_nisia_kb(sale_id: int) -> InlineKeyboardMarkup:
    """Edit/Delete keyboard for a nisia (credit sale) topic post."""
    return _kb(
        [
            _btn("✏️ რედაქტირება", f"edit:nisia:{sale_id}"),
            _btn("❌ წაშლა", f"ds:{sale_id}"),
        ],
    )


def topic_expense_kb(expense_id: int) -> InlineKeyboardMarkup:
    """Edit/Delete keyboard for an expense topic post."""
    return _kb(
        [
            _btn("✏️ რედაქტირება", f"edit:exp:{expense_id}"),
            _btn("❌ წაშლა", f"de:{expense_id}"),
        ],
    )


async def _safe_edit(
    bot: Bot,
    chat_id: int,
    message_id: int,
    text: str,
) -> bool:
    """Edit a message; return True on success, False on benign failure.

    Benign failures (ignored):
      • "message is not modified" — idempotent edit.
      • "message to edit not found" — already deleted by user/admin.
      • "message can't be edited" — too old (>48h for bots) or foreign.
    Unexpected errors are logged but do not propagate — a stale topic
    post should never take down the bot.
    """
    if len(text) > _MAX_LEN:
        text = text[:_MAX_LEN] + "…"
    try:
        await bot.edit_message_text(
            chat_id=chat_id,
            message_id=message_id,
            text=text,
            parse_mode=ParseMode.HTML,
        )
        return True
    except TelegramBadRequest as exc:
        msg = str(exc).lower()
        if "not modified" in msg:
            return True
        if "message to edit not found" in msg or "message can't be edited" in msg:
            logger.info(
                "Topic message %d not editable (stale/deleted): %s",
                message_id,
                exc,
            )
            return False
        logger.warning(
            "TelegramBadRequest editing topic message %d: %s", message_id, exc
        )
        return False
    except Exception as exc:
        logger.warning("Unexpected error editing topic message %d: %s", message_id, exc)
        return False


async def mark_cancelled(
    bot: Bot,
    chat_id: int,
    message_id: Optional[int],
    original_text: str,
) -> bool:
    """Prepend the cancellation banner to an existing topic post.

    Returns True if the post was updated (or already looked updated),
    False if the post is gone / unreachable / had no message_id.
    """
    if not message_id:
        return False
    return await _safe_edit(
        bot,
        chat_id,
        message_id,
        f"{CANCELLED_BANNER}\n\n{original_text}",
    )


async def mark_updated(
    bot: Bot,
    chat_id: int,
    message_id: Optional[int],
    new_text: str,
    edit_count: int = 0,
) -> bool:
    """Rewrite an existing topic post to show the edited details + banner."""
    if not message_id:
        return False
    banner = (
        f"✏️ <b>შეცვლილია ({edit_count}-ჯერ)</b>" if edit_count > 0 else UPDATED_BANNER
    )
    return await _safe_edit(
        bot,
        chat_id,
        message_id,
        f"{banner}\n\n{new_text}",
    )


async def restore_original(
    bot: Bot,
    chat_id: int,
    message_id: Optional[int],
    original_text: str,
) -> bool:
    """Rewrite a previously-cancelled topic post back to its original form."""
    if not message_id:
        return False
    return await _safe_edit(bot, chat_id, message_id, original_text)
