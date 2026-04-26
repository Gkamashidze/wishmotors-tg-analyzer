"""Barcode photo handlers for the SALES topic.

Flow:
  1. User sends a photo to SALES_TOPIC_ID.
  2. Bot decodes the barcode (zxingcpp) and calls Claude Vision to extract the
     part name from the label text.
  3. Bot DMs the user with the decoded OEM + suggested name and a
     [✅ კი, ასე] / [✎ ხელით] keyboard.
  4a. [✅ კი, ასე] — marks the cache entry as ready; tells user to type qty/price
      in the topic.
  4b. [✎ ხელით] — sets status=awaiting_name; next DM text from the user is
      captured as the product name.
  5. User types "2ც 45₾" in the SALES topic.
  6. handle_sales_text() in sales.py calls bc_consume() to pull the cached
     OEM + name and injects them into the parsed sale.

The cache is a module-level dict keyed by Telegram user_id.
"""
from __future__ import annotations

import asyncio
import html
import logging
import time
from io import BytesIO
from typing import Optional

from aiogram import F, Router, Bot
from aiogram.enums import ChatType, ParseMode
from aiogram.filters import BaseFilter
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

import config
from bot.barcode.decoder import decode_barcode, extract_part_info
from bot.handlers import InTopic, IsAdmin

logger = logging.getLogger(__name__)
barcode_router = Router(name="barcode")

_PARSE = ParseMode.HTML
_BC_TTL = 60.0  # seconds a pending scan is kept alive

# Per-user OEM cache.
# value keys: oem, name_ka, name_en, status ("confirming"|"awaiting_name"|"ready"), expires
_bc_cache: dict[int, dict] = {}


# ─── Cache helpers ────────────────────────────────────────────────────────────

def _bc_set(user_id: int, **kwargs: object) -> None:
    _bc_cache[user_id] = {"expires": time.monotonic() + _BC_TTL, **kwargs}


def _bc_get(user_id: int) -> Optional[dict]:
    entry = _bc_cache.get(user_id)
    if entry and time.monotonic() < entry["expires"]:
        return entry
    _bc_cache.pop(user_id, None)
    return None


def bc_consume(user_id: int) -> Optional[dict]:
    """Return and delete the ready cache entry, or None if missing/expired/not-ready."""
    entry = _bc_get(user_id)
    if entry and entry.get("status") == "ready":
        _bc_cache.pop(user_id, None)
        return entry
    return None


# ─── Keyboard / display helpers ───────────────────────────────────────────────

def _confirm_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="✅ კი, ასე", callback_data="bc:yes"),
        InlineKeyboardButton(text="✎ ხელით", callback_data="bc:manual"),
    ]])


def _fmt_name(name_ka: str, name_en: str) -> str:
    if name_ka and name_en:
        return f"{name_ka} ({name_en})"
    return name_ka or name_en


# ─── Filter: user is waiting to type a manual product name ────────────────────

class _PendingManualName(BaseFilter):
    async def __call__(self, message: Message) -> bool:
        if not message.from_user:
            return False
        entry = _bc_get(message.from_user.id)
        return bool(entry and entry.get("status") == "awaiting_name")


# ─── Photo handler ────────────────────────────────────────────────────────────

