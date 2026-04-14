"""
Wizard-style DM entry for Sales, Nisias, and Expenses.
Each flow guides the admin through steps with inline buttons.
Only works in private (DM) chat; confirmed entries are saved to DB
and mirrored to the relevant group topic.

Multi-item sessions: after saving, the user can tap ➕ to add another
item of the same type without restarting from the /new menu.

Edit: tapping ✏️ on any confirmation opens a field-level edit wizard.
"""
import html
import logging
from typing import Optional

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
from bot.reports.formatter import (
    format_topic_expense,
    format_topic_nisia,
    format_topic_sale,
)
from database.db import Database

logger = logging.getLogger(__name__)
wizard_router = Router(name="wizard")

_PARSE = ParseMode.HTML
_PRIVATE = F.chat.type == ChatType.PRIVATE

# ─── Shared helpers ────────────────────────────────────────────────────────────

def _kb(*rows: list) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=list(rows))


def _btn(text: str, data: str) -> InlineKeyboardButton:
    return InlineKeyboardButton(text=text, callback_data=data)


_CANCEL = _btn("❌ გაუქმება", "wiz:cancel")
_CANCEL_ROW = [_CANCEL]


def _e(v: object) -> str:
    return html.escape(str(v))


def _sale_action_kb(sale_id: int) -> InlineKeyboardMarkup:
    """Buttons shown after saving a sale (delete + edit + more + done)."""
    return _kb(
        [_btn(f"🗑 წაშლა #{sale_id}", f"ds:{sale_id}"),
         _btn(f"✏️ რედ. #{sale_id}", f"edit:sale:{sale_id}")],
        [_btn("➕ კიდევ ერთი", "wiz:more:sale"),
         _btn("✅ დასრულება", "wiz:done:sale")],
    )


def _nisia_action_kb(sale_id: int) -> InlineKeyboardMarkup:
    """Buttons shown after saving a nisia (delete + edit + more same customer + done)."""
    return _kb(
        [_btn(f"🗑 წაშლა #{sale_id}", f"ds:{sale_id}"),
         _btn(f"✏️ რედ. #{sale_id}", f"edit:sale:{sale_id}")],
        [_btn("➕ კიდევ ერთი (იმავე კლ.)", "wiz:more:nisia"),
         _btn("✅ დასრულება", "wiz:done:nisia")],
    )


def _expense_action_kb(expense_id: int) -> InlineKeyboardMarkup:
    """Buttons shown after saving an expense (edit + more + done)."""
    return _kb(
        [_btn(f"✏️ რედ. #{expense_id}", f"edit:exp:{expense_id}")],
        [_btn("➕ კიდევ ერთი", "wiz:more:expense"),
         _btn("✅ დასრულება", "wiz:done:expense")],
    )


# ─── State groups ──────────────────────────────────────────────────────────────

class SaleWizard(StatesGroup):
    product    = State()   # user types OEM / name
    select     = State()   # choose from list (if multiple matches)
    quantity   = State()   # how many units
    price_type = State()   # unit price or total amount
    price      = State()   # numeric input
    payment    = State()   # ხელზე / დარიცხა / ნისია
    confirm    = State()   # final review


class NisiaWizard(StatesGroup):
    customer   = State()   # name / phone / both
    product    = State()
    select     = State()
    quantity   = State()
    price_type = State()
    price      = State()
    confirm    = State()


class ExpenseWizard(StatesGroup):
    category   = State()   # inline buttons
    custom_cat = State()   # freeform when "სხვა" chosen
    amount     = State()
    description = State()
    confirm    = State()


class SaleEditWizard(StatesGroup):
    field   = State()   # user picks which field to change
    value   = State()   # user types new value (or picks via buttons)
    confirm = State()   # final confirmation


class ExpenseEditWizard(StatesGroup):
    field   = State()
    value   = State()
    confirm = State()


# ─── /new — main menu ─────────────────────────────────────────────────────────

@wizard_router.message(Command("new"), IsAdmin(), _PRIVATE)
async def cmd_new(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer(
        "🛠 <b>რა გსურს ჩაიწეროს?</b>",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [_btn("➕ გაყიდვა",  "wiz:main:sale")],
            [_btn("💳 ნისია",    "wiz:main:nisia")],
            [_btn("💸 ხარჯი",   "wiz:main:expense")],
        ),
    )


# ─── Cancel (works from any wizard state) ─────────────────────────────────────

@wizard_router.callback_query(F.data == "wiz:cancel", IsAdmin())
async def cb_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.edit_text("❌ <b>გაუქმებულია.</b>", parse_mode=_PARSE)


# ─── Session "done" handlers ─────────────────────────────────────────────────

