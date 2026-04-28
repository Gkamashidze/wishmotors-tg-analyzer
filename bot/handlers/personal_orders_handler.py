"""
კერძო შეკვეთების სისტემა — პირადი შეკვეთების მართვა.

/po   — ბოლო 10 შეკვეთის სია inline ღილაკებით
/addpo — ახალი შეკვეთის FSM wizard (8 ნაბიჯი)

Callbacks:
  po_status:{id}  — სტატუსის შეცვლა
  po_pay:{id}     — გადახდის განახლება
  po_link:{id}    — tracking ლინკის ხელახლა გაგზავნა
  po_detail:{id}  — სრული ინფო (მფლობელის ვიუ)
"""
from __future__ import annotations

import html
import logging
import re
from datetime import date, datetime
from typing import Any

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
from bot.calendar_widget import SimpleCalendar, simple_cal_callback
from bot.handlers import IsAdmin
from database.db import Database

logger = logging.getLogger(__name__)
personal_orders_router = Router(name="personal_orders")

_PARSE = ParseMode.HTML
_PRIVATE = F.chat.type == ChatType.PRIVATE

_STATUS_LABELS: dict[str, str] = {
    "ordered":    "📦 შეკვეთილია",
    "in_transit": "🚚 გზაშია",
    "arrived":    "✅ ჩამოვიდა",
    "delivered":  "🎉 გადაეცა",
    "cancelled":  "❌ გაუქმდა",
}

_DATE_RE = re.compile(r"^(\d{2})\.(\d{2})\.(\d{4})$")


# ─── FSM States ──────────────────────────────────────────────────────────────

class AddPOStates(StatesGroup):
    customer_name    = State()
    customer_contact = State()
    part_name        = State()
    oem_code         = State()
    cost_price       = State()
    transport_vat    = State()
    sale_price_min   = State()
    sale_price       = State()
    arrival_date     = State()
    confirm          = State()


class PayPOStates(StatesGroup):
    amount = State()


# ─── Keyboard helpers ─────────────────────────────────────────────────────────

def _kb(*rows: list[InlineKeyboardButton]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=list(rows))


def _btn(text: str, data: str) -> InlineKeyboardButton:
    return InlineKeyboardButton(text=text, callback_data=data)


def _order_actions_kb(order_id: int) -> InlineKeyboardMarkup:
    return _kb(
        [_btn("💰 გადახდა", f"po_pay:{order_id}"), _btn("📋 სტატუსი", f"po_status:{order_id}")],
        [_btn("🔗 ლინკი", f"po_link:{order_id}"), _btn("ℹ️ დეტალები", f"po_detail:{order_id}")],
    )


def _status_kb(order_id: int) -> InlineKeyboardMarkup:
    return _kb(
        [_btn("📦 შეკვეთილია", f"po_set_status:{order_id}:ordered"),
         _btn("🚚 გზაშია", f"po_set_status:{order_id}:in_transit")],
        [_btn("✅ ჩამოვიდა", f"po_set_status:{order_id}:arrived"),
         _btn("🎉 გადაეცა", f"po_set_status:{order_id}:delivered")],
        [_btn("❌ გაუქმდა", f"po_set_status:{order_id}:cancelled")],
        [_btn("« უკან", f"po_detail:{order_id}")],
    )


# ─── Formatting helpers ───────────────────────────────────────────────────────

def _tracking_link(token: str) -> str:
    if config.DASHBOARD_URL:
        return f"{config.DASHBOARD_URL}/track/{token}"
    return f"(DASHBOARD_URL არ არის კონფიგურირებული — token: <code>{token}</code>)"


def _format_order_summary(order: Any) -> str:
    status = _STATUS_LABELS.get(order["status"], order["status"])
    arrival = ""
    if order.get("estimated_arrival"):
        arr = order["estimated_arrival"]
        if hasattr(arr, "strftime"):
            arrival = f"\n📅 ჩამოსვლა: <b>{arr.strftime('%d.%m.%Y')}</b>"
    remaining = float(order["sale_price"]) - float(order["amount_paid"])
    paid_line = (
        f"💳 გადახდილი: <b>₾{order['amount_paid']:.2f}</b> / "
        f"₾{order['sale_price']:.2f} "
        f"(დარჩა: <b>₾{remaining:.2f}</b>)"
    )
    oem = f" | OEM: <code>{html.escape(order['oem_code'])}</code>" if order.get("oem_code") else ""
    return (
        f"<b>{html.escape(order['part_name'])}</b>{oem}\n"
        f"👤 {html.escape(order['customer_name'])}\n"
        f"{status}{arrival}\n"
        f"{paid_line}"
    )


