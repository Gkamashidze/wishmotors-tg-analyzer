"""
/addorder — manual multi-item order entry wizard.

Flow (DM only, admin only):
  1. /addorder              → OEM code prompt (alphanumeric, min 4 chars)
  2. OEM input              → product name prompt
  3. name input             → quantity prompt
  4. quantity input         → priority prompt  → 🚨 urgent  /  🟢 low
  5. "add another?" loop    → ➕ კიდევ ერთი  /  ✅ დასრულება
  6. on finish              → atomic bulk INSERT into `orders` (single tx),
                              then a single grouped summary is posted to
                              ORDERS_TOPIC_ID (urgent first, then low).

OEM code is collected first (alphanumeric, min 4 chars) so every order is always
linked by a machine-readable identifier before a human label is entered.

State is stored in the project FSM (Redis when REDIS_URL is set —
see bot/main.py), so a Railway restart mid-session does not corrupt
the wizard. State is always cleared on:
    • cancel button
    • final save (success or failure)
    • finish-without-items
    • DB / network exception during the bulk insert
"""

from __future__ import annotations

import asyncio
import html
import logging
import re
from io import BytesIO
from typing import Any, Dict, List, Mapping, Optional, Sequence

from aiogram import F, Router, Bot
from aiogram.enums import ChatType, ParseMode
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

import config
from bot.handlers import IsAdmin
from database.db import Database

logger = logging.getLogger(__name__)
addorder_router = Router(name="addorder")

# OEM code: alphanumeric (A-Z, a-z, 0-9), minimum 4 characters.
_OEM_RE = re.compile(r"^[A-Za-z0-9]{4,}$")

_PARSE = ParseMode.HTML
_PRIVATE = F.chat.type == ChatType.PRIVATE

_PRIORITY_URGENT = "urgent"
_PRIORITY_LOW = "low"

# Only two priority levels — must match DB values and dashboard UI.
VALID_PRIORITIES = frozenset({_PRIORITY_URGENT, _PRIORITY_LOW})

_PRIORITY_LABEL: Dict[str, str] = {
    _PRIORITY_URGENT: "🚨 სასწრაფო",
    _PRIORITY_LOW: "🟢 არც ისე სასწრაფო",
}

# Hard cap: prevent runaway sessions / oversize Telegram messages.
_MAX_ITEMS_PER_SESSION = 50


# ─── Keyboard helpers ────────────────────────────────────────────────────────


def _kb(*rows: List[InlineKeyboardButton]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=list(rows))


def _btn(text: str, data: str) -> InlineKeyboardButton:
    return InlineKeyboardButton(text=text, callback_data=data)


def _e(v: object) -> str:
    return html.escape(str(v))


_CANCEL = _btn("❌ გაუქმება", "ao:cancel")
_CANCEL_ROW = [_CANCEL]

# Callback data for buttons attached to the grouped summary in ORDERS_TOPIC_ID.
# No IDs encoded — handlers resolve the batch via (chat_id, message_id).
_CB_COMPLETE = "ao:complete"
_CB_EDIT = "ao:edit"
_CB_DELETE = "ao:delete"


def _completed_kb() -> InlineKeyboardMarkup:
    return _kb(
        [_btn("✅ შესრულდა", _CB_COMPLETE)],
        [_btn("✏️ რედაქტირება", _CB_EDIT), _btn("🗑 წაშლა", _CB_DELETE)],
    )


def _priority_kb() -> InlineKeyboardMarkup:
    return _kb(
        [_btn("🚨 სასწრაფო", "ao:prio:urgent")],
        [_btn("🟢 არც ისე სასწრაფო", "ao:prio:low")],
        _CANCEL_ROW,
    )


def _continue_kb() -> InlineKeyboardMarkup:
    return _kb(
        [_btn("➕ კიდევ ერთი", "ao:more")],
        [_btn("✅ დასრულება", "ao:done")],
        _CANCEL_ROW,
    )


# ─── FSM states ──────────────────────────────────────────────────────────────


class AddOrderWizard(StatesGroup):
    oem = State()  # strict OEM code (digits only)
    name = State()  # product name
    quantity = State()  # how many units
    priority = State()  # urgent / low
    next_step = State()  # add another or finish


class OrderEditWizard(StatesGroup):
    quantity = State()  # waiting for new quantity from admin


# ─── Internal helpers ────────────────────────────────────────────────────────


