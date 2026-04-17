"""
/addorder — manual multi-item order entry wizard.

Flow (DM only, admin only):
  1. /addorder              → product prompt (OEM / name)
  2. product input          → search → either auto-pick / user picks / freeform
  3. quantity prompt        → integer > 0
  4. priority prompt        → 🚨 urgent  /  🟢 low
  5. "add another?" loop    → ➕ კიდევ ერთი  /  ✅ დასრულება
  6. on finish              → atomic bulk INSERT into `orders` (single tx),
                              then a single grouped summary is posted to
                              ORDERS_TOPIC_ID (urgent first, then low).

State is stored in the project FSM (Redis when REDIS_URL is set —
see bot/main.py), so a Railway restart mid-session does not corrupt
the wizard. State is always cleared on:
    • cancel button
    • final save (success or failure)
    • finish-without-items
    • DB / network exception during the bulk insert
"""
from __future__ import annotations

import html
import logging
from typing import Any, Dict, List, Optional

from aiogram import F, Router
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

_PARSE = ParseMode.HTML
_PRIVATE = F.chat.type == ChatType.PRIVATE

_PRIORITY_URGENT = "urgent"
_PRIORITY_LOW = "low"

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
    product   = State()   # OEM / name input
    select    = State()   # disambiguation when several products match
    quantity  = State()   # how many units
    priority  = State()   # urgent / low
    next_step = State()   # add another or finish


# ─── Internal helpers ────────────────────────────────────────────────────────

async def _items(state: FSMContext) -> List[Dict[str, Any]]:
    data = await state.get_data()
    items = data.get("items")
    return list(items) if isinstance(items, list) else []


async def _set_items(state: FSMContext, items: List[Dict[str, Any]]) -> None:
    await state.update_data(items=items)


async def _ask_for_product(msg: Message, state: FSMContext, edit: bool) -> None:
    items = await _items(state)
    step_no = len(items) + 1
    text = (
        f"📋 <b>შეკვეთა — ნივთი #{step_no}</b>\n\n"
        "ჩაწერე პროდუქტის <b>OEM კოდი</b> ან <b>დასახელება</b>:"
    )
    await state.set_state(AddOrderWizard.product)
    kb = _kb(_CANCEL_ROW)
    if edit:
        await msg.edit_text(text, parse_mode=_PARSE, reply_markup=kb)
    else:
        await msg.answer(text, parse_mode=_PARSE, reply_markup=kb)


async def _goto_quantity(msg: Message, state: FSMContext, product_name: str, edit: bool) -> None:
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
        out.append(
            f"{idx}. {_e(it['product_name'])}{oem} — "
            f"{it['quantity']}ც · {prio}"
        )
    return out


async def _ask_continue(msg: Message, state: FSMContext, send: bool) -> None:
    items = await _items(state)
    await state.set_state(AddOrderWizard.next_step)

    body = "\n".join(_summary_lines(items))
    text = (
        f"📦 <b>დამატებულია {len(items)} ნივთი:</b>\n\n"
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
        f"📊 სულ: <b>{len(items_with_ids)}</b> ნივთი "
        f"(🚨 {len(urgent)} · 🟢 {len(low)})"
    )
    lines.append("<i>დახურვა: <code>/completeorder ID</code></i>")
    return "\n".join(lines)


# ─── Entry point: /addorder ──────────────────────────────────────────────────

@addorder_router.message(Command("addorder"), IsAdmin(), _PRIVATE)
async def cmd_addorder(message: Message, state: FSMContext) -> None:
    # Always start from a clean slate — never inherit half-filled state
    # from an earlier aborted session.
    await state.clear()
    await state.set_data({"items": []})
    await _ask_for_product(message, state, edit=False)


# ─── Cancel ──────────────────────────────────────────────────────────────────

@addorder_router.callback_query(F.data == "ao:cancel", IsAdmin())
async def cb_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    assert isinstance(callback.message, Message)
    items = await _items(state)
    await state.clear()
    suffix = f" ({len(items)} ნივთი არ შეინახა)" if items else ""
    await callback.message.edit_text(
        f"❌ <b>შეკვეთა გაუქმდა.</b>{suffix}",
        parse_mode=_PARSE,
    )
    await callback.answer()


# ─── Step 1: product input ───────────────────────────────────────────────────