def _format_order_detail(order: Any) -> str:
    """Full owner-only view with financial breakdown."""
    status = _STATUS_LABELS.get(order["status"], order["status"])
    arrival = ""
    if order.get("estimated_arrival"):
        arr = order["estimated_arrival"]
        if hasattr(arr, "strftime"):
            arrival = f"\n📅 ჩამოსვლა: <b>{arr.strftime('%d.%m.%Y')}</b>"
    cost = float(order.get("cost_price") or 0)
    transport = float(order.get("transportation_cost") or 0)
    vat = float(order.get("vat_amount") or 0)
    sale = float(order["sale_price"])
    paid = float(order["amount_paid"])
    profit = sale - cost - transport - vat

    oem = f"\n🔖 OEM: <code>{html.escape(order['oem_code'])}</code>" if order.get("oem_code") else ""
    contact = f"\n📞 {html.escape(order['customer_contact'])}" if order.get("customer_contact") else ""
    notes_line = f"\n📝 {html.escape(order['notes'])}" if order.get("notes") else ""
    link = _tracking_link(order["tracking_token"])

    return (
        f"🧾 <b>შეკვეთა #{order['id']}</b>\n"
        f"━━━━━━━━━━━━━━━\n"
        f"📦 <b>{html.escape(order['part_name'])}</b>{oem}\n"
        f"👤 {html.escape(order['customer_name'])}{contact}\n"
        f"{status}{arrival}\n"
        f"━━━━━━━━━━━━━━━\n"
        f"💰 გასაყიდი: <b>₾{sale:.2f}</b>\n"
        f"💳 გადახდილი: <b>₾{paid:.2f}</b>  |  დარჩა: <b>₾{sale - paid:.2f}</b>\n"
        f"━━━━━━━━━━━━━━━\n"
        f"🏷 თვითღირ.: ₾{cost:.2f}\n"
        f"🚛 ტრანსპ.: ₾{transport:.2f}\n"
        f"🧾 დღგ: ₾{vat:.2f}\n"
        f"📈 მოგება: <b>₾{profit:.2f}</b>\n"
        f"━━━━━━━━━━━━━━━\n"
        f"🔗 {link}{notes_line}"
    )


# ─── /po — list orders ────────────────────────────────────────────────────────

@personal_orders_router.message(Command("po"), _PRIVATE, IsAdmin())
async def cmd_po(message: Message, db: Database) -> None:
    orders = await db.get_personal_orders(limit=10)
    if not orders:
        await message.answer("კერძო შეკვეთები არ გაქვს. დაამატე /addpo-ით.", parse_mode=_PARSE)
        return
    for order in orders:
        text = _format_order_summary(order)
        await message.answer(text, parse_mode=_PARSE, reply_markup=_order_actions_kb(order["id"]))


# ─── /addpo — create wizard ───────────────────────────────────────────────────

@personal_orders_router.message(Command("addpo"), _PRIVATE, IsAdmin())
async def cmd_addpo(message: Message, state: FSMContext) -> None:
    await state.clear()
    await state.set_state(AddPOStates.customer_name)
    await message.answer(
        "🆕 <b>ახალი კერძო შეკვეთა</b>\n\n"
        "<b>1/8</b> — მომხმარებლის სახელი:",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn("❌ გაუქმება", "po_cancel")]),
    )


@personal_orders_router.message(StateFilter(AddPOStates.customer_name), _PRIVATE)
async def po_got_customer_name(message: Message, state: FSMContext) -> None:
    if not message.text or not message.text.strip():
        await message.answer("სახელი ცარიელი ვერ იქნება.")
        return
    await state.update_data(customer_name=message.text.strip())
    await state.set_state(AddPOStates.customer_contact)
    await message.answer(
        "<b>2/8</b> — საკონტაქტო (ტელეფონი ან @username):\n"
        "არ გაქვს? — /skip",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn("⏭ გამოტოვება", "po_skip_contact"), _btn("❌ გაუქმება", "po_cancel")]),
    )


@personal_orders_router.callback_query(F.data == "po_skip_contact")
async def po_skip_contact(cb: CallbackQuery, state: FSMContext) -> None:
    await cb.answer()
    await state.update_data(customer_contact=None)
    await state.set_state(AddPOStates.part_name)
    await cb.message.edit_text(  # type: ignore[union-attr]
        "<b>3/8</b> — ნაწილის სახელი:",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn("❌ გაუქმება", "po_cancel")]),
    )