def _parse_name_qty(text: str) -> tuple[str, Optional[int]]:
    """Split "product name 3" into ("product name", 3).

    Returns (text, None) when no trailing integer is found.
    """
    parts = text.rsplit(None, 1)
    if len(parts) == 2:
        try:
            qty = int(parts[1])
            if qty > 0:
                return parts[0].strip(), qty
        except ValueError:
            pass
    return text.strip(), None


async def _resolve_and_store(
    msg: Message,
    state: FSMContext,
    db: Database,
    product_name: str,
    quantity: int,
) -> None:
    """Look up DB by OEM code, store all current-item fields, ask for priority."""
    data = await state.get_data()
    oem_code: str = data.get("current_oem_code") or ""

    resolved_product_id: Optional[int] = None
    try:
        existing = await db.get_product_by_oem(oem_code)
        if existing:
            resolved_product_id = existing["id"]
    except Exception:
        logger.exception("DB lookup by OEM %r failed during order entry", oem_code)

    await state.update_data(
        current_product_id=resolved_product_id,
        current_product_name=product_name,
        current_quantity=quantity,
        current_is_freeform=resolved_product_id is None,
    )
    await state.set_state(AddOrderWizard.priority)
    await _ask_for_priority(msg, send=True)


async def _items(state: FSMContext) -> List[Dict[str, Any]]:
    data = await state.get_data()
    items = data.get("items")
    return list(items) if isinstance(items, list) else []


async def _set_items(state: FSMContext, items: List[Dict[str, Any]]) -> None:
    await state.update_data(items=items)


async def _ask_for_oem(msg: Message, state: FSMContext, edit: bool) -> None:
    items = await _items(state)
    step_no = len(items) + 1
    text = (
        f"📋 <b>შეკვეთა — ნივთი #{step_no}</b>\n\n"
        "1️⃣ ჩაწერე პროდუქტის <b>OEM კოდი</b> (მხოლოდ ციფრები):\n"
        "<i>მაგ: 4571234000</i>"
    )
    await state.set_state(AddOrderWizard.oem)
    kb = _kb(_CANCEL_ROW)
    if edit:
        await msg.edit_text(text, parse_mode=_PARSE, reply_markup=kb)
    else:
        await msg.answer(text, parse_mode=_PARSE, reply_markup=kb)


async def _ask_for_name(msg: Message, state: FSMContext, oem_code: str) -> None:
    await state.set_state(AddOrderWizard.name)
    text = (
        f"✅ OEM კოდი: <code>{_e(oem_code)}</code>\n\n"
        "2️⃣ ჩაწერე პროდუქტის <b>დასახელება</b>:\n"
        "<i>მაგ: <code>უკანა სუხო</code></i>"
    )
    await msg.answer(text, parse_mode=_PARSE, reply_markup=_kb(_CANCEL_ROW))


async def _goto_quantity(
    msg: Message, state: FSMContext, product_name: str, edit: bool
) -> None:
    await state.set_state(AddOrderWizard.quantity)
    text = (
        f"✅ <b>{_e(product_name)}</b>\n\n"
        "🔢 <b>რამდენი ცალი გჭირდება?</b>\n"
        "<i>ჩაწერე დადებითი მთელი რიცხვი, მაგ: 2</i>"
    )
    kb = _kb(_CANCEL_ROW)
    if edit:
        await msg.edit_text(text, parse_mode=_PARSE, reply_markup=kb)
    else:
        await msg.answer(text, parse_mode=_PARSE, reply_markup=kb)


async def _ask_for_priority(msg: Message, send: bool) -> None:
    text = (
        "⏱ <b>აირჩიე პრიორიტეტი:</b>\n\n"
        "🚨 <b>სასწრაფო</b> — ახლავე საჭიროა\n"
        "🟢 <b>არც ისე სასწრაფო</b> — დროა"
    )
    if send:
        await msg.answer(text, parse_mode=_PARSE, reply_markup=_priority_kb())
    else:
        await msg.edit_text(text, parse_mode=_PARSE, reply_markup=_priority_kb())


def _summary_lines(items: List[Dict[str, Any]]) -> List[str]:
    """Plain-text bullet list of items currently staged in the session."""
    out: List[str] = []
    for idx, it in enumerate(items, start=1):
        prio = _PRIORITY_LABEL.get(it["priority"], it["priority"])
        oem = f" <code>{_e(it['oem_code'])}</code>" if it.get("oem_code") else ""
        out.append(f"{idx}. {_e(it['product_name'])}{oem} — {it['quantity']}ც · {prio}")
    return out