@addorder_router.message(AddOrderWizard.product, IsAdmin(), _PRIVATE)
async def on_product_input(message: Message, state: FSMContext, db: Database) -> None:
    query = (message.text or "").strip()
    if not query:
        await message.answer(
            "⚠️ ჩაწერე პროდუქტის OEM კოდი ან დასახელება.",
            parse_mode=_PARSE,
        )
        return

    products = await db.search_products(query, limit=6)

    if len(products) == 1:
        p = products[0]
        await state.update_data(
            current_product_id=p["id"],
            current_product_name=p["name"],
            current_oem_code=p.get("oem_code"),
            current_is_freeform=False,
        )
        await _goto_quantity(message, state, p["name"], edit=False)
        return

    if len(products) > 1:
        await state.set_state(AddOrderWizard.select)
        rows: List[List[InlineKeyboardButton]] = []
        for p in products:
            label = p["name"]
            if p.get("oem_code"):
                label += f" [{p['oem_code']}]"
            rows.append([_btn(label[:64], f"ao:prod:{p['id']}")])
        rows.append([_btn(f"❓ ბაზაში არ არის — ჩავიწეროთ '{query[:32]}'", "ao:prod:free")])
        rows.append(_CANCEL_ROW)
        await state.update_data(current_freeform_query=query)
        await message.answer(
            f"🔍 <b>ვიპოვე {len(products)} პროდუქტი.</b> აირჩიე:",
            parse_mode=_PARSE,
            reply_markup=InlineKeyboardMarkup(inline_keyboard=rows),
        )
        return

    # No matches — let the user record it as a freeform request.
    await state.set_state(AddOrderWizard.select)
    await state.update_data(current_freeform_query=query)
    await message.answer(
        f"⚠️ <b>'{_e(query)}'</b> ბაზაში ვერ ვიპოვე.\n"
        "მაინც ჩავიწეროთ შეკვეთად?",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [_btn(f"✅ ჩავიწეროთ: {query[:40]}", "ao:prod:free")],
            _CANCEL_ROW,
        ),
    )


# ─── Step 1b: pick from search results ───────────────────────────────────────