@personal_orders_router.message(StateFilter(AddPOStates.customer_contact), _PRIVATE)
async def po_got_contact(message: Message, state: FSMContext) -> None:
    text = message.text or ""
    if text.strip().lower() == "/skip":
        await state.update_data(customer_contact=None)
    else:
        await state.update_data(customer_contact=text.strip() or None)
    await state.set_state(AddPOStates.part_name)
    await message.answer(
        "<b>3/8</b> — ნაწილის სახელი:",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn("❌ გაუქმება", "po_cancel")]),
    )


@personal_orders_router.message(StateFilter(AddPOStates.part_name), _PRIVATE)
async def po_got_part_name(message: Message, state: FSMContext) -> None:
    if not message.text or not message.text.strip():
        await message.answer("ნაწილის სახელი ცარიელი ვერ იქნება.")
        return
    await state.update_data(part_name=message.text.strip())
    await state.set_state(AddPOStates.oem_code)
    await message.answer(
        "<b>4/8</b> — OEM კოდი (optional):\n"
        "არ გაქვს? — /skip",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn("⏭ გამოტოვება", "po_skip_oem"), _btn("❌ გაუქმება", "po_cancel")]),
    )


@personal_orders_router.callback_query(F.data == "po_skip_oem")
async def po_skip_oem(cb: CallbackQuery, state: FSMContext) -> None:
    await cb.answer()
    await state.update_data(oem_code=None)
    await state.set_state(AddPOStates.cost_price)
    await cb.message.edit_text(  # type: ignore[union-attr]
        "<b>5/8</b> — თვითღირებულება (₾):\n"
        "მაგ: <code>45.50</code>",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn("❌ გაუქმება", "po_cancel")]),
    )


@personal_orders_router.message(StateFilter(AddPOStates.oem_code), _PRIVATE)
async def po_got_oem(message: Message, state: FSMContext) -> None:
    text = message.text or ""
    if text.strip().lower() == "/skip":
        await state.update_data(oem_code=None)
    else:
        await state.update_data(oem_code=text.strip().upper() or None)
    await state.set_state(AddPOStates.cost_price)
    await message.answer(
        "<b>5/8</b> — თვითღირებულება (₾):\n"
        "მაგ: <code>45.50</code>",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn("❌ გაუქმება", "po_cancel")]),
    )


@personal_orders_router.message(StateFilter(AddPOStates.cost_price), _PRIVATE)
async def po_got_cost(message: Message, state: FSMContext) -> None:
    try:
        cost = float((message.text or "").replace(",", "."))
        if cost < 0:
            raise ValueError
    except ValueError:
        await message.answer("გთხოვ შეიყვანო დადებითი რიცხვი. მაგ: <code>45.50</code>", parse_mode=_PARSE)
        return
    await state.update_data(cost_price=cost)
    await state.set_state(AddPOStates.transport_vat)
    await message.answer(
        "<b>6/8</b> — ტრანსპორტი და დღგ (₾):\n"
        "შეიყვანე ორი რიცხვი მძიმით: <code>ტრანსპ, დღგ</code>\n"
        "მაგ: <code>12.50, 8.00</code>\n"
        "თუ არ გაქვს — <code>0, 0</code>",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn("❌ გაუქმება", "po_cancel")]),
    )


@personal_orders_router.message(StateFilter(AddPOStates.transport_vat), _PRIVATE)
async def po_got_transport_vat(message: Message, state: FSMContext) -> None:
    text = (message.text or "").replace(",", " ").split()
    try:
        transport = float(text[0].replace(",", "."))
        vat = float(text[1].replace(",", ".")) if len(text) > 1 else 0.0
        if transport < 0 or vat < 0:
            raise ValueError
    except (ValueError, IndexError):
        await message.answer(
            "ვერ ამოვიკითხე. შეიყვანე ასე: <code>12.50, 8.00</code>",
            parse_mode=_PARSE,
        )
        return
    await state.update_data(transportation_cost=transport, vat_amount=vat)
    await state.set_state(AddPOStates.sale_price_min)
    await message.answer(
        "<b>7/9</b> — გასაყიდი ფასი <b>დან</b> (₾):\n"
        "მინიმალური ფასი. მაგ: <code>100.00</code>\n"
        "არ იცი? — /skip",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn("⏭ გამოტოვება", "po_skip_price_min"), _btn("❌ გაუქმება", "po_cancel")]),
    )