async def _ask_continue(msg: Message, state: FSMContext, send: bool) -> None:
    data = await state.get_data()
    saved_items: List[Dict[str, Any]] = list(data.get("saved_items") or [])
    await state.set_state(AddOrderWizard.next_step)

    body = "\n".join(_summary_lines(saved_items))
    text = (
        f"📦 <b>შენახულია {len(saved_items)} ნივთი:</b>\n\n"
        f"{body}\n\n"
        "გსურთ სხვა პროდუქტის დამატება?"
    )
    if send:
        await msg.answer(text, parse_mode=_PARSE, reply_markup=_continue_kb())
    else:
        await msg.edit_text(text, parse_mode=_PARSE, reply_markup=_continue_kb())


# ─── Final summary builder + dispatcher ──────────────────────────────────────


def _format_topic_summary(
    items_with_ids: List[Dict[str, Any]],
    requester: Optional[str],
) -> str:
    """Build the grouped summary message that is posted to ORDERS_TOPIC_ID.

    Items are grouped by priority — urgent first, then low. Each entry shows
    DB ID, name, optional OEM code, and quantity. Empty groups are omitted.
    """
    urgent = [it for it in items_with_ids if it["priority"] == _PRIORITY_URGENT]
    low = [it for it in items_with_ids if it["priority"] == _PRIORITY_LOW]

    lines: List[str] = ["📋 <b>ახალი შეკვეთა</b>"]
    if requester:
        lines.append(f"👤 ვინ ითხოვს: {_e(requester)}")
    lines.append("")

    def _bullets(rows: List[Dict[str, Any]]) -> List[str]:
        out: List[str] = []
        for it in rows:
            oem = f" <code>{_e(it['oem_code'])}</code>" if it.get("oem_code") else ""
            out.append(
                f"• <b>#{it['id']}</b> {_e(it['product_name'])}{oem} — "
                f"{it['quantity']}ც"
            )
        return out

    if urgent:
        lines.append("🚨 <b>სასწრაფო</b>")
        lines.extend(_bullets(urgent))
        if low:
            lines.append("")

    if low:
        lines.append("🟢 <b>არც ისე სასწრაფო</b>")
        lines.extend(_bullets(low))

    lines.append("")
    lines.append(
        f"📊 სულ: <b>{len(items_with_ids)}</b> ნივთი (🚨 {len(urgent)} · 🟢 {len(low)})"
    )
    return "\n".join(lines)


# ─── Entry point: /addorder ──────────────────────────────────────────────────


@addorder_router.message(Command("addorder"), IsAdmin(), _PRIVATE)
async def cmd_addorder(message: Message, state: FSMContext) -> None:
    await state.clear()
    await state.set_data(
        {
            "saved_items": [],  # lightweight display list: {id, product_name, oem_code, quantity, priority}
            "order_ids": [],  # DB IDs already inserted
            "requester_id": message.from_user.id if message.from_user else None,
            "requester_name": message.from_user.full_name
            if message.from_user
            else None,
            "requester_username": message.from_user.username
            if message.from_user
            else None,
        }
    )
    await _ask_for_oem(message, state, edit=False)


# ─── Cancel ──────────────────────────────────────────────────────────────────


