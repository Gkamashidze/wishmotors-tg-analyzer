"""
Wizard-style DM entry for Sales, Nisias, and Expenses.
Each flow guides the admin through steps with inline buttons.
Only works in private (DM) chat; confirmed entries are saved to DB
and mirrored to the relevant group topic.
"""
import html
import logging
from typing import Optional

from aiogram import F, Router
from aiogram.enums import ParseMode
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
_PRIVATE = F.chat.type == "private"

# ─── Shared helpers ────────────────────────────────────────────────────────────

def _kb(*rows: list) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=list(rows))


def _btn(text: str, data: str) -> InlineKeyboardButton:
    return InlineKeyboardButton(text=text, callback_data=data)


_CANCEL = _btn("❌ გაუქმება", "wiz:cancel")
_CANCEL_ROW = [_CANCEL]


def _e(v: object) -> str:
    return html.escape(str(v))


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
    await state.clear()

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

    # Auto-order at zero
    if product_id is not None and new_stock <= 0:
        product = await db.get_product_by_id(product_id)
        if product:
            await db.create_order(
                product_id=product_id,
                quantity_needed=product["min_stock"] or 1,
                notes=f"ავტო: {product['name']} — {new_stock}ც",
            )

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
        reply_markup=_kb([_btn(f"🗑 წაშლა #{sale_id}", f"ds:{sale_id}")]),
    )

    # Mirror to topic
    topic_id = config.NISIAS_TOPIC_ID if payment == "credit" else config.SALES_TOPIC_ID
    try:
        await callback.bot.send_message(
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
    await state.clear()

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
        reply_markup=_kb([_btn(f"🗑 წაშლა #{sale_id}", f"ds:{sale_id}")]),
    )

    try:
        await callback.bot.send_message(
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

    label = next((l for l, k in _EXPENSE_CATEGORIES if k == key), key)
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
    await state.clear()

    amount: float            = d["amount"]
    category: str            = d.get("category") or "other"
    category_label: str      = d.get("category_label", "")
    description: Optional[str] = d.get("description")

    db_category = None if category == "other" else category
    expense_id = await db.create_expense(
        amount=amount,
        description=description or category_label,
        category=db_category,
    )

    desc_line = f"\n📝 {_e(description)}" if description else ""
    await callback.message.edit_text(
        f"✅ <b>ხარჯი #{expense_id} დაფიქსირდა</b>\n"
        f"🏷 {_e(category_label)}\n"
        f"💰 <b>{amount:.2f}₾</b>"
        f"{desc_line}",
        parse_mode=_PARSE,
    )

    try:
        await callback.bot.send_message(
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
    except Exception as exc:
        logger.warning("Failed to post expense to topic: %s", exc)


@wizard_router.callback_query(F.data == "wiz:confirm:no", IsAdmin(), StateFilter(ExpenseWizard.confirm))
async def expense_confirm_no(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.edit_text("❌ <b>ხარჯი გაუქმებულია.</b>", parse_mode=_PARSE)


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
        # Store search results in state as list of (id, name, oem)
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
    qty       = d["quantity"]
    unit_price = d["unit_price"]
    payment   = d["payment"]
    product   = d["product_name"]
    total     = qty * unit_price
    pay_label = {"cash": "ხელზე 💵", "transfer": "დარიცხა 🏦", "credit": "ნისია 📋"}.get(payment, payment)

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
    qty       = d["quantity"]
    unit_price = d["unit_price"]
    product   = d["product_name"]
    customer  = d["customer_name"]
    total     = qty * unit_price

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
    amount   = d["amount"]
    cat_label = d.get("category_label", "")
    desc     = d.get("description") or ""
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