@personal_orders_router.callback_query(F.data == "po_skip_price_min")
async def po_skip_price_min(cb: CallbackQuery, state: FSMContext) -> None:
    await cb.answer()
    await state.update_data(sale_price_min=None)
    await state.set_state(AddPOStates.sale_price)
    await cb.message.edit_text(  # type: ignore[union-attr]
        "<b>8/9</b> — გასაყიდი ფასი <b>მდე</b> (₾):\n"
        "მაქსიმალური / საბოლოო ფასი. მაგ: <code>150.00</code>",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn("❌ გაუქმება", "po_cancel")]),
    )


@personal_orders_router.message(StateFilter(AddPOStates.sale_price_min), _PRIVATE)
async def po_got_sale_price_min(message: Message, state: FSMContext) -> None:
    text = (message.text or "").strip()
    if text.lower() == "/skip":
        await state.update_data(sale_price_min=None)
    else:
        try:
            price_min = float(text.replace(",", "."))
            if price_min <= 0:
                raise ValueError
            await state.update_data(sale_price_min=price_min)
        except ValueError:
            await message.answer("გთხოვ შეიყვანო დადებითი რიცხვი ან /skip", parse_mode=_PARSE)
            return
    await state.set_state(AddPOStates.sale_price)
    await message.answer(
        "<b>8/9</b> — გასაყიდი ფასი <b>მდე</b> (₾):\n"
        "მაქსიმალური / საბოლოო ფასი. მაგ: <code>150.00</code>",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn("❌ გაუქმება", "po_cancel")]),
    )


@personal_orders_router.message(StateFilter(AddPOStates.sale_price), _PRIVATE)
async def po_got_sale_price(message: Message, state: FSMContext) -> None:
    try:
        price = float((message.text or "").replace(",", "."))
        if price <= 0:
            raise ValueError
    except ValueError:
        await message.answer("გთხოვ შეიყვანო დადებითი რიცხვი. მაგ: <code>150.00</code>", parse_mode=_PARSE)
        return
    await state.update_data(sale_price=price)
    await state.set_state(AddPOStates.arrival_date)
    cal = SimpleCalendar()
    now = datetime.now()
    markup = await cal.start_calendar(year=now.year, month=now.month)
    await message.answer(
        "<b>9/9</b> — სავარაუდო ჩამოსვლის თარიღი:\n"
        "აირჩიე კალენდრიდან ან შეიყვანე: <code>dd.mm.yyyy</code>\n"
        "თუ არ იცი — /skip",
        parse_mode=_PARSE,
        reply_markup=markup,
    )


@personal_orders_router.callback_query(simple_cal_callback.filter(), StateFilter(AddPOStates.arrival_date))
async def po_calendar_selected(cb: CallbackQuery, callback_data: simple_cal_callback, state: FSMContext) -> None:  # type: ignore[name-defined]
    cal = SimpleCalendar()
    selected, chosen_date = await cal.process_selection(cb, callback_data)
    if selected and chosen_date:
        await state.update_data(estimated_arrival=chosen_date.date())
        await _show_po_confirm(cb.message, state)  # type: ignore[arg-type]


@personal_orders_router.message(StateFilter(AddPOStates.arrival_date), _PRIVATE)
async def po_got_date_text(message: Message, state: FSMContext) -> None:
    text = (message.text or "").strip()
    if text.lower() == "/skip":
        await state.update_data(estimated_arrival=None)
        await _show_po_confirm(message, state)
        return
    m = _DATE_RE.match(text)
    if not m:
        await message.answer("ფორმატი: <code>dd.mm.yyyy</code> ან /skip", parse_mode=_PARSE)
        return
    try:
        arrival = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    except ValueError:
        await message.answer("არასწორი თარიღი. სცადე: <code>15.05.2025</code>", parse_mode=_PARSE)
        return
    await state.update_data(estimated_arrival=arrival)
    await _show_po_confirm(message, state)