@wizard_router.callback_query(F.data.in_({"wiz:done:sale", "wiz:done:nisia", "wiz:done:expense"}), IsAdmin())
async def cb_done(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.edit_reply_markup(reply_markup=None)
    await callback.answer("✅ სესია დასრულდა", show_alert=False)


# ─── "Add more" handlers ──────────────────────────────────────────────────────

@wizard_router.callback_query(F.data == "wiz:more:sale", IsAdmin())
async def cb_more_sale(callback: CallbackQuery, state: FSMContext) -> None:
    """User wants to add another sale item in the same session."""
    await callback.message.edit_reply_markup(reply_markup=None)
    await state.set_state(SaleWizard.product)
    await state.set_data({})
    await callback.message.answer(
        "➕ <b>მომდევნო გაყიდვა</b>\n\n"
        "ჩაწერე პროდუქტის <b>OEM კოდი</b> ან <b>დასახელება</b>:",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )
    await callback.answer()


@wizard_router.callback_query(F.data == "wiz:more:nisia", IsAdmin())
async def cb_more_nisia(callback: CallbackQuery, state: FSMContext) -> None:
    """User wants to add another nisia for the same customer."""
    d = await state.get_data()
    customer = d.get("customer_name", "")
    await callback.message.edit_reply_markup(reply_markup=None)
    await state.set_state(NisiaWizard.product)
    await state.set_data({"customer_name": customer})
    await callback.message.answer(
        f"💳 <b>კიდევ ერთი ნისია</b>\n"
        f"👤 კლიენტი: <b>{_e(customer)}</b>\n\n"
        "ჩაწერე პროდუქტის <b>OEM კოდი</b> ან <b>დასახელება</b>:",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )
    await callback.answer()


@wizard_router.callback_query(F.data == "wiz:more:expense", IsAdmin())
async def cb_more_expense(callback: CallbackQuery, state: FSMContext) -> None:
    """User wants to add another expense."""
    await callback.message.edit_reply_markup(reply_markup=None)
    await state.set_state(ExpenseWizard.category)
    await state.set_data({})
    await callback.message.answer(
        "💸 <b>მომდევნო ხარჯი</b>\n\nაირჩიე კატეგორია:",
        parse_mode=_PARSE,
        reply_markup=_category_kb(),
    )
    await callback.answer()


# ═══════════════════════════════════════════════════════════════════════════════
# SALE WIZARD
# ═══════════════════════════════════════════════════════════════════════════════

@wizard_router.callback_query(F.data == "wiz:main:sale", IsAdmin())
async def sale_start(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(SaleWizard.product)
    await callback.message.edit_text(
        "➕ <b>გაყიდვა — ნაბიჯი 1/5</b>\n\n"
        "ჩაწერე პროდუქტის <b>OEM კოდი</b> ან <b>დასახელება</b>:",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )


@wizard_router.message(SaleWizard.product, IsAdmin(), _PRIVATE)
async def sale_product_input(message: Message, state: FSMContext, db: Database) -> None:
    await _handle_product_search(message, state, db, wizard="sale")


@wizard_router.callback_query(F.data.startswith("wiz:prod:"), IsAdmin(), StateFilter(SaleWizard.select))
async def sale_product_selected(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    await _handle_product_selected(callback, state, db, wizard="sale")


@wizard_router.message(SaleWizard.quantity, IsAdmin(), _PRIVATE)
async def sale_quantity(message: Message, state: FSMContext) -> None:
    await _handle_quantity(message, state, wizard="sale")


@wizard_router.callback_query(F.data.startswith("wiz:price:"), IsAdmin(), StateFilter(SaleWizard.price_type))
async def sale_price_type(callback: CallbackQuery, state: FSMContext) -> None:
    await _handle_price_type(callback, state, wizard="sale")


@wizard_router.message(SaleWizard.price, IsAdmin(), _PRIVATE)
async def sale_price_input(message: Message, state: FSMContext) -> None:
    await _handle_price_input(message, state, wizard="sale")


@wizard_router.callback_query(F.data.startswith("wiz:pay:"), IsAdmin(), StateFilter(SaleWizard.payment))
async def sale_payment(callback: CallbackQuery, state: FSMContext) -> None:
    data_key = callback.data.split(":", 2)[2]  # cash / transfer / credit
    await state.update_data(payment=data_key)
    await state.set_state(SaleWizard.confirm)
    await _show_sale_confirm(callback.message, state, edit=True)


@wizard_router.callback_query(F.data == "wiz:confirm:yes", IsAdmin(), StateFilter(SaleWizard.confirm))
async def sale_confirm(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    d = await state.get_data()

    product_id: Optional[int] = d.get("product_id")
    product_name: str         = d["product_name"]
    qty: int                  = d["quantity"]
    price: float              = d["unit_price"]
    payment: str              = d["payment"]
    is_freeform: bool         = d.get("is_freeform", False)

    sale_id, new_stock = await db.create_sale(
        product_id=product_id,
        quantity=qty,
        unit_price=price,
        payment_method=payment,
    )

    # Auto-order at zero stock
    if product_id is not None and new_stock <= 0:
        product = await db.get_product_by_id(product_id)
        if product:
            await db.create_order(
                product_id=product_id,
                quantity_needed=product["min_stock"] or 1,
                notes=f"ავტო: {product['name']} — {new_stock}ც",
            )

    # Ready for another item in the same session
    await state.set_state(SaleWizard.product)
    await state.set_data({})

    total = qty * price
    stock_line = ""
    if product_id is not None and new_stock is not None:
        stock_line = f"\n📊 დარჩა საწყობში: <b>{new_stock}ც</b>"
        if new_stock < 0:
            stock_line += " ⚠️ (მინუსი!)"

    pay_label = {"cash": "ხელზე 💵", "transfer": "დარიცხა 🏦", "credit": "ნისია 📋"}.get(payment, payment)
    unknown_note = "\n<i>⚠️ პროდუქტი ბაზაში არ არის</i>" if is_freeform else ""

    await callback.message.edit_text(
        f"✅ <b>გაყიდვა #{sale_id} დაფიქსირდა</b>\n"
        f"📦 {_e(product_name)}\n"
        f"💰 {qty}ც × {price:.2f}₾ = <b>{total:.2f}₾</b>\n"
        f"💳 {pay_label}"
        f"{stock_line}"
        f"{unknown_note}",
        parse_mode=_PARSE,
        reply_markup=_sale_action_kb(sale_id),
    )

    # Mirror to topic and save message_id for later deletion/edit
    topic_id = config.NISIAS_TOPIC_ID if payment == "credit" else config.SALES_TOPIC_ID
    try:
        topic_msg = await callback.bot.send_message(
            chat_id=config.GROUP_ID,
            message_thread_id=topic_id,
            text=format_topic_sale(
                product_name=product_name,
                qty=qty,
                price=price,
                payment=payment,
                sale_id=sale_id,
                unknown_product=is_freeform,
            ),
            parse_mode=_PARSE,
        )
        await db.update_sale_topic_message(sale_id, topic_id, topic_msg.message_id)
    except Exception as exc:
        logger.warning("Failed to post sale to topic: %s", exc)


@wizard_router.callback_query(F.data == "wiz:confirm:no", IsAdmin(), StateFilter(SaleWizard.confirm))
async def sale_confirm_no(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.edit_text("❌ <b>გაყიდვა გაუქმებულია.</b>", parse_mode=_PARSE)


# ═══════════════════════════════════════════════════════════════════════════════
# NISIA WIZARD
# ═══════════════════════════════════════════════════════════════════════════════

@wizard_router.callback_query(F.data == "wiz:main:nisia", IsAdmin())
async def nisia_start(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(NisiaWizard.customer)
    await callback.message.edit_text(
        "💳 <b>ნისია — ნაბიჯი 1/5</b>\n\n"
        "ჩაწერე კლიენტის <b>სახელი</b>, <b>ტელეფონი</b> ან <b>ორივე</b>:\n"
        "<i>მაგ: გიო | 599123456 | გიო 599123456</i>",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )


@wizard_router.message(NisiaWizard.customer, IsAdmin(), _PRIVATE)
async def nisia_customer_input(message: Message, state: FSMContext, db: Database) -> None:
    customer = (message.text or "").strip()
    if not customer:
        await message.answer("⚠️ ჩაწერე სახელი ან ტელეფონი.", parse_mode=_PARSE)
        return

    await state.update_data(customer_name=customer)

    # Show existing debt if any
    credit_sales = await db.get_credit_sales()
    existing = [s for s in credit_sales if (s.get("customer_name") or "").lower() == customer.lower()]
    debt_note = ""
    if existing:
        debt = sum(float(s["unit_price"]) * s["quantity"] for s in existing)
        debt_note = f"\n<i>📋 ამ კლიენტს უკვე აქვს <b>{debt:.2f}₾</b> ნისია</i>"

    await state.set_state(NisiaWizard.product)
    await message.answer(
        f"💳 <b>ნისია — ნაბიჯი 2/5</b>\n"
        f"👤 კლიენტი: <b>{_e(customer)}</b>{debt_note}\n\n"
        "ჩაწერე პროდუქტის <b>OEM კოდი</b> ან <b>დასახელება</b>:",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )


@wizard_router.message(NisiaWizard.product, IsAdmin(), _PRIVATE)
async def nisia_product_input(message: Message, state: FSMContext, db: Database) -> None:
    await _handle_product_search(message, state, db, wizard="nisia")


@wizard_router.callback_query(F.data.startswith("wiz:prod:"), IsAdmin(), StateFilter(NisiaWizard.select))
async def nisia_product_selected(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    await _handle_product_selected(callback, state, db, wizard="nisia")


@wizard_router.message(NisiaWizard.quantity, IsAdmin(), _PRIVATE)
async def nisia_quantity(message: Message, state: FSMContext) -> None:
    await _handle_quantity(message, state, wizard="nisia")


@wizard_router.callback_query(F.data.startswith("wiz:price:"), IsAdmin(), StateFilter(NisiaWizard.price_type))
async def nisia_price_type(callback: CallbackQuery, state: FSMContext) -> None:
    await _handle_price_type(callback, state, wizard="nisia")


@wizard_router.message(NisiaWizard.price, IsAdmin(), _PRIVATE)
async def nisia_price_input(message: Message, state: FSMContext) -> None:
    await _handle_price_input(message, state, wizard="nisia")


@wizard_router.callback_query(F.data == "wiz:confirm:yes", IsAdmin(), StateFilter(NisiaWizard.confirm))
async def nisia_confirm(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    d = await state.get_data()

    product_id: Optional[int] = d.get("product_id")
    product_name: str         = d["product_name"]
    qty: int                  = d["quantity"]
    price: float              = d["unit_price"]
    customer: str             = d["customer_name"]
    is_freeform: bool         = d.get("is_freeform", False)

    sale_id, new_stock = await db.create_sale(
        product_id=product_id,
        quantity=qty,
        unit_price=price,
        payment_method="credit",
        customer_name=customer,
        notes=product_name if is_freeform else None,
    )

    # Keep customer in state for "add more" button
    await state.set_state(NisiaWizard.product)
    await state.set_data({"customer_name": customer})

    total = qty * price
    unknown_note = "\n<i>⚠️ პროდუქტი ბაზაში არ არის</i>" if is_freeform else ""
    stock_line = ""
    if product_id is not None and new_stock is not None:
        stock_line = f"\n📊 დარჩა საწყობში: <b>{new_stock}ც</b>"
        if new_stock < 0:
            stock_line += " ⚠️"

    await callback.message.edit_text(
        f"✅ <b>ნისია #{sale_id} დაფიქსირდა</b>\n"
        f"👤 {_e(customer)}\n"
        f"📦 {_e(product_name)}\n"
        f"💰 {qty}ც × {price:.2f}₾ = <b>{total:.2f}₾</b>"
        f"{stock_line}"
        f"{unknown_note}",
        parse_mode=_PARSE,
        reply_markup=_nisia_action_kb(sale_id),
    )

    try:
        topic_msg = await callback.bot.send_message(
            chat_id=config.GROUP_ID,
            message_thread_id=config.NISIAS_TOPIC_ID,
            text=format_topic_nisia(
                customer_name=customer,
                product_name=product_name,
                qty=qty,
                price=price,
                sale_id=sale_id,
                unknown_product=is_freeform,
            ),
            parse_mode=_PARSE,
        )
        await db.update_sale_topic_message(sale_id, config.NISIAS_TOPIC_ID, topic_msg.message_id)
    except Exception as exc:
        logger.warning("Failed to post nisia to topic: %s", exc)


@wizard_router.callback_query(F.data == "wiz:confirm:no", IsAdmin(), StateFilter(NisiaWizard.confirm))
async def nisia_confirm_no(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.edit_text("❌ <b>ნისია გაუქმებულია.</b>", parse_mode=_PARSE)


# ═══════════════════════════════════════════════════════════════════════════════
# EXPENSE WIZARD
# ═══════════════════════════════════════════════════════════════════════════════

_EXPENSE_CATEGORIES = [
    ("⛽ საწვავი",    "fuel"),
    ("🚚 მიტანა",     "delivery"),
    ("🛃 საბაჟო",    "customs"),
    ("🔧 სერვისი",   "maintenance"),
    ("📣 რეკლამა",   "marketing"),
    ("🖊 ოფისი",     "office"),
    ("💡 კომუნალი",  "utilities"),
    ("👷 ხელფასი",   "salary"),
    ("🚗 ტრანსპ.",   "transport"),
    ("➕ სხვა",      "other"),
]


def _category_kb() -> InlineKeyboardMarkup:
    rows = []
    for i in range(0, len(_EXPENSE_CATEGORIES), 2):
        pair = _EXPENSE_CATEGORIES[i:i + 2]
        rows.append([_btn(label, f"wiz:cat:{key}") for label, key in pair])
    rows.append(_CANCEL_ROW)
    return InlineKeyboardMarkup(inline_keyboard=rows)


@wizard_router.callback_query(F.data == "wiz:main:expense", IsAdmin())
async def expense_start(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(ExpenseWizard.category)
    await callback.message.edit_text(
        "💸 <b>ხარჯი — ნაბიჯი 1/3</b>\n\nაირჩიე კატეგორია:",
        parse_mode=_PARSE,
        reply_markup=_category_kb(),
    )


@wizard_router.callback_query(F.data.startswith("wiz:cat:"), IsAdmin(), StateFilter(ExpenseWizard.category))
async def expense_category(callback: CallbackQuery, state: FSMContext) -> None:
    key = callback.data.split(":", 2)[2]
    if key == "other":
        await state.set_state(ExpenseWizard.custom_cat)
        await callback.message.edit_text(
            "💸 <b>ხარჯი</b>\n\nჩაწერე კატეგორიის სახელი:",
            parse_mode=_PARSE,
            reply_markup=_kb(_CANCEL_ROW),
        )
        return

    label = next((lbl for lbl, k in _EXPENSE_CATEGORIES if k == key), key)
    await state.update_data(category=key, category_label=label)
    await state.set_state(ExpenseWizard.amount)
    await callback.message.edit_text(
        f"💸 <b>ხარჯი — ნაბიჯი 2/3</b>\n"
        f"🏷 კატეგორია: {label}\n\n"
        "ჩაწერე თანხა (₾):",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )


@wizard_router.message(ExpenseWizard.custom_cat, IsAdmin(), _PRIVATE)
async def expense_custom_category(message: Message, state: FSMContext) -> None:
    cat_text = (message.text or "").strip()
    if not cat_text:
        await message.answer("⚠️ ჩაწერე კატეგორია.", parse_mode=_PARSE)
        return
    await state.update_data(category="other", category_label=cat_text)
    await state.set_state(ExpenseWizard.amount)
    await message.answer(
        f"💸 <b>ხარჯი — ნაბიჯი 2/3</b>\n"
        f"🏷 კატეგორია: {_e(cat_text)}\n\n"
        "ჩაწერე თანხა (₾):",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )


@wizard_router.message(ExpenseWizard.amount, IsAdmin(), _PRIVATE)
async def expense_amount(message: Message, state: FSMContext) -> None:
    try:
        amount = float((message.text or "").strip().replace(",", ".").replace("₾", "").replace("ლ", ""))
        if amount <= 0:
            raise ValueError
    except ValueError:
        await message.answer("⚠️ ჩაწერე სწორი თანხა, მაგ: <code>50</code> ან <code>12.50</code>", parse_mode=_PARSE)
        return

    await state.update_data(amount=amount)
    await state.set_state(ExpenseWizard.description)
    await message.answer(
        "💸 <b>ხარჯი — ნაბიჯი 3/3</b>\n\n"
        "დაამატე მოკლე <b>აღწერა</b> (სურვილისამებრ):",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [_btn("⏭ გამოტოვება", "wiz:desc:skip")],
            _CANCEL_ROW,
        ),
    )


@wizard_router.callback_query(F.data == "wiz:desc:skip", IsAdmin(), StateFilter(ExpenseWizard.description))
async def expense_desc_skip(callback: CallbackQuery, state: FSMContext) -> None:
    await state.update_data(description=None)
    await state.set_state(ExpenseWizard.confirm)
    await _show_expense_confirm(callback.message, state, edit=True)


@wizard_router.message(ExpenseWizard.description, IsAdmin(), _PRIVATE)
async def expense_description(message: Message, state: FSMContext) -> None:
    desc = (message.text or "").strip() or None
    await state.update_data(description=desc)
    await state.set_state(ExpenseWizard.confirm)
    await _show_expense_confirm(message, state, edit=False)


@wizard_router.callback_query(F.data == "wiz:confirm:yes", IsAdmin(), StateFilter(ExpenseWizard.confirm))
async def expense_confirm(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    d = await state.get_data()

    amount: float               = d["amount"]
    category: str               = d.get("category") or "other"
    category_label: str         = d.get("category_label", "")
    description: Optional[str]  = d.get("description")

    db_category = None if category == "other" else category
    expense_id = await db.create_expense(
        amount=amount,
        description=description or category_label,
        category=db_category,
    )

    # Ready for another expense in the same session
    await state.set_state(ExpenseWizard.category)
    await state.set_data({})

    desc_line = f"\n📝 {_e(description)}" if description else ""
    await callback.message.edit_text(
        f"✅ <b>ხარჯი #{expense_id} დაფიქსირდა</b>\n"
        f"🏷 {_e(category_label)}\n"
        f"💰 <b>{amount:.2f}₾</b>"
        f"{desc_line}",
        parse_mode=_PARSE,
        reply_markup=_expense_action_kb(expense_id),
    )

    try:
        topic_msg = await callback.bot.send_message(
            chat_id=config.GROUP_ID,
            message_thread_id=config.EXPENSES_TOPIC_ID,
            text=format_topic_expense(
                amount=amount,
                category=db_category,
                description=description or category_label,
                expense_id=expense_id,
            ),
            parse_mode=_PARSE,
        )
        await db.update_expense_topic_message(expense_id, config.EXPENSES_TOPIC_ID, topic_msg.message_id)
    except Exception as exc:
        logger.warning("Failed to post expense to topic: %s", exc)


@wizard_router.callback_query(F.data == "wiz:confirm:no", IsAdmin(), StateFilter(ExpenseWizard.confirm))
async def expense_confirm_no(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.edit_text("❌ <b>ხარჯი გაუქმებულია.</b>", parse_mode=_PARSE)


# ═══════════════════════════════════════════════════════════════════════════════
# SALE EDIT WIZARD
# ═══════════════════════════════════════════════════════════════════════════════

_SALE_FIELDS = {
    "qty":   "რაოდენობა",
    "price": "ფასი (₾)",
    "pay":   "გადახდა",
    "cust":  "კლიენტი",
}


def _sale_edit_field_kb(sale_id: int, is_credit: bool) -> InlineKeyboardMarkup:
    rows = [
        [_btn("🔢 რაოდენობა",  f"sef:{sale_id}:qty"),
         _btn("💰 ფასი",       f"sef:{sale_id}:price")],
        [_btn("💳 გადახდა",    f"sef:{sale_id}:pay"),
         _btn("👤 კლიენტი",   f"sef:{sale_id}:cust")],
        _CANCEL_ROW,
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


@wizard_router.callback_query(F.data.startswith("edit:sale:"), IsAdmin())
async def sale_edit_start(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    try:
        sale_id = int(callback.data.split(":")[2])
    except (IndexError, ValueError):
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    sale = await db.get_sale(sale_id)
    if not sale:
        await callback.answer(f"⚠️ #{sale_id} ვერ მოიძებნა.", show_alert=True)
        return

    await state.set_state(SaleEditWizard.field)
    await state.set_data({"edit_sale_id": sale_id})

    qty   = sale["quantity"]
    price = float(sale["unit_price"])
    pay   = {"cash": "ხელზე 💵", "transfer": "დარიცხა 🏦", "credit": "ნისია 📋"}.get(
        sale["payment_method"], sale["payment_method"]
    )
    name  = sale.get("product_name") or sale.get("notes") or "—"
    cust  = sale.get("customer_name") or "—"

    await callback.message.answer(
        f"✏️ <b>გაყიდვა #{sale_id} — რედაქტირება</b>\n\n"
        f"📦 {_e(name)}\n"
        f"🔢 რაოდ: {qty}ც × {price:.2f}₾ = <b>{qty * price:.2f}₾</b>\n"
        f"💳 {pay}  |  👤 {_e(cust)}\n\n"
        "რომელი ველი შეიცვალოს?",
        parse_mode=_PARSE,
        reply_markup=_sale_edit_field_kb(sale_id, sale["payment_method"] == "credit"),
    )
    await callback.answer()


@wizard_router.callback_query(F.data.startswith("sef:"), IsAdmin(), StateFilter(SaleEditWizard.field))
async def sale_edit_field(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    parts = callback.data.split(":")  # sef:{sale_id}:{field}
    if len(parts) < 3:
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    sale_id = int(parts[1])
    field   = parts[2]
    await state.update_data(edit_field=field)
    await state.set_state(SaleEditWizard.value)

    if field == "pay":
        await callback.message.edit_text(
            "💳 <b>ახალი გადახდის მეთოდი:</b>",
            parse_mode=_PARSE,
            reply_markup=_kb(
                [_btn("💵 ხელზე",   "wiz:epay:cash")],
                [_btn("🏦 დარიცხა", "wiz:epay:transfer")],
                [_btn("📋 ნისია",   "wiz:epay:credit")],
                _CANCEL_ROW,
            ),
        )
    else:
        label = _SALE_FIELDS.get(field, field)
        sale  = await db.get_sale(sale_id)
        current = ""
        if sale:
            if field == "qty":
                current = f" (ახლა: {sale['quantity']}ც)"
            elif field == "price":
                current = f" (ახლა: {float(sale['unit_price']):.2f}₾)"
            elif field == "cust":
                current = f" (ახლა: {_e(sale.get('customer_name') or '—')})"

        await callback.message.edit_text(
            f"✏️ <b>{label}</b>{current}\n\nჩაწერე ახალი მნიშვნელობა:",
            parse_mode=_PARSE,
            reply_markup=_kb(_CANCEL_ROW),
        )
    await callback.answer()


@wizard_router.callback_query(F.data.startswith("wiz:epay:"), IsAdmin(), StateFilter(SaleEditWizard.value))
async def sale_edit_payment_pick(callback: CallbackQuery, state: FSMContext) -> None:
    method = callback.data.split(":")[2]
    await state.update_data(edit_value=method)
    await state.set_state(SaleEditWizard.confirm)
    label = {"cash": "ხელზე 💵", "transfer": "დარიცხა 🏦", "credit": "ნისია 📋"}.get(method, method)
    await callback.message.edit_text(
        f"💳 ახალი გადახდა: <b>{label}</b>\n\nდაადასტურე?",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn("✅ შენახვა", "wiz:econfirm:yes"), _btn("❌ გაუქმება", "wiz:econfirm:no")]),
    )
    await callback.answer()


@wizard_router.message(SaleEditWizard.value, IsAdmin(), _PRIVATE)
async def sale_edit_value_input(message: Message, state: FSMContext) -> None:
    d    = await state.get_data()
    field = d.get("edit_field", "")
    text  = (message.text or "").strip()

    if field == "qty":
        try:
            val = int(text)
            if val <= 0:
                raise ValueError
        except ValueError:
            await message.answer("⚠️ ჩაწერე დადებითი მთელი რიცხვი.", parse_mode=_PARSE)
            return
        await state.update_data(edit_value=val)

    elif field == "price":
        try:
            val = float(text.replace(",", ".").replace("₾", "").replace("ლ", ""))
            if val <= 0:
                raise ValueError
        except ValueError:
            await message.answer("⚠️ ჩაწერე სწორი ფასი, მაგ: <code>35</code>", parse_mode=_PARSE)
            return
        await state.update_data(edit_value=val)

    elif field == "cust":
        await state.update_data(edit_value=text or None)

    label = _SALE_FIELDS.get(field, field)
    await state.set_state(SaleEditWizard.confirm)
    await message.answer(
        f"✏️ <b>{label}</b> → <b>{_e(text)}</b>\n\nდაადასტურე?",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn("✅ შენახვა", "wiz:econfirm:yes"), _btn("❌ გაუქმება", "wiz:econfirm:no")]),
    )


@wizard_router.callback_query(F.data == "wiz:econfirm:yes", IsAdmin(), StateFilter(SaleEditWizard.confirm))
async def sale_edit_confirm(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    d        = await state.get_data()
    sale_id  = d["edit_sale_id"]
    field    = d["edit_field"]
    new_val  = d["edit_value"]
    await state.clear()

    kwargs = {}
    if field == "qty":
        kwargs["quantity"] = new_val
    elif field == "price":
        kwargs["unit_price"] = new_val
    elif field == "pay":
        kwargs["payment_method"] = new_val
    elif field == "cust":
        kwargs["customer_name"] = new_val

    updated = await db.edit_sale(sale_id, **kwargs)
    if not updated:
        await callback.message.edit_text(
            f"⚠️ გაყიდვა #{sale_id} ვერ მოიძებნა.", parse_mode=_PARSE
        )
        return

    qty   = updated["quantity"]
    price = float(updated["unit_price"])
    pay   = {"cash": "ხელზე 💵", "transfer": "დარიცხა 🏦", "credit": "ნისია 📋"}.get(
        updated["payment_method"], updated["payment_method"]
    )

    await callback.message.edit_text(
        f"✅ <b>გაყიდვა #{sale_id} განახლდა</b>\n"
        f"🔢 {qty}ც × {price:.2f}₾ = <b>{qty * price:.2f}₾</b>\n"
        f"💳 {pay}",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn(f"🗑 წაშლა #{sale_id}", f"ds:{sale_id}"),
                          _btn(f"✏️ რედ. #{sale_id}", f"edit:sale:{sale_id}")]),
    )

    # Refresh the topic message
    old_topic_id  = updated.get("topic_id")
    old_topic_msg = updated.get("topic_message_id")
    if old_topic_id and old_topic_msg:
        try:
            await callback.bot.delete_message(chat_id=config.GROUP_ID, message_id=old_topic_msg)
        except Exception:
            pass
    topic_id = config.NISIAS_TOPIC_ID if updated["payment_method"] == "credit" else config.SALES_TOPIC_ID
    try:
        product_name = updated.get("product_name") or updated.get("notes") or f"გაყიდვა #{sale_id}"
        new_topic = await callback.bot.send_message(
            chat_id=config.GROUP_ID,
            message_thread_id=topic_id,
            text=format_topic_sale(
                product_name=product_name,
                qty=qty,
                price=price,
                payment=updated["payment_method"],
                sale_id=sale_id,
                customer_name=updated.get("customer_name"),
            ),
            parse_mode=_PARSE,
        )
        await db.update_sale_topic_message(sale_id, topic_id, new_topic.message_id)
    except Exception as exc:
        logger.warning("Failed to refresh topic after sale edit #%d: %s", sale_id, exc)

    await callback.answer(f"✅ #{sale_id} განახლდა")


@wizard_router.callback_query(F.data == "wiz:econfirm:no", IsAdmin(), StateFilter(SaleEditWizard.confirm))
async def sale_edit_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.edit_text("❌ <b>რედაქტირება გაუქმდა.</b>", parse_mode=_PARSE)


# ═══════════════════════════════════════════════════════════════════════════════
# EXPENSE EDIT WIZARD
# ═══════════════════════════════════════════════════════════════════════════════

_EXPENSE_FIELDS = {
    "amt":  "თანხა (₾)",
    "desc": "აღწერა",
    "cat":  "კატეგორია",
}


@wizard_router.callback_query(F.data.startswith("edit:exp:"), IsAdmin())
async def expense_edit_start(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    try:
        expense_id = int(callback.data.split(":")[2])
    except (IndexError, ValueError):
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    exp = await db.get_expense(expense_id)
    if not exp:
        await callback.answer(f"⚠️ #{expense_id} ვერ მოიძებნა.", show_alert=True)
        return

    await state.set_state(ExpenseEditWizard.field)
    await state.set_data({"edit_expense_id": expense_id})

    amt  = float(exp["amount"])
    desc = exp.get("description") or "—"
    cat  = exp.get("category") or "სხვა"

    await callback.message.answer(
        f"✏️ <b>ხარჯი #{expense_id} — რედაქტირება</b>\n\n"
        f"💰 {amt:.2f}₾  |  🏷 {_e(cat)}  |  📝 {_e(desc)}\n\n"
        "რომელი ველი შეიცვალოს?",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [_btn("💰 თანხა",    f"eef:{expense_id}:amt"),
             _btn("📝 აღწერა",   f"eef:{expense_id}:desc")],
            [_btn("🏷 კატეგორია", f"eef:{expense_id}:cat")],
            _CANCEL_ROW,
        ),
    )
    await callback.answer()


@wizard_router.callback_query(F.data.startswith("eef:"), IsAdmin(), StateFilter(ExpenseEditWizard.field))
async def expense_edit_field(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    parts = callback.data.split(":")  # eef:{expense_id}:{field}
    if len(parts) < 3:
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    expense_id = int(parts[1])
    field      = parts[2]
    await state.update_data(edit_field=field)
    await state.set_state(ExpenseEditWizard.value)

    if field == "cat":
        await callback.message.edit_text(
            "🏷 <b>ახალი კატეგორია:</b>",
            parse_mode=_PARSE,
            reply_markup=_category_kb(),
        )
    else:
        exp = await db.get_expense(expense_id)
        current = ""
        if exp:
            if field == "amt":
                current = f" (ახლა: {float(exp['amount']):.2f}₾)"
            elif field == "desc":
                current = f" (ახლა: {_e(exp.get('description') or '—')})"
        label = _EXPENSE_FIELDS.get(field, field)
        await callback.message.edit_text(
            f"✏️ <b>{label}</b>{current}\n\nჩაწერე ახალი მნიშვნელობა:",
            parse_mode=_PARSE,
            reply_markup=_kb(_CANCEL_ROW),
        )
    await callback.answer()


@wizard_router.callback_query(F.data.startswith("wiz:cat:"), IsAdmin(), StateFilter(ExpenseEditWizard.value))
async def expense_edit_cat_pick(callback: CallbackQuery, state: FSMContext) -> None:
    key = callback.data.split(":", 2)[2]
    if key == "other":
        label = "სხვა"
    else:
        label = next((lbl for lbl, k in _EXPENSE_CATEGORIES if k == key), key)
    await state.update_data(edit_value=key, edit_value_label=label)
    await state.set_state(ExpenseEditWizard.confirm)
    await callback.message.edit_text(
        f"🏷 ახალი კატეგორია: <b>{_e(label)}</b>\n\nდაადასტურე?",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn("✅ შენახვა", "wiz:econfirm:exp:yes"), _btn("❌ გაუქმება", "wiz:econfirm:exp:no")]),
    )
    await callback.answer()


@wizard_router.message(ExpenseEditWizard.value, IsAdmin(), _PRIVATE)
async def expense_edit_value_input(message: Message, state: FSMContext) -> None:
    d     = await state.get_data()
    field = d.get("edit_field", "")
    text  = (message.text or "").strip()

    if field == "amt":
        try:
            val = float(text.replace(",", ".").replace("₾", "").replace("ლ", ""))
            if val <= 0:
                raise ValueError
        except ValueError:
            await message.answer("⚠️ ჩაწერე სწორი თანხა, მაგ: <code>50</code>", parse_mode=_PARSE)
            return
        await state.update_data(edit_value=val)
    else:
        await state.update_data(edit_value=text or None)

    label = _EXPENSE_FIELDS.get(field, field)
    await state.set_state(ExpenseEditWizard.confirm)
    await message.answer(
        f"✏️ <b>{label}</b> → <b>{_e(text)}</b>\n\nდაადასტურე?",
        parse_mode=_PARSE,
        reply_markup=_kb([_btn("✅ შენახვა", "wiz:econfirm:exp:yes"), _btn("❌ გაუქმება", "wiz:econfirm:exp:no")]),
    )


@wizard_router.callback_query(F.data == "wiz:econfirm:exp:yes", IsAdmin(), StateFilter(ExpenseEditWizard.confirm))
async def expense_edit_confirm(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    d          = await state.get_data()
    expense_id = d["edit_expense_id"]
    field      = d["edit_field"]
    new_val    = d["edit_value"]
    await state.clear()

    kwargs = {}
    if field == "amt":
        kwargs["amount"] = new_val
    elif field == "desc":
        kwargs["description"] = new_val
    elif field == "cat":
        kwargs["category"] = None if new_val == "other" else new_val

    updated = await db.edit_expense(expense_id, **kwargs)
    if not updated:
        await callback.message.edit_text(
            f"⚠️ ხარჯი #{expense_id} ვერ მოიძებნა.", parse_mode=_PARSE
        )
        return

    amt  = float(updated["amount"])
    cat  = updated.get("category")
    desc = updated.get("description") or ""

    await callback.message.edit_text(
        f"✅ <b>ხარჯი #{expense_id} განახლდა</b>\n"
        f"💰 <b>{amt:.2f}₾</b>"
        + (f"\n📝 {_e(desc)}" if desc else ""),
        parse_mode=_PARSE,
        reply_markup=_kb([_btn(f"✏️ რედ. #{expense_id}", f"edit:exp:{expense_id}")]),
    )

    # Refresh the topic message
    old_topic_id  = updated.get("topic_id")
    old_topic_msg = updated.get("topic_message_id")
    if old_topic_id and old_topic_msg:
        try:
            await callback.bot.delete_message(chat_id=config.GROUP_ID, message_id=old_topic_msg)
        except Exception:
            pass
    try:
        new_topic = await callback.bot.send_message(
            chat_id=config.GROUP_ID,
            message_thread_id=config.EXPENSES_TOPIC_ID,
            text=format_topic_expense(
                amount=amt,
                category=cat,
                description=desc or None,
                expense_id=expense_id,
            ),
            parse_mode=_PARSE,
        )
        await db.update_expense_topic_message(expense_id, config.EXPENSES_TOPIC_ID, new_topic.message_id)
    except Exception as exc:
        logger.warning("Failed to refresh topic after expense edit #%d: %s", expense_id, exc)

    await callback.answer(f"✅ #{expense_id} განახლდა")


@wizard_router.callback_query(F.data == "wiz:econfirm:exp:no", IsAdmin(), StateFilter(ExpenseEditWizard.confirm))
async def expense_edit_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.edit_text("❌ <b>რედაქტირება გაუქმდა.</b>", parse_mode=_PARSE)


# ═══════════════════════════════════════════════════════════════════════════════
# Shared sub-flows (product search, quantity, price)
# ═══════════════════════════════════════════════════════════════════════════════

async def _handle_product_search(
    message: Message, state: FSMContext, db: Database, wizard: str
) -> None:
    query = (message.text or "").strip()
    if not query:
        return

    products = await db.search_products(query, limit=6)

    if len(products) == 1:
        p = products[0]
        await state.update_data(
            product_id=p["id"],
            product_name=p["name"],
            is_freeform=False,
        )
        await _goto_quantity(message, state, wizard, p["name"], send=True)
        return

    if len(products) > 1:
        await state.update_data(
            _search_results=[(p["id"], p["name"], p.get("oem_code")) for p in products]
        )
        select_state = SaleWizard.select if wizard == "sale" else NisiaWizard.select
        await state.set_state(select_state)

        buttons = []
        for p in products:
            label = p["name"]
            if p.get("oem_code"):
                label += f" [{p['oem_code']}]"
            buttons.append([_btn(label, f"wiz:prod:{p['id']}")])
        buttons.append([_btn("❓ ბაზაში არ არის", "wiz:prod:free")])
        buttons.append(_CANCEL_ROW)

        await message.answer(
            f"🔍 <b>ვიპოვე {len(products)} პროდუქტი.</b> აირჩიე:",
            parse_mode=_PARSE,
            reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons),
        )
        return

    # No results — offer freeform
    freeform_name = query
    buttons = [
        [_btn(f"✅ ჩავიწეროთ: {freeform_name[:40]}", "wiz:prod:free")],
        _CANCEL_ROW,
    ]
    await state.update_data(product_name=freeform_name, is_freeform=True)

    select_state = SaleWizard.select if wizard == "sale" else NisiaWizard.select
    await state.set_state(select_state)

    await message.answer(
        f"⚠️ <b>'{_e(freeform_name)}'</b> ბაზაში ვერ ვიპოვე.\n"
        "გაყიდვა მაინც ჩაიწეროს? (ნაშთი მინუსში წავა)",
        parse_mode=_PARSE,
        reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons),
    )


async def _handle_product_selected(
    callback: CallbackQuery, state: FSMContext, db: Database, wizard: str
) -> None:
    choice = callback.data.split(":", 2)[2]  # product id or "free"

    if choice == "free":
        d = await state.get_data()
        name = d.get("product_name") or "უცნობი"
        await state.update_data(product_id=None, product_name=name, is_freeform=True)
        await _goto_quantity(callback.message, state, wizard, name, send=False)
        return

    product_id = int(choice)
    product = await db.get_product_by_id(product_id)
    if not product:
        await callback.answer("პროდუქტი ვერ მოიძებნა", show_alert=True)
        return

    await state.update_data(
        product_id=product_id,
        product_name=product["name"],
        is_freeform=False,
    )
    await _goto_quantity(callback.message, state, wizard, product["name"], send=False)


async def _goto_quantity(
    msg: Message, state: FSMContext, wizard: str, product_name: str, send: bool
) -> None:
    qty_state = SaleWizard.quantity if wizard == "sale" else NisiaWizard.quantity
    await state.set_state(qty_state)

    step = "3" if wizard == "nisia" else "2"
    text = (
        f"✅ <b>{_e(product_name)}</b>\n\n"
        f"📦 <b>ნაბიჯი {step}/5</b> — რამდენი ცალი?"
    )
    kb = _kb(_CANCEL_ROW)
    if send:
        await msg.answer(text, parse_mode=_PARSE, reply_markup=kb)
    else:
        await msg.edit_text(text, parse_mode=_PARSE, reply_markup=kb)


async def _handle_quantity(message: Message, state: FSMContext, wizard: str) -> None:
    try:
        qty = int((message.text or "").strip())
        if qty <= 0:
            raise ValueError
    except ValueError:
        await message.answer("⚠️ ჩაწერე დადებითი მთელი რიცხვი, მაგ: <code>2</code>", parse_mode=_PARSE)
        return

    await state.update_data(quantity=qty)
    price_state = SaleWizard.price_type if wizard == "sale" else NisiaWizard.price_type
    await state.set_state(price_state)

    step = "4" if wizard == "nisia" else "3"
    await message.answer(
        f"🔢 <b>{qty} ცალი</b>\n\n"
        f"💰 <b>ნაბიჯი {step}/5</b> — ფასი როგორ შეიყვანო?",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [_btn("1️⃣ ერთეულის ფასი", "wiz:price:unit")],
            [_btn("Σ ჯამური თანხა", "wiz:price:total")],
            _CANCEL_ROW,
        ),
    )


async def _handle_price_type(callback: CallbackQuery, state: FSMContext, wizard: str) -> None:
    price_kind = callback.data.split(":", 2)[2]  # unit or total
    await state.update_data(price_kind=price_kind)
    price_state = SaleWizard.price if wizard == "sale" else NisiaWizard.price
    await state.set_state(price_state)

    label = "ერთეულის ფასი" if price_kind == "unit" else "ჯამური თანხა"
    step = "4" if wizard == "nisia" else "3"
    await callback.message.edit_text(
        f"💰 <b>ნაბიჯი {step}/5</b> — შეიყვანე {label} (₾):",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )


async def _handle_price_input(message: Message, state: FSMContext, wizard: str) -> None:
    try:
        raw = (message.text or "").strip().replace(",", ".").replace("₾", "").replace("ლ", "")
        value = float(raw)
        if value <= 0:
            raise ValueError
    except ValueError:
        await message.answer("⚠️ ჩაწერე სწორი თანხა, მაგ: <code>35</code> ან <code>70.50</code>", parse_mode=_PARSE)
        return

    d = await state.get_data()
    qty: int = d["quantity"]
    price_kind: str = d.get("price_kind", "unit")

    unit_price = value if price_kind == "unit" else value / qty
    total = unit_price * qty

    await state.update_data(unit_price=unit_price)

    if wizard == "sale":
        await state.set_state(SaleWizard.payment)
        await message.answer(
            f"💰 {qty}ც × {unit_price:.2f}₾ = <b>{total:.2f}₾</b>\n\n"
            "💳 <b>ნაბიჯი 4/5</b> — გადახდის მეთოდი:",
            parse_mode=_PARSE,
            reply_markup=_kb(
                [_btn("💵 ხელზე",   "wiz:pay:cash")],
                [_btn("🏦 დარიცხა", "wiz:pay:transfer")],
                [_btn("📋 ნისია",   "wiz:pay:credit")],
                _CANCEL_ROW,
            ),
        )
    else:
        # Nisia — no payment step, go straight to confirm
        await state.update_data(payment="credit")
        await state.set_state(NisiaWizard.confirm)
        await _show_nisia_confirm(message, state, send=True)


async def _show_sale_confirm(msg: Message, state: FSMContext, edit: bool) -> None:
    d = await state.get_data()
    qty        = d["quantity"]
    unit_price = d["unit_price"]
    payment    = d["payment"]
    product    = d["product_name"]
    total      = qty * unit_price
    pay_label  = {"cash": "ხელზე 💵", "transfer": "დარიცხა 🏦", "credit": "ნისია 📋"}.get(payment, payment)

    text = (
        f"✅ <b>ნაბიჯი 5/5 — გადამოწმება</b>\n\n"
        f"📦 პროდუქტი: <b>{_e(product)}</b>\n"
        f"🔢 რაოდ: {qty}ც × {unit_price:.2f}₾ = <b>{total:.2f}₾</b>\n"
        f"💳 გადახდა: {pay_label}\n\n"
        "ყველაფერი სწორია?"
    )
    kb = _kb(
        [_btn("✅ შენახვა", "wiz:confirm:yes"), _btn("❌ გაუქმება", "wiz:confirm:no")],
    )
    if edit:
        await msg.edit_text(text, parse_mode=_PARSE, reply_markup=kb)
    else:
        await msg.answer(text, parse_mode=_PARSE, reply_markup=kb)


async def _show_nisia_confirm(msg: Message, state: FSMContext, send: bool) -> None:
    d = await state.get_data()
    qty        = d["quantity"]
    unit_price = d["unit_price"]
    product    = d["product_name"]
    customer   = d["customer_name"]
    total      = qty * unit_price

    text = (
        f"✅ <b>ნაბიჯი 5/5 — გადამოწმება</b>\n\n"
        f"👤 კლიენტი: <b>{_e(customer)}</b>\n"
        f"📦 პროდუქტი: <b>{_e(product)}</b>\n"
        f"🔢 რაოდ: {qty}ც × {unit_price:.2f}₾ = <b>{total:.2f}₾</b>\n"
        f"💳 ნისია 📋\n\n"
        "ყველაფერი სწორია?"
    )
    kb = _kb(
        [_btn("✅ შენახვა", "wiz:confirm:yes"), _btn("❌ გაუქმება", "wiz:confirm:no")],
    )
    if send:
        await msg.answer(text, parse_mode=_PARSE, reply_markup=kb)
    else:
        await msg.edit_text(text, parse_mode=_PARSE, reply_markup=kb)


async def _show_expense_confirm(msg: Message, state: FSMContext, edit: bool) -> None:
    d = await state.get_data()
    amount    = d["amount"]
    cat_label = d.get("category_label", "")
    desc      = d.get("description") or ""
    desc_line = f"\n📝 {_e(desc)}" if desc else ""

    text = (
        f"✅ <b>გადამოწმება</b>\n\n"
        f"🏷 კატეგორია: <b>{_e(cat_label)}</b>\n"
        f"💰 თანხა: <b>{amount:.2f}₾</b>"
        f"{desc_line}\n\n"
        "ყველაფერი სწორია?"
    )
    kb = _kb(
        [_btn("✅ შენახვა", "wiz:confirm:yes"), _btn("❌ გაუქმება", "wiz:confirm:no")],
    )
    if edit:
        await msg.edit_text(text, parse_mode=_PARSE, reply_markup=kb)
    else:
        await msg.answer(text, parse_mode=_PARSE, reply_markup=kb)