@barcode_router.message(InTopic(config.SALES_TOPIC_ID), IsAdmin(), F.photo)
async def handle_sales_photo(message: Message, bot: Bot) -> None:
    """Decode barcode + extract part name from a photo sent to the SALES topic."""
    user_id = message.from_user.id
    photo = message.photo[-1]

    file_info = await bot.get_file(photo.file_id)
    buf = BytesIO()
    await bot.download_file(file_info.file_path, destination=buf)
    image_bytes = buf.getvalue()

    oem = await asyncio.get_running_loop().run_in_executor(None, decode_barcode, image_bytes)

    if not oem:
        await bot.send_message(
            chat_id=user_id,
            text="❌ შტრიხკოდი ვერ წაიკითხა. გადაიღე ახლოდან ან სხვა კუთხით.",
            parse_mode=_PARSE,
        )
        return

    await bot.send_message(
        chat_id=user_id,
        text=f"📷 <b>OEM: <code>{html.escape(oem)}</code></b> — ეტიკეტი მუშავდება...",
        parse_mode=_PARSE,
    )

    name_ka, name_en = await extract_part_info(image_bytes)
    name = _fmt_name(name_ka, name_en)

    if name:
        _bc_set(user_id, oem=oem, name_ka=name_ka, name_en=name_en, status="confirming")
        await bot.send_message(
            chat_id=user_id,
            text=(
                f"📷 <b>შტრიხკოდი წაიკითხა!</b>\n"
                f"🔑 OEM: <code>{html.escape(oem)}</code>\n"
                f"🔤 <b>{html.escape(name)}</b>\n\n"
                "ასე ჩავწეროთ?"
            ),
            parse_mode=_PARSE,
            reply_markup=_confirm_kb(),
        )
    else:
        # Name extraction failed — mark ready immediately, skip confirmation step
        _bc_set(user_id, oem=oem, name_ka="", name_en="", status="ready")
        await bot.send_message(
            chat_id=user_id,
            text=(
                f"📷 <b>OEM: <code>{html.escape(oem)}</code></b> შენახულია.\n\n"
                "გაყიდვის ტოპიკში ჩაწერე: <code>2ც 45₾ ხელზე</code>"
            ),
            parse_mode=_PARSE,
        )


# ─── Confirmation callbacks ────────────────────────────────────────────────────

@barcode_router.callback_query(F.data == "bc:yes", IsAdmin())
async def cb_bc_yes(callback: CallbackQuery) -> None:
    assert isinstance(callback.message, Message)
    user_id = callback.from_user.id
    entry = _bc_get(user_id)
    if not entry:
        await callback.answer("⏰ სესია ამოიწურა. ფოტო ხელახლა გაგზავნე.", show_alert=True)
        return

    _bc_set(user_id, oem=entry["oem"], name_ka=entry["name_ka"], name_en=entry["name_en"], status="ready")
    name = _fmt_name(entry["name_ka"], entry["name_en"])
    name_line = f"\n🔤 {html.escape(name)}" if name else ""

    await callback.message.edit_text(
        f"✅ <b>OEM: <code>{html.escape(entry['oem'])}</code></b>{name_line}\n\n"
        "გაყიდვის ტოპიკში ჩაწერე: <code>2ც 45₾ ხელზე</code>",
        parse_mode=_PARSE,
    )
    await callback.answer()


@barcode_router.callback_query(F.data == "bc:manual", IsAdmin())
async def cb_bc_manual(callback: CallbackQuery) -> None:
    assert isinstance(callback.message, Message)
    user_id = callback.from_user.id
    entry = _bc_get(user_id)
    if not entry:
        await callback.answer("⏰ სესია ამოიწურა. ფოტო ხელახლა გაგზავნე.", show_alert=True)
        return

    _bc_set(user_id, oem=entry["oem"], name_ka="", name_en="", status="awaiting_name")
    await callback.message.edit_text(
        "✏️ ჩაწერე პროდუქტის <b>დასახელება</b>:",
        parse_mode=_PARSE,
    )
    await callback.answer()


# ─── Manual name capture (DM only, fires only when awaiting_name) ─────────────

@barcode_router.message(
    _PendingManualName(),
    IsAdmin(),
    F.chat.type == ChatType.PRIVATE,
    F.text,
)
async def handle_bc_manual_name(message: Message) -> None:
    user_id = message.from_user.id
    entry = _bc_get(user_id)
    if not entry or entry.get("status") != "awaiting_name":
        return

    name = (message.text or "").strip()
    if not name:
        await message.answer("⚠️ დასახელება ცარიელია. ჩაწერე სახელი.")
        return

    _bc_set(user_id, oem=entry["oem"], name_ka=name, name_en="", status="ready")
    await message.answer(
        f"✅ <b>OEM: <code>{html.escape(entry['oem'])}</code></b>\n"
        f"🔤 <b>{html.escape(name)}</b>\n\n"
        "გაყიდვის ტოპიკში ჩაწერე: <code>2ც 45₾ ხელზე</code>",
        parse_mode=_PARSE,
    )