async def _show_po_confirm(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    arrival_str = ""
    arr = data.get("estimated_arrival")
    if arr and hasattr(arr, "strftime"):
        arrival_str = f"\n📅 ჩამოსვლა: {arr.strftime('%d.%m.%Y')}"
    oem_str = f" | OEM: <code>{html.escape(data.get('oem_code') or '')}</code>" if data.get("oem_code") else ""
    contact_str = f"\n📞 {html.escape(data.get('customer_contact') or '')}" if data.get("customer_contact") else ""
    cost = data.get("cost_price", 0)
    transport = data.get("transportation_cost", 0)
    vat = data.get("vat_amount", 0)
    sale = data.get("sale_price", 0)
    sale_min = data.get("sale_price_min")
    profit = float(sale) - float(cost) - float(transport) - float(vat)
    price_range = (
        f"₾{float(sale_min):.2f} — ₾{float(sale):.2f}"
        if sale_min else f"₾{float(sale):.2f}"
    )

    await state.set_state(AddPOStates.confirm)
    await message.answer(
        f"✅ <b>დადასტურება</b>\n\n"
        f"📦 <b>{html.escape(data['part_name'])}</b>{oem_str}\n"
        f"👤 {html.escape(data['customer_name'])}{contact_str}\n"
        f"{arrival_str}\n"
        f"━━━━━━━━━━━━━━━\n"
        f"🏷 თვითღირ.: ₾{float(cost):.2f}\n"
        f"🚛 ტრანსპ.: ₾{float(transport):.2f}\n"
        f"🧾 დღგ: ₾{float(vat):.2f}\n"
        f"💰 გასაყიდი: {price_range}\n"
        f"📈 მოგება: ₾{profit:.2f}",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [_btn("✅ შენახვა", "po_confirm_save"), _btn("❌ გაუქმება", "po_cancel")],
        ),
    )


@personal_orders_router.callback_query(F.data == "po_confirm_save", StateFilter(AddPOStates.confirm))
async def po_confirm_save(cb: CallbackQuery, state: FSMContext, db: Database) -> None:
    await cb.answer()
    data = await state.get_data()
    await state.clear()
    try:
        order = await db.create_personal_order(
            customer_name=data["customer_name"],
            part_name=data["part_name"],
            sale_price=float(data["sale_price"]),
            customer_contact=data.get("customer_contact"),
            oem_code=data.get("oem_code"),
            cost_price=float(data["cost_price"]) if data.get("cost_price") is not None else None,
            transportation_cost=float(data["transportation_cost"]) if data.get("transportation_cost") is not None else None,
            vat_amount=float(data["vat_amount"]) if data.get("vat_amount") is not None else None,
            sale_price_min=float(data["sale_price_min"]) if data.get("sale_price_min") is not None else None,
            estimated_arrival=data.get("estimated_arrival"),
        )
    except Exception:
        logger.exception("Failed to create personal order")
        await cb.message.edit_text("❌ შეცდომა შენახვისას. სცადე ხელახლა.", parse_mode=_PARSE)  # type: ignore[union-attr]
        return

    link = _tracking_link(order["tracking_token"])
    await cb.message.edit_text(  # type: ignore[union-attr]
        f"✅ შეკვეთა <b>#{order['id']}</b> შეინახა!\n\n"
        f"📦 {html.escape(order['part_name'])}\n"
        f"👤 {html.escape(order['customer_name'])}\n\n"
        f"🔗 მომხმარებლის ლინკი:\n{link}",
        parse_mode=_PARSE,
        reply_markup=_order_actions_kb(order["id"]),
    )


# ─── po_cancel ────────────────────────────────────────────────────────────────

@personal_orders_router.callback_query(F.data == "po_cancel")
async def po_cancel(cb: CallbackQuery, state: FSMContext) -> None:
    await cb.answer()
    await state.clear()
    await cb.message.edit_text("❌ გაუქმდა.", parse_mode=_PARSE)  # type: ignore[union-attr]


# ─── po_detail:{id} ───────────────────────────────────────────────────────────

@personal_orders_router.callback_query(F.data.startswith("po_detail:"), IsAdmin())
async def po_detail(cb: CallbackQuery, db: Database) -> None:
    await cb.answer()
    order_id = int(cb.data.split(":")[1])  # type: ignore[union-attr]
    order = await db.get_personal_order_by_id(order_id)
    if not order:
        await cb.answer("შეკვეთა ვერ მოიძებნა.", show_alert=True)
        return
    await cb.message.edit_text(  # type: ignore[union-attr]
        _format_order_detail(order),
        parse_mode=_PARSE,
        reply_markup=_order_actions_kb(order_id),
    )


# ─── po_status:{id} ──────────────────────────────────────────────────────────