@addorder_router.callback_query(F.data.startswith("ao:prod:"), IsAdmin(), StateFilter(AddOrderWizard.select))
async def on_product_selected(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    assert isinstance(callback.message, Message)
    choice = callback.data.split(":", 2)[2]

    if choice == "free":
        data = await state.get_data()
        name = (data.get("current_freeform_query") or "უცნობი").strip() or "უცნობი"
        await state.update_data(
            current_product_id=None,
            current_product_name=name,
            current_oem_code=None,
            current_is_freeform=True,
        )
        await _goto_quantity(callback.message, state, name, edit=True)
        await callback.answer()
        return

    try:
        product_id = int(choice)
    except ValueError:
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    product = await db.get_product_by_id(product_id)
    if not product:
        await callback.answer("პროდუქტი ვერ მოიძებნა", show_alert=True)
        return

    await state.update_data(
        current_product_id=product_id,
        current_product_name=product["name"],
        current_oem_code=product.get("oem_code"),
        current_is_freeform=False,
    )
    await _goto_quantity(callback.message, state, product["name"], edit=True)
    await callback.answer()


# ─── Step 2: quantity ────────────────────────────────────────────────────────

@addorder_router.message(AddOrderWizard.quantity, IsAdmin(), _PRIVATE)
async def on_quantity_input(message: Message, state: FSMContext) -> None:
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
        await message.answer("⚠️ რაოდენობა უნდა იყოს 1-ზე მეტი ან მისი ტოლი.", parse_mode=_PARSE)
        return

    await state.update_data(current_quantity=qty)
    await state.set_state(AddOrderWizard.priority)
    await _ask_for_priority(message, send=True)


# ─── Step 3: priority + commit-to-session ────────────────────────────────────

@addorder_router.callback_query(F.data.startswith("ao:prio:"), IsAdmin(), StateFilter(AddOrderWizard.priority))
async def on_priority(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    assert isinstance(callback.message, Message)
    chosen = callback.data.split(":", 2)[2]
    if chosen not in (_PRIORITY_URGENT, _PRIORITY_LOW):
        await callback.answer("❌ უცნობი პრიორიტეტი", show_alert=True)
        return

    data = await state.get_data()
    item: Dict[str, Any] = {
        "product_id": data.get("current_product_id"),
        "product_name": data.get("current_product_name") or "უცნობი",
        "oem_code": data.get("current_oem_code"),
        "quantity": int(data.get("current_quantity") or 0),
        "priority": chosen,
        "is_freeform": bool(data.get("current_is_freeform")),
    }
    if item["quantity"] <= 0:
        # Defensive: quantity slot was unexpectedly empty — restart this row.
        await callback.answer("⚠️ რაოდენობა დაიკარგა, თავიდან", show_alert=True)
        await _ask_for_product(callback.message, state, edit=True)
        return

    items = await _items(state)
    items.append(item)

    # Clear per-item scratchpad before storing.
    await state.update_data(
        items=items,
        current_product_id=None,
        current_product_name=None,
        current_oem_code=None,
        current_is_freeform=False,
        current_quantity=None,
        current_freeform_query=None,
    )

    if len(items) >= _MAX_ITEMS_PER_SESSION:
        await callback.answer(f"მიღწეულია მაქსიმუმი ({_MAX_ITEMS_PER_SESSION})", show_alert=True)
        await _finalize(callback, state, db)
        return

    await _ask_continue(callback.message, state, send=False)
    await callback.answer("✅ დამატებულია")


# ─── Step 4: loop — add another / finish ─────────────────────────────────────

@addorder_router.callback_query(F.data == "ao:more", IsAdmin(), StateFilter(AddOrderWizard.next_step))
async def on_more(callback: CallbackQuery, state: FSMContext) -> None:
    assert isinstance(callback.message, Message)
    await callback.message.edit_reply_markup(reply_markup=None)
    await _ask_for_product(callback.message, state, edit=False)
    await callback.answer()


@addorder_router.callback_query(F.data == "ao:done", IsAdmin(), StateFilter(AddOrderWizard.next_step))
async def on_done(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    await _finalize(callback, state, db)


# ─── Finalization: bulk INSERT + post topic summary ──────────────────────────

async def _finalize(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    assert isinstance(callback.message, Message)
    items = await _items(state)

    if not items:
        await state.clear()
        await callback.message.edit_text(
            "ℹ️ ვერც ერთი ნივთი არ დაემატა. შეკვეთა გაუქმდა.",
            parse_mode=_PARSE,
        )
        await callback.answer()
        return

    requester_name: Optional[str] = None
    if callback.from_user:
        requester_name = (
            callback.from_user.full_name
            or callback.from_user.username
            or str(callback.from_user.id)
        )

    # DB insert is wrapped in a single transaction — partial failure rolls
    # back the whole batch so we never end up with half-saved orders.
    try:
        rows_to_insert = [
            {
                "product_id": item.get("product_id"),
                "quantity_needed": item["quantity"],
                "priority": item["priority"],
                "notes": (
                    f"manual /addorder by {requester_name or 'admin'}"
                    + (f" — freeform: {item['product_name']}" if item.get("is_freeform") else "")
                ),
            }
            for item in items
        ]
        order_ids = await db.create_orders_bulk(rows_to_insert)
    except Exception:
        logger.exception("create_orders_bulk failed for items=%r", items)
        # Critical: reset FSM so the user is never stuck mid-wizard after
        # a DB error. The transaction was rolled back — nothing was saved.
        await state.clear()
        await callback.message.edit_text(
            "❌ <b>შეცდომა შენახვისას.</b>\n"
            "მონაცემები არ შეინახა — სცადე თავიდან <code>/addorder</code>.",
            parse_mode=_PARSE,
        )
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    items_with_ids: List[Dict[str, Any]] = [
        {**item, "id": order_id}
        for item, order_id in zip(items, order_ids)
    ]

    # Always reset state immediately after the successful DB write — even
    # if the topic post fails, the orders are saved and the wizard is done.
    await state.clear()

    # Build + post the grouped summary into the ORDERS topic.
    summary_text = _format_topic_summary(items_with_ids, requester_name)
    try:
        await callback.bot.send_message(
            chat_id=config.GROUP_ID,
            message_thread_id=config.ORDERS_TOPIC_ID,
            text=summary_text,
            parse_mode=_PARSE,
        )
    except Exception as exc:
        logger.warning("Failed to post addorder summary to ORDERS topic: %s", exc)

    # Confirm to the admin in DM, replacing the loop keyboard.
    urgent_count = sum(1 for it in items_with_ids if it["priority"] == _PRIORITY_URGENT)
    low_count = sum(1 for it in items_with_ids if it["priority"] == _PRIORITY_LOW)
    await callback.message.edit_text(
        f"✅ <b>შეკვეთა შეინახა</b>\n\n"
        f"📦 ნივთები: <b>{len(items_with_ids)}</b> "
        f"(🚨 {urgent_count} · 🟢 {low_count})\n"
        f"📨 გაიგზავნა <i>ORDERS</i> ტოპიკში.",
        parse_mode=_PARSE,
    )
    await callback.answer("✅ შენახულია")