@addorder_router.callback_query(F.data == "ao:cancel", IsAdmin())
async def cb_cancel(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    assert isinstance(callback.message, Message)
    data = await state.get_data()
    order_ids: List[int] = list(data.get("order_ids") or [])
    await state.clear()
    deleted = 0
    if order_ids:
        try:
            deleted = await db.delete_orders_by_ids(order_ids)
        except Exception:
            logger.exception("cb_cancel: failed to delete orders %r", order_ids)
    suffix = f" ({deleted} ნივთი წაიშალა ბაზიდან)" if deleted else ""
    await callback.message.edit_text(
        f"❌ <b>შეკვეთა გაუქმდა.</b>{suffix}",
        parse_mode=_PARSE,
    )
    await callback.answer()


# ─── Step 1a: OEM via barcode photo ──────────────────────────────────────────


@addorder_router.message(AddOrderWizard.oem, IsAdmin(), _PRIVATE, F.photo)
async def on_oem_photo(message: Message, state: FSMContext, bot: Bot) -> None:
    """Decode barcode from a photo at the OEM step, then extract part name."""
    from bot.barcode.decoder import decode_barcode, extract_part_info

    photo = message.photo[-1]
    file_info = await bot.get_file(photo.file_id)
    buf = BytesIO()
    await bot.download_file(file_info.file_path, destination=buf)
    image_bytes = buf.getvalue()

    oem = await asyncio.get_running_loop().run_in_executor(
        None, decode_barcode, image_bytes
    )

    if not oem:
        await message.answer(
            "❌ შტრიხკოდი ვერ წაიკითხა. ჩაწერე OEM კოდი ხელით:",
            parse_mode=_PARSE,
        )
        return

    oem_clean = oem.strip()
    if not _OEM_RE.match(oem_clean):
        await message.answer(
            f"⚠️ შტრიხკოდი წაიკითხა (<code>{_e(oem_clean)}</code>), "
            "მაგრამ OEM ფორმატი არ ემთხვევა (მინ. 4 ლათინური/ციფრი).\n"
            "ჩაწერე OEM ხელით:",
            parse_mode=_PARSE,
        )
        return

    await message.answer(
        f"📷 <b>OEM: <code>{_e(oem_clean)}</code></b> — ეტიკეტი მუშავდება...",
        parse_mode=_PARSE,
    )
    await state.update_data(current_oem_code=oem_clean)

    name_ka, name_en = await extract_part_info(image_bytes)

    if name_ka or name_en:
        name_full = (
            f"{name_ka} ({name_en})" if (name_ka and name_en) else (name_ka or name_en)
        )
        await state.update_data(bc_suggested_name=name_ka or name_en)
        kb = _kb(
            [
                _btn("✅ კი, ასე", "ao:bc_name_yes"),
                _btn("✎ სახელი ხელით", "ao:bc_name_manual"),
            ],
            _CANCEL_ROW,
        )
        await message.answer(
            f"📷 <b>OEM: <code>{_e(oem_clean)}</code></b>\n"
            f"🔤 <b>{_e(name_full)}</b>\n\n"
            "ასე ჩავწეროთ?",
            parse_mode=_PARSE,
            reply_markup=kb,
        )
    else:
        await _ask_for_name(message, state, oem_clean)


@addorder_router.callback_query(
    F.data == "ao:bc_name_yes", IsAdmin(), StateFilter(AddOrderWizard.oem)
)
async def cb_ao_bc_name_yes(callback: CallbackQuery, state: FSMContext) -> None:
    assert isinstance(callback.message, Message)
    data = await state.get_data()
    product_name = data.get("bc_suggested_name") or "უცნობი"
    await state.update_data(current_product_name=product_name, bc_suggested_name=None)
    await _goto_quantity(callback.message, state, product_name, edit=True)
    await callback.answer()


@addorder_router.callback_query(
    F.data == "ao:bc_name_manual", IsAdmin(), StateFilter(AddOrderWizard.oem)
)
async def cb_ao_bc_name_manual(callback: CallbackQuery, state: FSMContext) -> None:
    assert isinstance(callback.message, Message)
    data = await state.get_data()
    oem = data.get("current_oem_code") or ""
    await state.update_data(bc_suggested_name=None)
    await callback.message.edit_reply_markup(reply_markup=None)
    await _ask_for_name(callback.message, state, oem)
    await callback.answer()


# ─── Step 1b: OEM code input (text) ──────────────────────────────────────────


@addorder_router.message(AddOrderWizard.oem, IsAdmin(), _PRIVATE)
async def on_oem_input(message: Message, state: FSMContext) -> None:
    raw = (message.text or "").strip()
    if not _OEM_RE.match(raw):
        await message.answer(
            "⚠️ OEM კოდი უნდა შეიცავდეს მინიმუმ 4 სიმბოლოს (ციფრებს ან/და ლათინურ ასოებს).\n"
            "<i>მაგ: 4571234000 ან HU7009Z</i>",
            parse_mode=_PARSE,
        )
        return

    await state.update_data(current_oem_code=raw)
    await _ask_for_name(message, state, raw)


# ─── Step 2: product name only ───────────────────────────────────────────────


@addorder_router.message(AddOrderWizard.name, IsAdmin(), _PRIVATE)
async def on_name_qty_input(message: Message, state: FSMContext, db: Database) -> None:
    """Accept product name, then ask for quantity in the next step."""
    raw = (message.text or "").strip()
    if not raw:
        await message.answer(
            "⚠️ ჩაწერე პროდუქტის დასახელება.",
            parse_mode=_PARSE,
        )
        return

    await state.update_data(current_product_name=raw)
    await _goto_quantity(message, state, raw, edit=False)


# ─── Step 3: quantity (only reached when name was entered without qty) ────────


@addorder_router.message(AddOrderWizard.quantity, IsAdmin(), _PRIVATE)
async def on_quantity_input(message: Message, state: FSMContext, db: Database) -> None:
    raw = (message.text or "").strip()
    try:
        qty = int(raw)
    except ValueError:
        await message.answer(
            "⚠️ ჩაწერე მთელი დადებითი რიცხვი, მაგ: <code>2</code>",
            parse_mode=_PARSE,
        )
        return

    if qty <= 0:
        await message.answer(
            "⚠️ რაოდენობა უნდა იყოს 1-ზე მეტი ან მისი ტოლი.", parse_mode=_PARSE
        )
        return

    data = await state.get_data()
    product_name: str = data.get("current_product_name") or "უცნობი"
    await _resolve_and_store(message, state, db, product_name, qty)


# ─── Step 3: priority + commit-to-session ────────────────────────────────────


@addorder_router.callback_query(
    F.data.startswith("ao:prio:"), IsAdmin(), StateFilter(AddOrderWizard.priority)
)
async def on_priority(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    assert isinstance(callback.message, Message)
    chosen = (callback.data or "").split(":", 2)[2]
    if chosen not in VALID_PRIORITIES:
        await callback.answer(
            "❌ უცნობი პრიორიტეტი — მხოლოდ 'urgent' ან 'low'", show_alert=True
        )
        return

    data = await state.get_data()
    product_id: Optional[int] = data.get("current_product_id")
    product_name: str = data.get("current_product_name") or "უცნობი"
    oem_code: Optional[str] = data.get("current_oem_code")
    quantity: int = int(data.get("current_quantity") or 0)
    is_freeform: bool = bool(data.get("current_is_freeform"))
    requester_id: Optional[int] = data.get("requester_id")
    requester_name: Optional[str] = data.get("requester_name")

    if quantity <= 0:
        await callback.answer("⚠️ რაოდენობა დაიკარგა, თავიდან", show_alert=True)
        await _ask_for_oem(callback.message, state, edit=True)
        return

    # Ensure client row exists before the FK insert.
    if requester_id is not None:
        try:
            await db.upsert_client(telegram_id=requester_id)
        except Exception:
            logger.exception("on_priority: upsert_client failed for %s", requester_id)
            requester_id = None

    notes = f"manual /addorder by {requester_name or 'admin'}" + (
        f" — not in catalog: {product_name}" if is_freeform and not product_id else ""
    )

    # Save to DB immediately — no data loss on restart.
    try:
        order_id = await db.create_order(
            product_id=product_id,
            quantity_needed=quantity,
            priority=chosen,
            notes=notes,
            oem_code=oem_code,
            part_name=product_name,
            client_id=requester_id,
        )
    except Exception:
        logger.exception("on_priority: create_order failed")
        await callback.answer("❌ შეცდომა შენახვისას — სცადე თავიდან", show_alert=True)
        return

    saved_item: Dict[str, Any] = {
        "id": order_id,
        "product_name": product_name,
        "oem_code": oem_code,
        "quantity": quantity,
        "priority": chosen,
    }
    saved_items: List[Dict[str, Any]] = list(data.get("saved_items") or [])
    order_ids: List[int] = list(data.get("order_ids") or [])
    saved_items.append(saved_item)
    order_ids.append(order_id)

    await state.update_data(
        saved_items=saved_items,
        order_ids=order_ids,
        current_product_id=None,
        current_product_name=None,
        current_oem_code=None,
        current_is_freeform=False,
        current_quantity=None,
        current_freeform_query=None,
    )

    if len(saved_items) >= _MAX_ITEMS_PER_SESSION:
        await callback.answer(
            f"მიღწეულია მაქსიმუმი ({_MAX_ITEMS_PER_SESSION})", show_alert=True
        )
        await _finalize(callback, state, db)
        return

    await _ask_continue(callback.message, state, send=False)
    await callback.answer("✅ შენახულია")


# ─── Step 4: loop — add another / finish ─────────────────────────────────────


@addorder_router.callback_query(
    F.data == "ao:more", IsAdmin(), StateFilter(AddOrderWizard.next_step)
)
async def on_more(callback: CallbackQuery, state: FSMContext) -> None:
    assert isinstance(callback.message, Message)
    await callback.message.edit_reply_markup(reply_markup=None)
    await _ask_for_oem(callback.message, state, edit=False)
    await callback.answer()


@addorder_router.callback_query(
    F.data == "ao:done", IsAdmin(), StateFilter(AddOrderWizard.next_step)
)
async def on_done(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    await _finalize(callback, state, db)


@addorder_router.callback_query(F.data.in_({"ao:done", "ao:more"}), IsAdmin())
async def on_stale_wizard_button(callback: CallbackQuery, state: FSMContext) -> None:
    """Catch ao:done / ao:more when FSM state is missing (e.g. after bot restart)."""
    assert isinstance(callback.message, Message)
    try:
        await callback.message.edit_reply_markup(reply_markup=None)
    except Exception:
        pass
    await callback.answer(
        "⏳ სესია გაუქმდა (bot გადაიტვირთა). გამოიყენე /addorder ხელახლა.",
        show_alert=True,
    )


# ─── Finalization: bulk INSERT + post topic summary ──────────────────────────


async def _finalize(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    assert isinstance(callback.message, Message)
    data = await state.get_data()
    saved_items: List[Dict[str, Any]] = list(data.get("saved_items") or [])
    order_ids: List[int] = list(data.get("order_ids") or [])
    requester_name: Optional[str] = data.get("requester_name") or (
        callback.from_user.full_name if callback.from_user else None
    )

    if not saved_items:
        await state.clear()
        await callback.message.edit_text(
            "ℹ️ ვერც ერთი ნივთი არ დაემატა. შეკვეთა გაუქმდა.",
            parse_mode=_PARSE,
        )
        await callback.answer()
        return

    # All items are already in DB — just clear state and post to topic.
    await state.clear()

    summary_text = _format_topic_summary(saved_items, requester_name)
    bot = callback.bot
    assert bot is not None
    try:
        posted = await bot.send_message(
            chat_id=config.GROUP_ID,
            message_thread_id=config.ORDERS_TOPIC_ID,
            text=summary_text,
            parse_mode=_PARSE,
            reply_markup=_completed_kb(),
        )
        try:
            await db.update_orders_topic_message(
                order_ids=order_ids,
                topic_id=config.ORDERS_TOPIC_ID,
                topic_message_id=posted.message_id,
            )
        except Exception as link_exc:
            logger.warning(
                "Failed to store topic_message_id for orders %r: %s",
                order_ids,
                link_exc,
            )
    except Exception as exc:
        logger.warning("Failed to post addorder summary to ORDERS topic: %s", exc)

    urgent_count = sum(1 for it in saved_items if it["priority"] == _PRIORITY_URGENT)
    low_count = sum(1 for it in saved_items if it["priority"] == _PRIORITY_LOW)
    await callback.message.edit_text(
        f"✅ <b>შეკვეთა შეინახა</b>\n\n"
        f"📦 ნივთები: <b>{len(saved_items)}</b> "
        f"(🚨 {urgent_count} · 🟢 {low_count})\n"
        f"📨 გაიგზავნა <i>ORDERS</i> ტოპიკში.",
        parse_mode=_PARSE,
    )
    await callback.answer("✅ შენახულია")


# ─── "✅ შესრულდა" — close the whole batch from the topic message ────────────


def _format_completed_summary(
    original_html: str,
    orders: Sequence[Mapping[str, Any]],
    completed_by: Optional[str],
) -> str:
    """Prepend a completion banner to the original summary.

    The original body is preserved so the reader still sees what was
    ordered; a banner on top + a trailing footer visibly mark the whole
    batch as delivered.
    """
    banner = "✅ <b>შეკვეთა ჩამოსულია / შესრულებულია</b>"
    if completed_by:
        banner += f"\n👤 დახურა: {_e(completed_by)}"
    footer_ids = ", ".join(f"#{o['id']}" for o in orders)
    footer = (
        f"\n\n✅ <b>დახურული შეკვეთები ({len(orders)}):</b> {footer_ids}"
        if orders
        else ""
    )
    return f"{banner}\n\n{original_html}{footer}"


@addorder_router.callback_query(F.data == _CB_COMPLETE, IsAdmin())
async def cb_complete(callback: CallbackQuery, db: Database) -> None:
    """Mark every order tied to this topic message as completed.

    Security: IsAdmin filter already restricts this to admins.
    Idempotency: DB update filters on status='pending', so double-taps
    from a stale keyboard become no-ops and get a friendly alert.
    """
    msg = callback.message
    if not isinstance(msg, Message):
        await callback.answer("❌ შეტყობინება არ არის ხელმისაწვდომი", show_alert=True)
        return

    topic_id = msg.message_thread_id or config.ORDERS_TOPIC_ID
    message_id = msg.message_id

    try:
        completed = await db.complete_orders_by_topic_message(
            topic_id=topic_id,
            topic_message_id=message_id,
        )
    except Exception:
        logger.exception(
            "complete_orders_by_topic_message failed (topic=%s msg=%s)",
            topic_id,
            message_id,
        )
        await callback.answer("❌ შეცდომა ბაზაში", show_alert=True)
        return

    if not completed:
        # Either already completed, or the back-reference was never
        # written (e.g. old messages from before this feature shipped).
        await callback.answer(
            "ℹ️ შეკვეთა უკვე დახურულია ან ვერ მოიძებნა",
            show_alert=True,
        )
        try:
            await msg.edit_reply_markup(reply_markup=None)
        except Exception:
            pass
        return

    completed_by: Optional[str] = None
    if callback.from_user:
        completed_by = (
            callback.from_user.full_name
            or callback.from_user.username
            or str(callback.from_user.id)
        )

    # Preserve the original body (as rendered HTML) so the reader still
    # sees what was ordered; the banner + footer make completion obvious.
    original_html = msg.html_text or msg.text or ""
    new_text = _format_completed_summary(original_html, completed, completed_by)

    try:
        await msg.edit_text(
            new_text,
            parse_mode=_PARSE,
            reply_markup=None,
        )
    except Exception as exc:
        # DB is already updated — editing can still fail (message too
        # old, deleted, rate-limited). Surface a soft warning to the
        # admin but don't undo the completion.
        logger.warning("Failed to edit ORDERS topic message after completion: %s", exc)

    await callback.answer(f"✅ დახურულია {len(completed)} შეკვეთა")


# ─── Helper: convert DB OrderRow to _format_topic_summary item ───────────────


def _order_row_to_item(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "product_name": row.get("product_name") or "?",
        "oem_code": row.get("oem_code"),
        "quantity": row["quantity_needed"],
        "priority": row.get("priority", "low"),
    }


# ─── "🗑 წაშლა" — delete all orders in the batch ────────────────────────────


@addorder_router.callback_query(F.data == _CB_DELETE, IsAdmin())
async def cb_delete(callback: CallbackQuery, db: Database) -> None:
    msg = callback.message
    if not isinstance(msg, Message):
        await callback.answer("❌ შეტყობინება არ არის ხელმისაწვდომი", show_alert=True)
        return

    topic_id = msg.message_thread_id or config.ORDERS_TOPIC_ID
    message_id = msg.message_id

    try:
        count = await db.delete_orders_by_topic_message(
            topic_id=topic_id,
            topic_message_id=message_id,
        )
    except Exception:
        logger.exception(
            "delete_orders_by_topic_message failed (topic=%s msg=%s)",
            topic_id,
            message_id,
        )
        await callback.answer("❌ შეცდომა ბაზაში", show_alert=True)
        return

    try:
        await msg.edit_text("❌ შეკვეთა წაშლილია", parse_mode=_PARSE)
    except Exception as exc:
        logger.warning("Failed to edit message after order delete: %s", exc)

    await callback.answer(f"🗑 წაშლილია {count} შეკვეთა")


# ─── "✏️ რედაქტირება" — enter edit mode ────────────────────────────────────


@addorder_router.callback_query(F.data == _CB_EDIT, IsAdmin())
async def cb_edit(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    msg = callback.message
    if not isinstance(msg, Message):
        await callback.answer("❌ შეტყობინება არ არის ხელმისაწვდომი", show_alert=True)
        return

    topic_id = msg.message_thread_id or config.ORDERS_TOPIC_ID
    message_id = msg.message_id

    try:
        orders = await db.get_orders_by_topic_message(
            topic_id=topic_id,
            topic_message_id=message_id,
        )
    except Exception:
        logger.exception(
            "get_orders_by_topic_message failed (topic=%s msg=%s)",
            topic_id,
            message_id,
        )
        await callback.answer("❌ შეცდომა ბაზაში", show_alert=True)
        return

    pending = [o for o in orders if o["status"] == "pending"]
    if not pending:
        await callback.answer(
            "ℹ️ ჩასარედაქტირებელი შეკვეთა ვერ მოიძებნა", show_alert=True
        )
        return

    await state.set_state(OrderEditWizard.quantity)
    await state.update_data(
        edit_topic_id=topic_id,
        edit_message_id=message_id,
        edit_chat_id=msg.chat.id,
        edit_order_ids=[o["id"] for o in pending],
    )

    if len(pending) == 1:
        o = pending[0]
        prompt = (
            f"✏️ <b>შეკვეთის რედაქტირება</b>\n\n"
            f"• <b>#{o['id']}</b> {_e(o.get('product_name') or '?')} — "
            f"ამჟამად: <b>{o['quantity_needed']}ც</b>\n\n"
            "მიუთითეთ ახალი რაოდენობა:"
        )
    else:
        lines: List[str] = []
        for i, o in enumerate(pending, 1):
            lines.append(
                f"{i}. <b>#{o['id']}</b> {_e(o.get('product_name') or '?')} — "
                f"{o['quantity_needed']}ც"
            )
        prompt = (
            "✏️ <b>შეკვეთების რედაქტირება</b>\n\n"
            + "\n".join(lines)
            + "\n\nჩაწერეთ: <code>ნომერი ახალი_რაოდენობა</code>\n"
            "<i>მაგ: <code>1 3</code> — პირველ ნივთს 3 ცალი</i>"
        )

    await msg.answer(prompt, parse_mode=_PARSE)
    await callback.answer("✏️ რედაქტირების რეჟიმი")


# ─── Edit wizard: quantity input ─────────────────────────────────────────────


@addorder_router.message(OrderEditWizard.quantity, IsAdmin())
async def on_edit_qty_input(message: Message, state: FSMContext, db: Database) -> None:
    data = await state.get_data()
    order_ids: List[int] = list(data.get("edit_order_ids") or [])
    topic_id: int = int(data.get("edit_topic_id") or config.ORDERS_TOPIC_ID)
    edit_message_id: int = int(data.get("edit_message_id") or 0)
    edit_chat_id: int = int(data.get("edit_chat_id") or config.GROUP_ID)

    if not order_ids or not edit_message_id:
        await message.answer("❌ სესია ამოიწურა. სცადეთ თავიდან.", parse_mode=_PARSE)
        await state.clear()
        return

    raw = (message.text or "").strip()

    if len(order_ids) == 1:
        try:
            new_qty = int(raw)
        except ValueError:
            await message.answer(
                "⚠️ ჩაწერე მთელი დადებითი რიცხვი, მაგ: <code>2</code>",
                parse_mode=_PARSE,
            )
            return
        if new_qty <= 0:
            await message.answer("⚠️ რაოდენობა უნდა იყოს 1 ან მეტი.", parse_mode=_PARSE)
            return
        target_order_id = order_ids[0]
    else:
        parts = raw.split()
        if len(parts) != 2:
            await message.answer(
                "⚠️ ფორმატი: <code>ნომერი ახალი_რაოდენობა</code>\n"
                "<i>მაგ: <code>1 3</code></i>",
                parse_mode=_PARSE,
            )
            return
        try:
            item_no = int(parts[0])
            new_qty = int(parts[1])
        except ValueError:
            await message.answer(
                "⚠️ ჩაწერე მხოლოდ ციფრები, მაგ: <code>1 3</code>",
                parse_mode=_PARSE,
            )
            return
        if item_no < 1 or item_no > len(order_ids):
            await message.answer(
                f"⚠️ ნივთის ნომერი უნდა იყოს 1-დან {len(order_ids)}-მდე",
                parse_mode=_PARSE,
            )
            return
        if new_qty <= 0:
            await message.answer("⚠️ რაოდენობა უნდა იყოს 1 ან მეტი.", parse_mode=_PARSE)
            return
        target_order_id = order_ids[item_no - 1]

    try:
        updated = await db.update_order_quantity(
            order_id=target_order_id,
            new_quantity=new_qty,
        )
    except Exception:
        logger.exception(
            "update_order_quantity failed for order_id=%s", target_order_id
        )
        await message.answer("❌ შეცდომა ბაზაში", parse_mode=_PARSE)
        await state.clear()
        return

    if not updated:
        await message.answer(
            "ℹ️ შეკვეთა ვერ განახლდა (შესაძლოა უკვე დახურულია).",
            parse_mode=_PARSE,
        )
        await state.clear()
        return

    await state.clear()

    # Rebuild the topic message from DB with updated quantities.
    try:
        refreshed = await db.get_orders_by_topic_message(
            topic_id=topic_id,
            topic_message_id=edit_message_id,
        )
        items_for_summary = [
            _order_row_to_item(dict(o)) for o in refreshed if o["status"] == "pending"
        ]
        new_text = _format_topic_summary(items_for_summary, requester=None)
        bot = message.bot
        assert bot is not None
        await bot.edit_message_text(
            chat_id=edit_chat_id,
            message_id=edit_message_id,
            text=new_text,
            parse_mode=_PARSE,
            reply_markup=_completed_kb(),
        )
    except Exception as exc:
        logger.warning("Failed to update topic message after qty edit: %s", exc)

    await message.answer(
        f"✅ შეკვეთა <b>#{target_order_id}</b> განახლდა — ახალი რაოდენობა: <b>{new_qty}ც</b>",
        parse_mode=_PARSE,
    )