@personal_orders_router.callback_query(F.data.startswith("po_status:"), IsAdmin())
async def po_status_menu(cb: CallbackQuery, db: Database) -> None:
    await cb.answer()
    order_id = int(cb.data.split(":")[1])  # type: ignore[union-attr]
    order = await db.get_personal_order_by_id(order_id)
    if not order:
        await cb.answer("შეკვეთა ვერ მოიძებნა.", show_alert=True)
        return
    current = _STATUS_LABELS.get(order["status"], order["status"])
    await cb.message.edit_text(  # type: ignore[union-attr]
        f"📋 <b>სტატუსის შეცვლა</b>\n"
        f"შეკვეთა #{order_id} | ახლა: {current}",
        parse_mode=_PARSE,
        reply_markup=_status_kb(order_id),
    )


@personal_orders_router.callback_query(F.data.startswith("po_set_status:"), IsAdmin())
async def po_set_status(cb: CallbackQuery, db: Database) -> None:
    await cb.answer()
    parts = (cb.data or "").split(":")
    order_id = int(parts[1])
    new_status = parts[2]
    await db.update_personal_order(order_id, status=new_status)
    order = await db.get_personal_order_by_id(order_id)
    if not order:
        return
    await cb.message.edit_text(  # type: ignore[union-attr]
        _format_order_detail(order),
        parse_mode=_PARSE,
        reply_markup=_order_actions_kb(order_id),
    )


# ─── po_pay:{id} ─────────────────────────────────────────────────────────────

@personal_orders_router.callback_query(F.data.startswith("po_pay:"), IsAdmin())
async def po_pay_prompt(cb: CallbackQuery, state: FSMContext, db: Database) -> None:
    await cb.answer()
    order_id = int(cb.data.split(":")[1])  # type: ignore[union-attr]
    order = await db.get_personal_order_by_id(order_id)
    if not order:
        await cb.answer("შეკვეთა ვერ მოიძებნა.", show_alert=True)
        return
    remaining = float(order["sale_price"]) - float(order["amount_paid"])
    await state.set_state(PayPOStates.amount)
    await state.update_data(pay_order_id=order_id, current_paid=float(order["amount_paid"]))
    await cb.message.answer(  # type: ignore[union-attr]
        f"💰 შეკვეთა #{order_id}\n"
        f"სრული ფასი: ₾{order['sale_price']:.2f}\n"
        f"გადახდილი: ₾{order['amount_paid']:.2f}\n"
        f"დარჩენილია: ₾{remaining:.2f}\n\n"
        f"<b>შეიყვანე ახალი გადახდილი თანხა (სულ, არა დამატებით):</b>",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn("❌ გაუქმება", "po_pay_cancel")]),
    )


@personal_orders_router.message(StateFilter(PayPOStates.amount), _PRIVATE)
async def po_pay_amount(message: Message, state: FSMContext, db: Database) -> None:
    try:
        amount = float((message.text or "").replace(",", "."))
        if amount < 0:
            raise ValueError
    except ValueError:
        await message.answer("გთხოვ შეიყვანო დადებითი რიცხვი.", parse_mode=_PARSE)
        return
    data = await state.get_data()
    order_id = data["pay_order_id"]
    await state.clear()
    await db.update_personal_order_payment(order_id, amount)
    order = await db.get_personal_order_by_id(order_id)
    if not order:
        return
    remaining = float(order["sale_price"]) - float(order["amount_paid"])
    await message.answer(
        f"✅ გადახდა განახლდა!\n"
        f"შეკვეთა #{order_id} — გადახდილია: <b>₾{order['amount_paid']:.2f}</b>\n"
        f"დარჩენილია: <b>₾{remaining:.2f}</b>",
        parse_mode=_PARSE,
        reply_markup=_order_actions_kb(order_id),
    )


@personal_orders_router.callback_query(F.data == "po_pay_cancel")
async def po_pay_cancel(cb: CallbackQuery, state: FSMContext) -> None:
    await cb.answer()
    await state.clear()
    await cb.message.edit_text("❌ გაუქმდა.", parse_mode=_PARSE)  # type: ignore[union-attr]


# ─── po_link:{id} ────────────────────────────────────────────────────────────

@personal_orders_router.callback_query(F.data.startswith("po_link:"), IsAdmin())
async def po_link(cb: CallbackQuery, db: Database) -> None:
    await cb.answer()
    order_id = int(cb.data.split(":")[1])  # type: ignore[union-attr]
    order = await db.get_personal_order_by_id(order_id)
    if not order:
        await cb.answer("შეკვეთა ვერ მოიძებნა.", show_alert=True)
        return
    link = _tracking_link(order["tracking_token"])
    await cb.message.answer(  # type: ignore[union-attr]
        f"🔗 <b>Tracking ლინკი</b> — შეკვეთა #{order_id}\n\n"
        f"{link}",
        parse_mode=_PARSE,
    )
