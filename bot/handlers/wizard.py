"""
Wizard-style DM entry for Sales, Nisias, and Expenses.
Each flow guides the admin through steps with inline buttons.
Only works in private (DM) chat; confirmed entries are saved to DB
and mirrored to the relevant group topic.

Multi-item sessions: after saving, the user can tap ➕ to add another
item of the same type without restarting from the /new menu.

Edit: tapping ✏️ on any confirmation opens a field-level edit wizard.
For nisias (credit sales), the edit wizard exposes Name / Phone /
Product / Quantity / Price as separate fields; Name and Phone are
stored together in sales.customer_name and are parsed/recombined
transparently.
"""

import asyncio
import html
import logging
import re
from io import BytesIO
from typing import Optional, Tuple

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
from bot.handlers.topic_messages import (
    mark_cancelled,
    mark_updated,
    topic_expense_kb,
    topic_nisia_kb,
    topic_sale_kb,
)
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

# Detects combined OEM+name input like "8390132500მარჭვენა სარკე" — digits/latin prefix
# immediately followed by (or space-separated from) a Georgian-script product name.
_OEM_SPLIT_RE = re.compile(
    r"^([\dA-Za-z][\dA-Za-z\-]*)\s+([\u10d0-\u10ff].+)$",
    re.UNICODE,
)

# ─── Shared helpers ────────────────────────────────────────────────────────────


def _kb(*rows: list) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=list(rows))


def _btn(text: str, data: str) -> InlineKeyboardButton:
    return InlineKeyboardButton(text=text, callback_data=data)


_CANCEL = _btn("❌ გაუქმება", "wiz:cancel")
_CANCEL_ROW = [_CANCEL]

_VAT_KB = _kb(
    [_btn("✅ კი", "wiz:vat:yes"), _btn("❌ არა", "wiz:vat:no")],
    _CANCEL_ROW,
)

VAT_RATE = 0.18


def _calc_vat(amount: float) -> float:
    """Extract VAT from a VAT-inclusive amount: vat = amount - amount/1.18."""
    return round(amount - amount / (1 + VAT_RATE), 2)


async def _ask_vat(message: Message, amount: float, edit: bool = True) -> None:
    text = (
        f"🧾 <b>შედის თუ არა ამ თანხაში დღგ?</b>\n"
        f"💰 თანხა: <b>{amount:.2f}₾</b>\n"
        f"<i>18%-იანი დღგ ჩართვის შემთხვევაში: {_calc_vat(amount):.2f}₾</i>"
    )
    if edit:
        await message.edit_text(text, parse_mode=_PARSE, reply_markup=_VAT_KB)
    else:
        await message.answer(text, parse_mode=_PARSE, reply_markup=_VAT_KB)


def _e(v: object) -> str:
    return html.escape(str(v))


def _sale_action_kb(sale_id: int) -> InlineKeyboardMarkup:
    """Buttons shown after saving a sale (delete + edit + more + done)."""
    return _kb(
        [
            _btn(f"🗑 წაშლა #{sale_id}", f"ds:{sale_id}"),
            _btn(f"✏️ რედ. #{sale_id}", f"edit:sale:{sale_id}"),
        ],
        [_btn("➕ კიდევ ერთი", "wiz:more:sale"), _btn("✅ დასრულება", "wiz:done:sale")],
    )


def _nisia_action_kb(sale_id: int) -> InlineKeyboardMarkup:
    """Buttons shown after saving a nisia (delete + edit + more same customer + done)."""
    return _kb(
        [
            _btn(f"🗑 წაშლა #{sale_id}", f"ds:{sale_id}"),
            _btn(f"✏️ რედ. #{sale_id}", f"edit:sale:{sale_id}"),
        ],
        [
            _btn("➕ კიდევ ერთი (იმავე კლ.)", "wiz:more:nisia"),
            _btn("✅ დასრულება", "wiz:done:nisia"),
        ],
    )


def _expense_action_kb(expense_id: int) -> InlineKeyboardMarkup:
    """Buttons shown after saving an expense (edit + more + done)."""
    return _kb(
        [_btn(f"✏️ რედ. #{expense_id}", f"edit:exp:{expense_id}")],
        [
            _btn("➕ კიდევ ერთი", "wiz:more:expense"),
            _btn("✅ დასრულება", "wiz:done:expense"),
        ],
    )


# ─── State groups ──────────────────────────────────────────────────────────────


class SaleWizard(StatesGroup):
    oem = State()  # OEM code (collected first, separate step)
    product = State()  # product name search
    select = State()  # choose from list (if multiple matches)
    new_product_name = State()  # new product name when not found in DB
    new_product_price = State()  # new product price when not found in DB
    quantity = State()  # how many units
    price_type = State()  # unit price or total amount
    price = State()  # numeric input
    payment = State()  # ხელზე / დარიცხა / ნისია
    seller_type = State()  # შპს / ფზ პირი
    buyer_type = State()  # საცალო / მეწარმე
    vat = State()  # is VAT (18%) included?
    confirm = State()  # final review


class NisiaWizard(StatesGroup):
    customer = State()  # name / phone / both
    oem = State()  # OEM code (collected before product name)
    product = State()
    select = State()
    new_product_name = State()  # new product name when not found in DB
    new_product_price = State()  # new product price when not found in DB
    quantity = State()
    price_type = State()
    price = State()
    seller_type = State()  # შპს / ფზ პირი
    buyer_type = State()  # საცალო / მეწარმე
    vat = State()  # is VAT (18%) included?
    confirm = State()


class ExpenseWizard(StatesGroup):
    category = State()  # inline buttons
    custom_cat = State()  # freeform when "სხვა" chosen
    amount = State()
    payment_method = State()  # ნაღდი / გადარიცხვა
    description = State()
    vat = State()  # is VAT (18%) included?
    confirm = State()


class SaleEditWizard(StatesGroup):
    field = State()  # user picks which field to change
    value = State()  # user types new value (or picks via buttons)
    product_oem = State()  # step 1: user types OEM code
    product_search = State()  # step 2: user types product name
    product_select = State()  # user picks from search results or freeform
    confirm = State()  # final confirmation


class NisiaEditWizard(StatesGroup):
    """Edit flow dedicated to ნისია (credit) sales.

    Exposes Name / Phone / Product / Quantity / Price as separate fields.
    The DB keeps name+phone together in sales.customer_name — this flow
    parses and recombines them transparently.
    """

    field = State()  # user picks which field to change
    value = State()  # text input for simple fields
    product_oem = State()  # step 1: user types new OEM code
    product_search = State()  # step 2: user types new product name
    product_select = State()  # user picks from matches or marks freeform
    confirm = State()  # final confirmation before saving


class ExpenseEditWizard(StatesGroup):
    field = State()
    value = State()
    confirm = State()


# ─── /new — main menu ─────────────────────────────────────────────────────────


@wizard_router.message(Command("new"), IsAdmin(), _PRIVATE)
async def cmd_new(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer(
        "🛠 <b>რა გსურს ჩაიწეროს?</b>",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [_btn("➕ გაყიდვა", "wiz:main:sale")],
            [_btn("💳 ნისია", "wiz:main:nisia")],
            [_btn("💸 ხარჯი", "wiz:main:expense")],
        ),
    )


# ─── Cancel (works from any wizard state) ─────────────────────────────────────


@wizard_router.callback_query(F.data == "wiz:cancel", IsAdmin())
async def cb_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    await state.clear()
    await callback.message.edit_text("❌ <b>გაუქმებულია.</b>", parse_mode=_PARSE)


# ─── Session "done" handlers ─────────────────────────────────────────────────


@wizard_router.callback_query(
    F.data.in_({"wiz:done:sale", "wiz:done:nisia", "wiz:done:expense"}), IsAdmin()
)
async def cb_done(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    await state.clear()
    await callback.message.edit_reply_markup(reply_markup=None)
    await callback.answer("✅ სესია დასრულდა", show_alert=False)


# ─── "Add more" handlers ──────────────────────────────────────────────────────


@wizard_router.callback_query(F.data == "wiz:more:sale", IsAdmin())
async def cb_more_sale(callback: CallbackQuery, state: FSMContext) -> None:
    """User wants to add another sale item in the same session."""
    if not isinstance(callback.message, Message):
        return
    await callback.message.edit_reply_markup(reply_markup=None)
    await state.set_state(SaleWizard.oem)
    await state.set_data({})
    await callback.message.answer(
        "➕ <b>მომდევნო გაყიდვა — ნაბიჯი 1/6</b>\n\n"
        "1️⃣ ჩაწერე პროდუქტის <b>OEM კოდი</b>:\n"
        "<i>გამოტოვებისთვის გამოგზავნე <code>-</code></i>",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )
    await callback.answer()


@wizard_router.callback_query(F.data == "wiz:more:nisia", IsAdmin())
async def cb_more_nisia(callback: CallbackQuery, state: FSMContext) -> None:
    """User wants to add another nisia for the same customer."""
    if not isinstance(callback.message, Message):
        return
    d = await state.get_data()
    customer = d.get("customer_name", "")
    await callback.message.edit_reply_markup(reply_markup=None)
    await state.set_state(NisiaWizard.oem)
    await state.set_data({"customer_name": customer})
    await callback.message.answer(
        f"💳 <b>კიდევ ერთი ნისია</b>\n"
        f"👤 კლიენტი: <b>{_e(customer)}</b>\n\n"
        "2️⃣ ჩაწერე პროდუქტის <b>OEM კოდი</b>:\n"
        "<i>გამოტოვებისთვის გამოგზავნე <code>-</code></i>",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )
    await callback.answer()


@wizard_router.callback_query(F.data == "wiz:more:expense", IsAdmin())
async def cb_more_expense(callback: CallbackQuery, state: FSMContext) -> None:
    """User wants to add another expense."""
    if not isinstance(callback.message, Message):
        return
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
    if not isinstance(callback.message, Message):
        return
    await state.set_state(SaleWizard.oem)
    await callback.message.edit_text(
        "➕ <b>გაყიდვა — ნაბიჯი 1/6</b>\n\n"
        "1️⃣ ჩაწერე პროდუქტის <b>OEM კოდი</b>:\n"
        "<i>გამოტოვებისთვის გამოგზავნე <code>-</code></i>",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )


@wizard_router.message(SaleWizard.oem, IsAdmin(), _PRIVATE, F.text)
async def sale_oem_input(message: Message, state: FSMContext, db: Database) -> None:
    await _handle_wizard_oem_input(message, state, db, wizard="sale")


@wizard_router.message(SaleWizard.product, IsAdmin(), _PRIVATE)
async def sale_product_input(message: Message, state: FSMContext, db: Database) -> None:
    await _handle_product_search(message, state, db, wizard="sale")


@wizard_router.callback_query(
    F.data.startswith("wiz:prod:"), IsAdmin(), StateFilter(SaleWizard.select)
)
async def sale_product_selected(
    callback: CallbackQuery, state: FSMContext, db: Database
) -> None:
    if not isinstance(callback.message, Message):
        return
    await _handle_product_selected(callback, state, db, wizard="sale")


@wizard_router.message(SaleWizard.new_product_name, IsAdmin(), _PRIVATE)
async def sale_new_product_name(
    message: Message, state: FSMContext, db: Database
) -> None:
    await _handle_new_product_name(message, state, db, wizard="sale")


@wizard_router.message(SaleWizard.new_product_price, IsAdmin(), _PRIVATE)
async def sale_new_product_price(
    message: Message, state: FSMContext, db: Database
) -> None:
    await _handle_new_product_price(message, state, db, wizard="sale")


@wizard_router.message(SaleWizard.quantity, IsAdmin(), _PRIVATE)
async def sale_quantity(message: Message, state: FSMContext) -> None:
    await _handle_quantity(message, state, wizard="sale")


@wizard_router.callback_query(
    F.data.startswith("wiz:price:"), IsAdmin(), StateFilter(SaleWizard.price_type)
)
async def sale_price_type(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    await _handle_price_type(callback, state, wizard="sale")


@wizard_router.message(SaleWizard.price, IsAdmin(), _PRIVATE)
async def sale_price_input(message: Message, state: FSMContext) -> None:
    await _handle_price_input(message, state, wizard="sale")


@wizard_router.callback_query(
    F.data.startswith("wiz:pay:"), IsAdmin(), StateFilter(SaleWizard.payment)
)
async def sale_payment(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    data_key = callback.data.split(":", 2)[2]  # cash / transfer / credit
    await state.update_data(payment=data_key)
    await state.set_state(SaleWizard.seller_type)
    await callback.message.edit_text(
        "🏢 <b>ნაბიჯი 5/7</b> — ვისგან გაიყიდა?",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [
                _btn("🏢 შპს", "wiz:seller:company"),
                _btn("👤 ფზ პირი", "wiz:seller:individual"),
            ],
            _CANCEL_ROW,
        ),
    )


@wizard_router.callback_query(
    F.data.startswith("wiz:seller:"), IsAdmin(), StateFilter(SaleWizard.seller_type)
)
async def sale_seller_type(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    raw = callback.data.split(":", 2)[2]  # company / individual
    seller = "llc" if raw == "company" else "individual"
    d = await state.get_data()
    total = float(d["unit_price"]) * int(d["quantity"])
    is_vat_included = seller == "llc"
    vat_amount = _calc_vat(total) if is_vat_included else 0.0
    await state.update_data(
        seller_type=seller,
        is_vat_included=is_vat_included,
        vat_amount=vat_amount,
    )
    await state.set_state(SaleWizard.buyer_type)
    await callback.message.edit_text(
        "🛒 <b>ნაბიჯი 6/7</b> — ვის ყიდი?",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [
                _btn("🛍 საცალო (ფიზ. პირი)", "wiz:buyer:retail"),
                _btn("🏭 მეწარმე", "wiz:buyer:business"),
            ],
            _CANCEL_ROW,
        ),
    )


@wizard_router.callback_query(
    F.data.startswith("wiz:buyer:"), IsAdmin(), StateFilter(SaleWizard.buyer_type)
)
async def sale_buyer_type(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    buyer = callback.data.split(":", 2)[2]  # retail / business
    await state.update_data(buyer_type=buyer)
    await state.set_state(SaleWizard.confirm)
    await _show_sale_confirm(callback.message, state, edit=True)


@wizard_router.callback_query(
    F.data.in_({"wiz:vat:yes", "wiz:vat:no"}), IsAdmin(), StateFilter(SaleWizard.vat)
)
async def sale_vat(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    d = await state.get_data()
    total = float(d["unit_price"]) * int(d["quantity"])
    is_included = callback.data == "wiz:vat:yes"
    vat_amt = _calc_vat(total) if is_included else 0.0
    await state.update_data(is_vat_included=is_included, vat_amount=vat_amt)
    await state.set_state(SaleWizard.confirm)
    await _show_sale_confirm(callback.message, state, edit=True)


@wizard_router.callback_query(
    F.data == "wiz:confirm:yes", IsAdmin(), StateFilter(SaleWizard.confirm)
)
async def sale_confirm(
    callback: CallbackQuery, state: FSMContext, db: Database
) -> None:
    if not isinstance(callback.message, Message):
        return
    d = await state.get_data()

    product_id: Optional[int] = d.get("product_id")
    product_name: str = d["product_name"]
    oem_code: Optional[str] = d.get("oem_code")
    qty: int = d["quantity"]
    price: float = d["unit_price"]
    payment: str = d["payment"]
    seller: str = d.get("seller_type", "individual")
    buyer: str = d.get("buyer_type", "retail")
    is_freeform: bool = d.get("is_freeform", False)

    vat_amount: float = d.get("vat_amount", 0.0)
    is_vat_included: bool = d.get("is_vat_included", False)

    sale_id, new_stock = await db.create_sale(
        product_id=product_id,
        quantity=qty,
        unit_price=price,
        payment_method=payment,
        seller_type=seller,
        buyer_type=buyer,
        vat_amount=vat_amount,
        is_vat_included=is_vat_included,
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

    pay_label = {
        "cash": "ხელზე 💵",
        "transfer": "დარიცხა 🏦",
        "credit": "ნისია 📋",
    }.get(payment, payment)
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
    topic_kb = (
        topic_nisia_kb(sale_id) if payment == "credit" else topic_sale_kb(sale_id)
    )
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
                oem_code=oem_code if not is_freeform else None,
            ),
            parse_mode=_PARSE,
            reply_markup=topic_kb,
        )
        await db.update_sale_topic_message(sale_id, topic_id, topic_msg.message_id)
    except Exception as exc:
        logger.warning("Failed to post sale to topic: %s", exc)


@wizard_router.callback_query(
    F.data == "wiz:confirm:no", IsAdmin(), StateFilter(SaleWizard.confirm)
)
async def sale_confirm_no(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    await state.clear()
    await callback.message.edit_text(
        "❌ <b>გაყიდვა გაუქმებულია.</b>", parse_mode=_PARSE
    )


# ═══════════════════════════════════════════════════════════════════════════════
# NISIA WIZARD
# ═══════════════════════════════════════════════════════════════════════════════


@wizard_router.callback_query(F.data == "wiz:main:nisia", IsAdmin())
async def nisia_start(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    await state.set_state(NisiaWizard.customer)
    await callback.message.edit_text(
        "💳 <b>ნისია — ნაბიჯი 1/5</b>\n\n"
        "ჩაწერე კლიენტის <b>სახელი</b>, <b>ტელეფონი</b> ან <b>ორივე</b>:\n"
        "<i>მაგ: გიო | 599123456 | გიო 599123456</i>",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )


@wizard_router.message(NisiaWizard.customer, IsAdmin(), _PRIVATE)
async def nisia_customer_input(
    message: Message, state: FSMContext, db: Database
) -> None:
    customer = (message.text or "").strip()
    if not customer:
        await message.answer("⚠️ ჩაწერე სახელი ან ტელეფონი.", parse_mode=_PARSE)
        return

    await state.update_data(customer_name=customer)

    # Show existing debt if any
    credit_sales = await db.get_credit_sales()
    existing = [
        s
        for s in credit_sales
        if (s.get("customer_name") or "").lower() == customer.lower()
    ]
    debt_note = ""
    if existing:
        debt = sum(float(s["unit_price"]) * s["quantity"] for s in existing)
        debt_note = f"\n<i>📋 ამ კლიენტს უკვე აქვს <b>{debt:.2f}₾</b> ნისია</i>"

    await state.set_state(NisiaWizard.oem)
    await message.answer(
        f"💳 <b>ნისია — ნაბიჯი 2/6</b>\n"
        f"👤 კლიენტი: <b>{_e(customer)}</b>{debt_note}\n\n"
        "2️⃣ ჩაწერე პროდუქტის <b>OEM კოდი</b>:\n"
        "<i>გამოტოვებისთვის გამოგზავნე <code>-</code></i>",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )


@wizard_router.message(NisiaWizard.oem, IsAdmin(), _PRIVATE, F.text)
async def nisia_oem_input(message: Message, state: FSMContext, db: Database) -> None:
    await _handle_wizard_oem_input(message, state, db, wizard="nisia")


@wizard_router.message(
    StateFilter(SaleWizard.oem, NisiaWizard.oem),
    IsAdmin(),
    _PRIVATE,
    F.photo,
)
async def wizard_oem_photo(message: Message, state: FSMContext, db: Database) -> None:
    """Barcode photo sent at the OEM step — decode + Vision name extraction."""
    from bot.barcode.decoder import decode_barcode, extract_from_label, extract_part_info

    assert message.bot is not None
    photo = message.photo[-1]
    file_info = await message.bot.get_file(photo.file_id)
    buf = BytesIO()
    await message.bot.download_file(file_info.file_path, destination=buf)
    image_bytes = buf.getvalue()

    oem = await asyncio.get_running_loop().run_in_executor(
        None, decode_barcode, image_bytes
    )

    current_state = await state.get_state()
    wizard = "sale" if "SaleWizard" in (current_state or "") else "nisia"
    new_name_state = (
        SaleWizard.new_product_name if wizard == "sale" else NisiaWizard.new_product_name
    )
    step = "2" if wizard == "sale" else "3"

    if not oem:
        # Barcode not readable — try Claude Vision to extract OEM + name from label
        await message.answer(
            "📷 შტრიხკოდი ვერ წაიკითხა. ეტიკეტი AI-ით მუშავდება...",
            parse_mode=_PARSE,
        )
        oem_vision, name_ka_vision, name_en_vision = await extract_from_label(image_bytes)

        if not oem_vision and not name_ka_vision and not name_en_vision:
            await message.answer(
                "❌ ეტიკეტზე OEM კოდი ვერ მოიძებნა.\nჩაწერე OEM კოდი ხელით:",
                parse_mode=_PARSE,
                reply_markup=_kb(_CANCEL_ROW),
            )
            return

        if oem_vision:
            await state.update_data(entered_oem=oem_vision)
            product = await db.get_product_by_oem(oem_vision)
            if product:
                await state.update_data(
                    product_id=product["id"],
                    product_name=product["name"],
                    oem_code=product.get("oem_code"),
                    is_freeform=False,
                )
                wac = await db.get_product_wac(product["id"])
                cost_line = (
                    f"\n💰 თვითღირებულება: <b>{wac:.2f} ₾</b>"
                    if wac > 0
                    else "\n💰 თვითღირებულება: -"
                )
                await message.answer(
                    f"✅ OEM <code>{_e(oem_vision)}</code> — ბაზაში ნაპოვნია:\n"
                    f"📦 <b>{_e(product['name'])}</b>{cost_line}",
                    parse_mode=_PARSE,
                )
                await _goto_quantity(message, state, wizard, product["name"], send=True)
                return

        await state.update_data(bc_name_ka=name_ka_vision, bc_name_en=name_en_vision)
        await state.set_state(new_name_state)

        if name_ka_vision or name_en_vision:
            disp_ka = name_ka_vision or name_en_vision
            disp_en = f" ({name_en_vision})" if name_en_vision and name_ka_vision else ""
            oem_line = f"OEM: <code>{_e(oem_vision)}</code>\n" if oem_vision else ""
            await message.answer(
                f"{oem_line}🔤 ეტიკეტიდან: <b>{_e(disp_ka)}{_e(disp_en)}</b>\n\n"
                f"➕ <b>ნაბიჯი {step}/6</b> — ასე ჩავწეროთ?",
                parse_mode=_PARSE,
                reply_markup=_kb(
                    [_btn(f"✅ კი: {disp_ka[:35]}", "wiz:bc_name:yes")],
                    [_btn("✎ სხვა სახელი", "wiz:bc_name:manual")],
                    _CANCEL_ROW,
                ),
            )
        else:
            oem_line = f"OEM: <code>{_e(oem_vision)}</code>\n" if oem_vision else ""
            await message.answer(
                f"{oem_line}➕ <b>ნაბიჯი {step}/6</b> — შეიყვანე ნაწილის <b>დასახელება</b>:",
                parse_mode=_PARSE,
                reply_markup=_kb(_CANCEL_ROW),
            )
        return

    await state.update_data(entered_oem=oem)

    product = await db.get_product_by_oem(oem)
    if product:
        await state.update_data(
            product_id=product["id"],
            product_name=product["name"],
            oem_code=product.get("oem_code"),
            is_freeform=False,
        )
        wac = await db.get_product_wac(product["id"])
        cost_line = (
            f"\n💰 თვითღირებულება: <b>{wac:.2f} ₾</b>"
            if wac > 0
            else "\n💰 თვითღირებულება: -"
        )
        await message.answer(
            f"✅ OEM <code>{_e(oem)}</code> — ბაზაში ნაპოვნია:\n📦 <b>{_e(product['name'])}</b>{cost_line}",
            parse_mode=_PARSE,
        )
        await _goto_quantity(message, state, wizard, product["name"], send=True)
        return

    await message.answer(
        f"📷 OEM <code>{_e(oem)}</code> — ბაზაში არ არის. ეტიკეტი მუშავდება...",
        parse_mode=_PARSE,
    )
    name_ka, name_en = await extract_part_info(image_bytes)
    await state.update_data(bc_name_ka=name_ka, bc_name_en=name_en)

    await state.set_state(new_name_state)

    if name_ka or name_en:
        disp_ka = name_ka or name_en
        disp_en = f" ({name_en})" if name_en and name_ka else ""
        await message.answer(
            f"🔤 ეტიკეტიდან: <b>{_e(disp_ka)}{_e(disp_en)}</b>\n\n"
            f"➕ <b>ნაბიჯი {step}/6</b> — ასე ჩავწეროთ?",
            parse_mode=_PARSE,
            reply_markup=_kb(
                [_btn(f"✅ კი: {disp_ka[:35]}", "wiz:bc_name:yes")],
                [_btn("✎ სხვა სახელი", "wiz:bc_name:manual")],
                _CANCEL_ROW,
            ),
        )
    else:
        await message.answer(
            f"📷 OEM: <code>{_e(oem)}</code>\n\n"
            f"➕ <b>ნაბიჯი {step}/6</b> — შეიყვანე ნაწილის <b>დასახელება</b>:",
            parse_mode=_PARSE,
            reply_markup=_kb(_CANCEL_ROW),
        )


@wizard_router.callback_query(
    F.data == "wiz:bc_name:yes",
    IsAdmin(),
    StateFilter(SaleWizard.new_product_name, NisiaWizard.new_product_name),
)
async def wizard_bc_name_confirm(
    callback: CallbackQuery, state: FSMContext, db: Database
) -> None:
    if not isinstance(callback.message, Message):
        return
    d = await state.get_data()
    name_ka: str = d.get("bc_name_ka") or ""
    name_en: str = d.get("bc_name_en") or ""
    name = name_ka or name_en
    if not name:
        await callback.answer("სახელი ვერ მოიძებნა", show_alert=True)
        return

    current_state = await state.get_state()
    wizard = "sale" if "SaleWizard" in (current_state or "") else "nisia"
    entered_oem: Optional[str] = d.get("entered_oem")

    await state.update_data(product_name=name)

    if entered_oem:
        new_id = await db.create_product(
            name=name,
            oem_code=entered_oem,
            stock=0,
            min_stock=0,
            price=0.0,
        )
        await state.update_data(product_id=new_id, is_freeform=False)
        await callback.message.edit_text(
            f"✅ <b>{_e(name)}</b> ბაზაში დაემატა!\nOEM: <code>{_e(entered_oem)}</code>",
            parse_mode=_PARSE,
        )
        await _goto_quantity(callback.message, state, wizard, name, send=True)
    else:
        price_state = (
            SaleWizard.new_product_price
            if wizard == "sale"
            else NisiaWizard.new_product_price
        )
        await state.set_state(price_state)
        await callback.message.edit_text(
            f"✅ <b>{_e(name)}</b>\n\n💰 შეიყვანეთ ნაწილის <b>ერთეულის ფასი</b> (₾):",
            parse_mode=_PARSE,
            reply_markup=_kb(_CANCEL_ROW),
        )
    await callback.answer()


@wizard_router.callback_query(
    F.data == "wiz:bc_name:manual",
    IsAdmin(),
    StateFilter(SaleWizard.new_product_name, NisiaWizard.new_product_name),
)
async def wizard_bc_name_manual(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    current_state = await state.get_state()
    step = "2" if "SaleWizard" in (current_state or "") else "3"
    await callback.message.edit_text(
        f"✏️ <b>ნაბიჯი {step}/6</b> — შეიყვანე ნაწილის <b>დასახელება</b>:",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )
    await callback.answer()


@wizard_router.message(NisiaWizard.product, IsAdmin(), _PRIVATE)
async def nisia_product_input(
    message: Message, state: FSMContext, db: Database
) -> None:
    await _handle_product_search(message, state, db, wizard="nisia")


@wizard_router.callback_query(
    F.data.startswith("wiz:prod:"), IsAdmin(), StateFilter(NisiaWizard.select)
)
async def nisia_product_selected(
    callback: CallbackQuery, state: FSMContext, db: Database
) -> None:
    if not isinstance(callback.message, Message):
        return
    await _handle_product_selected(callback, state, db, wizard="nisia")


@wizard_router.message(NisiaWizard.new_product_name, IsAdmin(), _PRIVATE)
async def nisia_new_product_name(
    message: Message, state: FSMContext, db: Database
) -> None:
    await _handle_new_product_name(message, state, db, wizard="nisia")


@wizard_router.message(NisiaWizard.new_product_price, IsAdmin(), _PRIVATE)
async def nisia_new_product_price(
    message: Message, state: FSMContext, db: Database
) -> None:
    await _handle_new_product_price(message, state, db, wizard="nisia")


@wizard_router.message(NisiaWizard.quantity, IsAdmin(), _PRIVATE)
async def nisia_quantity(message: Message, state: FSMContext) -> None:
    await _handle_quantity(message, state, wizard="nisia")


@wizard_router.callback_query(
    F.data.startswith("wiz:price:"), IsAdmin(), StateFilter(NisiaWizard.price_type)
)
async def nisia_price_type(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    await _handle_price_type(callback, state, wizard="nisia")


@wizard_router.message(NisiaWizard.price, IsAdmin(), _PRIVATE)
async def nisia_price_input(message: Message, state: FSMContext) -> None:
    await _handle_price_input(message, state, wizard="nisia")


@wizard_router.callback_query(
    F.data.startswith("wiz:seller:"), IsAdmin(), StateFilter(NisiaWizard.seller_type)
)
async def nisia_seller_type(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    raw = callback.data.split(":", 2)[2]  # company / individual
    seller = "llc" if raw == "company" else "individual"
    d = await state.get_data()
    total = float(d["unit_price"]) * int(d["quantity"])
    is_vat_included = seller == "llc"
    vat_amount = _calc_vat(total) if is_vat_included else 0.0
    await state.update_data(
        seller_type=seller,
        is_vat_included=is_vat_included,
        vat_amount=vat_amount,
    )
    await state.set_state(NisiaWizard.buyer_type)
    await callback.message.edit_text(
        "🛒 <b>ვის ყიდი?</b>",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [
                _btn("🛍 საცალო (ფიზ. პირი)", "wiz:buyer:retail"),
                _btn("🏭 მეწარმე", "wiz:buyer:business"),
            ],
            _CANCEL_ROW,
        ),
    )


@wizard_router.callback_query(
    F.data.startswith("wiz:buyer:"), IsAdmin(), StateFilter(NisiaWizard.buyer_type)
)
async def nisia_buyer_type(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    buyer = callback.data.split(":", 2)[2]  # retail / business
    await state.update_data(buyer_type=buyer)
    await state.set_state(NisiaWizard.confirm)
    await _show_nisia_confirm(callback.message, state, send=False)


@wizard_router.callback_query(
    F.data.in_({"wiz:vat:yes", "wiz:vat:no"}), IsAdmin(), StateFilter(NisiaWizard.vat)
)
async def nisia_vat(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    d = await state.get_data()
    total = float(d["unit_price"]) * int(d["quantity"])
    is_included = callback.data == "wiz:vat:yes"
    vat_amt = _calc_vat(total) if is_included else 0.0
    await state.update_data(is_vat_included=is_included, vat_amount=vat_amt)
    await state.set_state(NisiaWizard.confirm)
    await _show_nisia_confirm(callback.message, state, send=False)


@wizard_router.callback_query(
    F.data == "wiz:confirm:yes", IsAdmin(), StateFilter(NisiaWizard.confirm)
)
async def nisia_confirm(
    callback: CallbackQuery, state: FSMContext, db: Database
) -> None:
    if not isinstance(callback.message, Message):
        return
    d = await state.get_data()

    product_id: Optional[int] = d.get("product_id")
    product_name: str = d["product_name"]
    oem_code: Optional[str] = d.get("oem_code")
    qty: int = d["quantity"]
    price: float = d["unit_price"]
    customer: str = d["customer_name"]
    seller: str = d.get("seller_type", "individual")
    buyer: str = d.get("buyer_type", "retail")
    is_freeform: bool = d.get("is_freeform", False)

    vat_amount_n: float = d.get("vat_amount", 0.0)
    is_vat_included_n: bool = d.get("is_vat_included", False)

    sale_id, new_stock = await db.create_sale(
        product_id=product_id,
        quantity=qty,
        unit_price=price,
        payment_method="credit",
        seller_type=seller,
        buyer_type=buyer,
        customer_name=customer,
        notes=product_name if is_freeform else None,
        vat_amount=vat_amount_n,
        is_vat_included=is_vat_included_n,
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
                oem_code=oem_code if not is_freeform else None,
            ),
            parse_mode=_PARSE,
            reply_markup=topic_nisia_kb(sale_id),
        )
        await db.update_sale_topic_message(
            sale_id, config.NISIAS_TOPIC_ID, topic_msg.message_id
        )
    except Exception as exc:
        logger.warning("Failed to post nisia to topic: %s", exc)


@wizard_router.callback_query(
    F.data == "wiz:confirm:no", IsAdmin(), StateFilter(NisiaWizard.confirm)
)
async def nisia_confirm_no(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    await state.clear()
    await callback.message.edit_text("❌ <b>ნისია გაუქმებულია.</b>", parse_mode=_PARSE)


# ═══════════════════════════════════════════════════════════════════════════════
# EXPENSE WIZARD
# ═══════════════════════════════════════════════════════════════════════════════

_EXPENSE_CATEGORIES = [
    ("⛽ საწვავი", "fuel"),
    ("🚚 მიტანა", "delivery"),
    ("🛃 საბაჟო", "customs"),
    ("🔧 სერვისი", "maintenance"),
    ("📣 რეკლამა", "marketing"),
    ("🖊 ოფისი", "office"),
    ("💡 კომუნალი", "utilities"),
    ("👷 ხელფასი", "salary"),
    ("🚗 ტრანსპ.", "transport"),
    ("➕ სხვა", "other"),
]


def _category_kb() -> InlineKeyboardMarkup:
    rows = []
    for i in range(0, len(_EXPENSE_CATEGORIES), 2):
        pair = _EXPENSE_CATEGORIES[i : i + 2]
        rows.append([_btn(label, f"wiz:cat:{key}") for label, key in pair])
    rows.append(_CANCEL_ROW)
    return InlineKeyboardMarkup(inline_keyboard=rows)


@wizard_router.callback_query(F.data == "wiz:main:expense", IsAdmin())
async def expense_start(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    await state.set_state(ExpenseWizard.category)
    await callback.message.edit_text(
        "💸 <b>ხარჯი — ნაბიჯი 1/4</b>\n\nაირჩიე კატეგორია:",
        parse_mode=_PARSE,
        reply_markup=_category_kb(),
    )


@wizard_router.callback_query(
    F.data.startswith("wiz:cat:"), IsAdmin(), StateFilter(ExpenseWizard.category)
)
async def expense_category(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
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
        f"💸 <b>ხარჯი — ნაბიჯი 2/4</b>\n🏷 კატეგორია: {label}\n\nჩაწერე თანხა (₾):",
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
        f"💸 <b>ხარჯი — ნაბიჯი 2/4</b>\n"
        f"🏷 კატეგორია: {_e(cat_text)}\n\n"
        "ჩაწერე თანხა (₾):",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )


@wizard_router.message(ExpenseWizard.amount, IsAdmin(), _PRIVATE)
async def expense_amount(message: Message, state: FSMContext) -> None:
    try:
        amount = float(
            (message.text or "")
            .strip()
            .replace(",", ".")
            .replace("₾", "")
            .replace("ლ", "")
        )
        if amount <= 0:
            raise ValueError
    except ValueError:
        await message.answer(
            "⚠️ ჩაწერე სწორი თანხა, მაგ: <code>50</code> ან <code>12.50</code>",
            parse_mode=_PARSE,
        )
        return

    await state.update_data(amount=amount)
    await state.set_state(ExpenseWizard.payment_method)
    await message.answer(
        "💸 <b>ხარჯი — ნაბიჯი 3/4</b>\n\nროგორ გადაიხადე?",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [
                _btn("💵 ნაღდი", "wiz:exp:pay:cash"),
                _btn("🏦 გადარიცხვა", "wiz:exp:pay:transfer"),
            ],
            _CANCEL_ROW,
        ),
    )


@wizard_router.callback_query(
    F.data.in_({"wiz:exp:pay:cash", "wiz:exp:pay:transfer"}),
    IsAdmin(),
    StateFilter(ExpenseWizard.payment_method),
)
async def expense_payment_method(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    pm = "cash" if callback.data == "wiz:exp:pay:cash" else "transfer"
    await state.update_data(payment_method=pm)
    await state.set_state(ExpenseWizard.description)
    await callback.message.edit_text(
        "💸 <b>ხარჯი — ნაბიჯი 4/4</b>\n\nდაამატე მოკლე <b>აღწერა</b> (სურვილისამებრ):",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [_btn("⏭ გამოტოვება", "wiz:desc:skip")],
            _CANCEL_ROW,
        ),
    )


@wizard_router.callback_query(
    F.data == "wiz:desc:skip", IsAdmin(), StateFilter(ExpenseWizard.description)
)
async def expense_desc_skip(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    await state.update_data(description=None)
    await state.set_state(ExpenseWizard.vat)
    d = await state.get_data()
    await _ask_vat(callback.message, float(d["amount"]), edit=True)


@wizard_router.message(ExpenseWizard.description, IsAdmin(), _PRIVATE)
async def expense_description(message: Message, state: FSMContext) -> None:
    desc = (message.text or "").strip() or None
    await state.update_data(description=desc)
    await state.set_state(ExpenseWizard.vat)
    d = await state.get_data()
    await _ask_vat(message, float(d["amount"]), edit=False)


@wizard_router.callback_query(
    F.data.in_({"wiz:vat:yes", "wiz:vat:no"}), IsAdmin(), StateFilter(ExpenseWizard.vat)
)
async def expense_vat(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    d = await state.get_data()
    amount = float(d["amount"])
    is_included = callback.data == "wiz:vat:yes"
    vat_amt = _calc_vat(amount) if is_included else 0.0
    await state.update_data(is_vat_included=is_included, vat_amount=vat_amt)
    await state.set_state(ExpenseWizard.confirm)
    await _show_expense_confirm(callback.message, state, edit=True)


@wizard_router.callback_query(
    F.data == "wiz:confirm:yes", IsAdmin(), StateFilter(ExpenseWizard.confirm)
)
async def expense_confirm(
    callback: CallbackQuery, state: FSMContext, db: Database
) -> None:
    if not isinstance(callback.message, Message):
        return
    d = await state.get_data()

    amount: float = d["amount"]
    category: str = d.get("category") or "other"
    category_label: str = d.get("category_label", "")
    description: Optional[str] = d.get("description")
    payment_method: str = d.get("payment_method") or "cash"
    vat_amount_e: float = d.get("vat_amount", 0.0)
    is_vat_included_e: bool = d.get("is_vat_included", False)

    db_category = None if category == "other" else category
    expense_id = await db.create_expense(
        amount=amount,
        description=description or category_label,
        category=db_category,
        payment_method=payment_method,
        vat_amount=vat_amount_e,
        is_vat_included=is_vat_included_e,
    )

    # Ready for another expense in the same session
    await state.set_state(ExpenseWizard.category)
    await state.set_data({})

    pm_label = "💵 ნაღდი" if payment_method == "cash" else "🏦 გადარიცხვა"
    desc_line = f"\n📝 {_e(description)}" if description else ""
    await callback.message.edit_text(
        f"✅ <b>ხარჯი #{expense_id} დაფიქსირდა</b>\n"
        f"🏷 {_e(category_label)}\n"
        f"💰 <b>{amount:.2f}₾</b>  {pm_label}"
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
            reply_markup=topic_expense_kb(expense_id),
        )
        await db.update_expense_topic_message(
            expense_id, config.EXPENSES_TOPIC_ID, topic_msg.message_id
        )
    except Exception as exc:
        logger.warning("Failed to post expense to topic: %s", exc)


@wizard_router.callback_query(
    F.data == "wiz:confirm:no", IsAdmin(), StateFilter(ExpenseWizard.confirm)
)
async def expense_confirm_no(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    await state.clear()
    await callback.message.edit_text("❌ <b>ხარჯი გაუქმებულია.</b>", parse_mode=_PARSE)


# ═══════════════════════════════════════════════════════════════════════════════
# SALE EDIT WIZARD
# ═══════════════════════════════════════════════════════════════════════════════

_SALE_FIELDS = {
    "qty": "რაოდენობა",
    "price": "ფასი (₾)",
    "pay": "გადახდა",
    "cust": "კლიენტი",
    "prod": "პროდუქტი",
}


def _sale_edit_field_kb(sale_id: int, is_credit: bool) -> InlineKeyboardMarkup:
    rows = [
        [
            _btn("🔢 რაოდენობა", f"sef:{sale_id}:qty"),
            _btn("💰 ფასი", f"sef:{sale_id}:price"),
        ],
        [
            _btn("💳 გადახდა", f"sef:{sale_id}:pay"),
            _btn("👤 კლიენტი", f"sef:{sale_id}:cust"),
        ],
        [_btn("📦 პროდუქტი", f"sef:{sale_id}:prod")],
        [_btn("↩️ დაბრუნება", f"ret:sale:{sale_id}")],
        _CANCEL_ROW,
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


@wizard_router.callback_query(F.data.startswith("edit:sale:"), IsAdmin())
async def sale_edit_start(
    callback: CallbackQuery, state: FSMContext, db: Database
) -> None:
    if not isinstance(callback.message, Message):
        return
    try:
        sale_id = int(callback.data.split(":")[2])
    except (IndexError, ValueError):
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    sale = await db.get_sale(sale_id)
    if not sale:
        await callback.answer(f"⚠️ #{sale_id} ვერ მოიძებნა.", show_alert=True)
        return

    # When triggered from a group topic, route the edit wizard to DM so the
    # topic stays clean and the admin can input values privately.
    target_chat_id = _edit_target_chat(callback)

    # Nisias get their own richer edit flow (Name / Phone / Product / Qty / Price)
    if sale.get("payment_method") == "credit":
        await _start_nisia_edit(
            callback.message, state, sale, send=True, target_chat_id=target_chat_id
        )
        await callback.answer(
            "✏️ ნისიის რედაქტირება DM-ში"
            if target_chat_id != callback.message.chat.id
            else None
        )
        return

    await state.set_state(SaleEditWizard.field)
    await state.set_data({"edit_sale_id": sale_id})

    qty = sale["quantity"]
    price = float(sale["unit_price"])
    pay = {"cash": "ხელზე 💵", "transfer": "დარიცხა 🏦", "credit": "ნისია 📋"}.get(
        sale["payment_method"], sale["payment_method"]
    )
    name = sale.get("product_name") or sale.get("notes") or "—"
    cust = sale.get("customer_name") or "—"

    text = (
        f"✏️ <b>გაყიდვა #{sale_id} — რედაქტირება</b>\n\n"
        f"📦 {_e(name)}\n"
        f"🔢 რაოდ: {qty}ც × {price:.2f}₾ = <b>{qty * price:.2f}₾</b>\n"
        f"💳 {pay}  |  👤 {_e(cust)}\n\n"
        "რომელი ველი შეიცვალოს?"
    )
    kb = _sale_edit_field_kb(sale_id, sale["payment_method"] == "credit")
    await callback.bot.send_message(
        chat_id=target_chat_id,
        text=text,
        parse_mode=_PARSE,
        reply_markup=kb,
    )
    if target_chat_id != callback.message.chat.id:
        await callback.answer("✏️ რედაქტირება DM-ში")
    else:
        await callback.answer()


# ═══════════════════════════════════════════════════════════════════════════════
# NISIA EDIT WIZARD
# ═══════════════════════════════════════════════════════════════════════════════

# Matches a phone-like run of digits (allow +, spaces, dashes inside).
_PHONE_RE = re.compile(r"\+?\d[\d\s\-]{4,}")

_NISIA_FIELD_LABELS = {
    "name": "სახელი",
    "phone": "ტელ. ნომერი",
    "prod": "პროდუქტი",
    "qty": "რაოდენობა",
    "price": "ფასი (₾)",
}


def _split_name_phone(customer: Optional[str]) -> Tuple[str, str]:
    """Split a combined customer_name into (name, phone).

    Phone is detected as the longest digit run (len ≥ 5, with +/ /- allowed).
    Everything else becomes the name; whitespace is normalized.
    """
    raw = (customer or "").strip()
    if not raw:
        return "", ""
    matches = _PHONE_RE.findall(raw)
    phone = ""
    name = raw
    if matches:
        # Prefer the longest/latest match
        phone = max(matches, key=len).strip()
        name = raw.replace(phone, "", 1)
    name = re.sub(r"\s+", " ", name).strip(" ,;:-")
    phone = re.sub(r"\s+", " ", phone).strip()
    return name, phone


def _combine_name_phone(name: str, phone: str) -> Optional[str]:
    name = (name or "").strip()
    phone = (phone or "").strip()
    if name and phone:
        return f"{name} {phone}"
    return (name or phone) or None


def _nisia_edit_field_kb(sale_id: int) -> InlineKeyboardMarkup:
    return _kb(
        [
            _btn("👤 სახელი", f"nef:{sale_id}:name"),
            _btn("📞 ტელ. ნომერი", f"nef:{sale_id}:phone"),
        ],
        [_btn("📦 პროდუქტი", f"nef:{sale_id}:prod")],
        [
            _btn("🔢 რაოდენობა", f"nef:{sale_id}:qty"),
            _btn("💰 ფასი", f"nef:{sale_id}:price"),
        ],
        _CANCEL_ROW,
    )


def _nisia_edit_confirm_kb() -> InlineKeyboardMarkup:
    return _kb(
        [
            _btn("✅ შენახვა", "ne:yes"),
            _btn("❌ გაუქმება", "ne:no"),
        ]
    )


async def _start_nisia_edit(
    msg: Message,
    state: FSMContext,
    sale: dict,
    *,
    send: bool,
    target_chat_id: Optional[int] = None,
) -> None:
    """Render the 5-field edit menu for a specific ნისია.

    If `target_chat_id` is provided and differs from the source chat, the
    menu is sent as a new message to that chat (used when the edit was
    triggered from a group topic: we redirect to the admin's DM).
    """
    sale_id = sale["id"]
    qty = sale["quantity"]
    price = float(sale["unit_price"])
    product = sale.get("product_name") or sale.get("notes") or "—"
    name, phone = _split_name_phone(sale.get("customer_name"))
    seller = sale.get("seller_type", "individual")
    seller_label = "🏢 შპს" if seller == "llc" else "👤 ფზ პირი"

    await state.set_state(NisiaEditWizard.field)
    await state.set_data({"edit_sale_id": sale_id})

    text = (
        f"✏️ <b>ნისია #{sale_id} — რედაქტირება</b>\n\n"
        f"👤 სახელი: <b>{_e(name) if name else '—'}</b>\n"
        f"📞 ტელ: <b>{_e(phone) if phone else '—'}</b>\n"
        f"📦 პროდუქტი: <b>{_e(product)}</b>\n"
        f"🔢 რაოდ: {qty}ც × {price:.2f}₾ = <b>{qty * price:.2f}₾</b>\n"
        f"🏢 გამყიდველი: {seller_label}\n\n"
        "რომელი ველი შეიცვალოს?"
    )
    kb = _nisia_edit_field_kb(sale_id)
    if target_chat_id is not None and target_chat_id != msg.chat.id:
        await msg.bot.send_message(
            chat_id=target_chat_id,
            text=text,
            parse_mode=_PARSE,
            reply_markup=kb,
        )
        return
    if send:
        await msg.answer(text, parse_mode=_PARSE, reply_markup=kb)
    else:
        await msg.edit_text(text, parse_mode=_PARSE, reply_markup=kb)


def _edit_target_chat(callback: CallbackQuery) -> int:
    """Return the chat ID where the next edit-wizard step should be sent.

    When the edit was triggered from a group topic, route the wizard into
    the admin's DM so the topic stays clean and input flows privately.
    """
    if not isinstance(callback.message, Message):
        return
    assert callback.from_user is not None
    if callback.message.chat.type == ChatType.PRIVATE:
        return callback.message.chat.id
    return callback.from_user.id


@wizard_router.callback_query(F.data.startswith("edit:nisia:"), IsAdmin())
async def nisia_edit_start(
    callback: CallbackQuery, state: FSMContext, db: Database
) -> None:
    """Entrypoint used by /nisias ✏️ button (and any caller that already knows sale_id)."""
    if not isinstance(callback.message, Message):
        return
    try:
        sale_id = int(callback.data.split(":")[2])
    except (IndexError, ValueError):
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    sale = await db.get_sale(sale_id)
    if not sale:
        await callback.answer(f"⚠️ #{sale_id} ვერ მოიძებნა.", show_alert=True)
        return
    if sale.get("payment_method") != "credit":
        await callback.answer("⚠️ ეს ჩანაწერი ნისია არ არის.", show_alert=True)
        return

    target_chat_id = _edit_target_chat(callback)
    await _start_nisia_edit(
        callback.message,
        state,
        sale,
        send=True,
        target_chat_id=target_chat_id,
    )
    if target_chat_id != callback.message.chat.id:
        await callback.answer("✏️ რედაქტირება DM-ში")
    else:
        await callback.answer()


@wizard_router.callback_query(
    F.data.startswith("nef:"), IsAdmin(), StateFilter(NisiaEditWizard.field)
)
async def nisia_edit_field(
    callback: CallbackQuery, state: FSMContext, db: Database
) -> None:
    if not isinstance(callback.message, Message):
        return
    parts = callback.data.split(":")  # nef:{sale_id}:{field}
    if len(parts) < 3:
        await callback.answer("❌ შეცდომა", show_alert=True)
        return
    sale_id = int(parts[1])
    field = parts[2]
    if field not in _NISIA_FIELD_LABELS:
        await callback.answer("❌ უცნობი ველი", show_alert=True)
        return

    sale = await db.get_sale(sale_id)
    if not sale:
        await callback.answer(f"⚠️ #{sale_id} ვერ მოიძებნა.", show_alert=True)
        return

    await state.update_data(edit_field=field)

    if field == "prod":
        await state.set_state(NisiaEditWizard.product_oem)
        current = sale.get("product_name") or sale.get("notes") or "—"
        await callback.message.edit_text(
            f"📦 <b>ახალი პროდუქტი</b> (ახლა: {_e(current)})\n\n"
            "1️⃣ ჩაწერე <b>OEM კოდი</b>:\n"
            "<i>გამოტოვებისთვის გამოგზავნე <code>-</code></i>",
            parse_mode=_PARSE,
            reply_markup=_kb(_CANCEL_ROW),
        )
        await callback.answer()
        return

    # Simple text/number fields (name, phone, qty, price)
    await state.set_state(NisiaEditWizard.value)
    label = _NISIA_FIELD_LABELS[field]
    current = ""
    if field == "qty":
        current = f" (ახლა: {sale['quantity']}ც)"
    elif field == "price":
        current = f" (ახლა: {float(sale['unit_price']):.2f}₾)"
    elif field in ("name", "phone"):
        cur_name, cur_phone = _split_name_phone(sale.get("customer_name"))
        val = cur_name if field == "name" else cur_phone
        current = f" (ახლა: {_e(val) if val else '—'})"

    await callback.message.edit_text(
        f"✏️ <b>{label}</b>{current}\n\nჩაწერე ახალი მნიშვნელობა:",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )
    await callback.answer()


@wizard_router.message(NisiaEditWizard.value, IsAdmin(), _PRIVATE)
async def nisia_edit_value_input(message: Message, state: FSMContext) -> None:
    d = await state.get_data()
    field = d.get("edit_field", "")
    text = (message.text or "").strip()

    if field == "qty":
        try:
            val: object = int(text)
            if val <= 0:  # type: ignore[operator]
                raise ValueError
        except ValueError:
            await message.answer("⚠️ ჩაწერე დადებითი მთელი რიცხვი.", parse_mode=_PARSE)
            return
        await state.update_data(edit_value=val, edit_display=f"{val}ც")

    elif field == "price":
        try:
            val = float(text.replace(",", ".").replace("₾", "").replace("ლ", ""))
            if val <= 0:  # type: ignore[operator]
                raise ValueError
        except ValueError:
            await message.answer(
                "⚠️ ჩაწერე სწორი ფასი, მაგ: <code>35</code>", parse_mode=_PARSE
            )
            return
        await state.update_data(edit_value=val, edit_display=f"{val:.2f}₾")  # type: ignore[str-format]

    elif field in ("name", "phone"):
        if not text:
            await message.answer(
                "⚠️ ცარიელი მნიშვნელობა დაუშვებელია.", parse_mode=_PARSE
            )
            return
        await state.update_data(edit_value=text, edit_display=text)

    else:
        await message.answer("❌ უცნობი ველი", parse_mode=_PARSE)
        return

    label = _NISIA_FIELD_LABELS.get(field, field)
    await state.set_state(NisiaEditWizard.confirm)
    await message.answer(
        f"✏️ <b>{label}</b> → <b>{_e(text)}</b>\n\nდაადასტურე?",
        parse_mode=_PARSE,
        reply_markup=_nisia_edit_confirm_kb(),
    )


@wizard_router.message(NisiaEditWizard.product_oem, IsAdmin(), _PRIVATE)
async def nisia_edit_product_oem_input(
    message: Message,
    state: FSMContext,
) -> None:
    """Step 1 of product edit: collect OEM, then ask for product name."""
    raw = (message.text or "").strip()
    oem = None if raw == "-" else (raw or None)
    await state.update_data(_edit_oem=oem)
    await state.set_state(NisiaEditWizard.product_search)
    oem_line = f"✅ OEM: <code>{_e(oem)}</code>\n\n" if oem else ""
    await message.answer(
        f"{oem_line}2️⃣ ჩაწერე პროდუქტის <b>დასახელება</b>:",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )


@wizard_router.message(NisiaEditWizard.product_search, IsAdmin(), _PRIVATE)
async def nisia_edit_product_search(
    message: Message,
    state: FSMContext,
    db: Database,
) -> None:
    query = (message.text or "").strip()
    if not query:
        await message.answer("⚠️ ჩაწერე პროდუქტის დასახელება.", parse_mode=_PARSE)
        return

    data = await state.get_data()
    edit_oem: Optional[str] = data.get("_edit_oem")

    products: list = []
    if edit_oem:
        products = await db.search_products(edit_oem, limit=6)
    if not products:
        products = await db.search_products(query, limit=6)

    if len(products) == 1:
        p = products[0]
        await state.update_data(
            edit_value={
                "product_id": p["id"],
                "product_name": p["name"],
                "freeform": False,
            },
            edit_display=p["name"],
        )
        await state.set_state(NisiaEditWizard.confirm)
        await message.answer(
            f"📦 ახალი პროდუქტი: <b>{_e(p['name'])}</b>\n\nდაადასტურე?",
            parse_mode=_PARSE,
            reply_markup=_nisia_edit_confirm_kb(),
        )
        return

    buttons: list = []
    if len(products) > 1:
        for p in products:
            label = p["name"]
            if p.get("oem_code"):
                label += f" [{p['oem_code']}]"
            buttons.append([_btn(label, f"nep:id:{p['id']}")])
        buttons.append([_btn(f"❓ ჩაწერე თავისუფლად: {query[:30]}", "nep:free")])
        buttons.append(_CANCEL_ROW)
        await state.update_data(_pending_freeform_name=query)
        await state.set_state(NisiaEditWizard.product_select)
        await message.answer(
            f"🔍 <b>ვიპოვე {len(products)} პროდუქტი.</b> აირჩიე:",
            parse_mode=_PARSE,
            reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons),
        )
        return

    # No matches — offer freeform
    await state.update_data(_pending_freeform_name=query)
    await state.set_state(NisiaEditWizard.product_select)
    await message.answer(
        f"⚠️ <b>'{_e(query)}'</b> ბაზაში ვერ ვიპოვე.\n"
        "ჩავწეროთ თავისუფალ ფორმატში? (product_id გაუქმდება)",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [_btn(f"✅ ჩაწერა: {query[:40]}", "nep:free")],
            _CANCEL_ROW,
        ),
    )


@wizard_router.callback_query(
    F.data.startswith("nep:"), IsAdmin(), StateFilter(NisiaEditWizard.product_select)
)
async def nisia_edit_product_pick(
    callback: CallbackQuery,
    state: FSMContext,
    db: Database,
) -> None:
    if not isinstance(callback.message, Message):
        return
    parts = callback.data.split(":")  # nep:free  |  nep:id:{pid}
    d = await state.get_data()

    if parts[1] == "free":
        name = (d.get("_pending_freeform_name") or "").strip()
        if not name:
            await callback.answer("❌ სახელი ცარიელია", show_alert=True)
            return
        await state.update_data(
            edit_value={"product_id": None, "product_name": name, "freeform": True},
            edit_display=name,
        )
    elif parts[1] == "id" and len(parts) >= 3:
        try:
            pid = int(parts[2])
        except ValueError:
            await callback.answer("❌ შეცდომა", show_alert=True)
            return
        prod = await db.get_product_by_id(pid)
        if not prod:
            await callback.answer("⚠️ პროდუქტი ვერ მოიძებნა", show_alert=True)
            return
        await state.update_data(
            edit_value={
                "product_id": pid,
                "product_name": prod["name"],
                "freeform": False,
            },
            edit_display=prod["name"],
        )
    else:
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    display = (await state.get_data()).get("edit_display", "—")
    await state.set_state(NisiaEditWizard.confirm)
    await callback.message.edit_text(
        f"📦 ახალი პროდუქტი: <b>{_e(display)}</b>\n\nდაადასტურე?",
        parse_mode=_PARSE,
        reply_markup=_nisia_edit_confirm_kb(),
    )
    await callback.answer()


@wizard_router.callback_query(
    F.data == "ne:no", IsAdmin(), StateFilter(NisiaEditWizard.confirm)
)
async def nisia_edit_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    await state.clear()
    await callback.message.edit_text(
        "❌ <b>რედაქტირება გაუქმდა.</b>", parse_mode=_PARSE
    )


@wizard_router.callback_query(
    F.data == "ne:yes", IsAdmin(), StateFilter(NisiaEditWizard.confirm)
)
async def nisia_edit_confirm(
    callback: CallbackQuery,
    state: FSMContext,
    db: Database,
) -> None:
    if not isinstance(callback.message, Message):
        return
    d = await state.get_data()
    sale_id = int(d["edit_sale_id"])
    field = d["edit_field"]
    new_val = d["edit_value"]
    await state.clear()

    sale = await db.get_sale(sale_id)
    if not sale:
        await callback.message.edit_text(
            f"⚠️ ნისია #{sale_id} ვერ მოიძებნა.", parse_mode=_PARSE
        )
        return

    kwargs: dict = {}
    if field == "qty":
        kwargs["quantity"] = int(new_val)
    elif field == "price":
        kwargs["unit_price"] = float(new_val)
    elif field in ("name", "phone"):
        cur_name, cur_phone = _split_name_phone(sale.get("customer_name"))
        if field == "name":
            cur_name = str(new_val).strip()
        else:
            cur_phone = str(new_val).strip()
        kwargs["customer_name"] = _combine_name_phone(cur_name, cur_phone)
    elif field == "prod":
        # new_val is a dict: {"product_id": Optional[int], "product_name": str, "freeform": bool}
        if new_val.get("freeform"):
            kwargs["clear_product"] = True
            kwargs["notes"] = new_val["product_name"]
        else:
            kwargs["product_id"] = int(new_val["product_id"])
            # Clear stale freeform notes so the joined product_name wins
            if sale.get("product_id") is None and sale.get("notes"):
                kwargs["notes"] = ""
    else:
        await callback.message.edit_text("❌ უცნობი ველი.", parse_mode=_PARSE)
        return

    updated = await db.edit_sale(sale_id, **kwargs)
    if not updated:
        await callback.message.edit_text(
            f"⚠️ ნისია #{sale_id} ვერ მოიძებნა.", parse_mode=_PARSE
        )
        return

    qty = updated["quantity"]
    price = float(updated["unit_price"])
    product = updated.get("product_name") or updated.get("notes") or "—"
    name, phone = _split_name_phone(updated.get("customer_name"))
    seller = updated.get("seller_type", "individual")
    seller_label = "🏢 შპს" if seller == "llc" else "👤 ფზ პირი"

    await callback.message.edit_text(
        f"✅ <b>ნისია #{sale_id} განახლდა</b>\n\n"
        f"👤 სახელი: <b>{_e(name) if name else '—'}</b>\n"
        f"📞 ტელ: <b>{_e(phone) if phone else '—'}</b>\n"
        f"📦 {_e(product)}\n"
        f"🔢 {qty}ც × {price:.2f}₾ = <b>{qty * price:.2f}₾</b>\n"
        f"🏢 {seller_label}",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [
                _btn(f"✏️ კიდევ რედ. #{sale_id}", f"edit:nisia:{sale_id}"),
                _btn(f"🗑 წაშლა #{sale_id}", f"ds:{sale_id}"),
            ]
        ),
    )

    # Refresh the topic message. When the topic stays the same (still a
    # nisia), edit the original post in place with a "შეცვლილია" banner;
    # otherwise cancel the old post and send a new one to the new topic.
    old_topic_id = updated.get("topic_id")
    old_topic_msg = updated.get("topic_message_id")
    new_topic_text = format_topic_nisia(
        customer_name=updated.get("customer_name") or "",
        product_name=product,
        qty=qty,
        price=price,
        sale_id=sale_id,
        unknown_product=updated.get("product_id") is None,
        oem_code=updated.get("oem_code"),
    )

    if old_topic_msg and old_topic_id == config.NISIAS_TOPIC_ID:
        edit_count = await db.get_sale_edit_count(sale_id)
        await mark_updated(
            callback.bot,
            config.GROUP_ID,
            old_topic_msg,
            new_topic_text,
            edit_count=edit_count,
        )
    else:
        if old_topic_msg:
            await mark_cancelled(
                callback.bot,
                config.GROUP_ID,
                old_topic_msg,
                new_topic_text,
            )
        try:
            new_topic = await callback.bot.send_message(
                chat_id=config.GROUP_ID,
                message_thread_id=config.NISIAS_TOPIC_ID,
                text=new_topic_text,
                parse_mode=_PARSE,
                reply_markup=topic_nisia_kb(sale_id),
            )
            await db.update_sale_topic_message(
                sale_id,
                config.NISIAS_TOPIC_ID,
                new_topic.message_id,
            )
        except Exception as exc:
            logger.warning(
                "Failed to refresh topic after nisia edit #%d: %s", sale_id, exc
            )

    await callback.answer(f"✅ #{sale_id} განახლდა")


@wizard_router.callback_query(
    F.data.startswith("sef:"), IsAdmin(), StateFilter(SaleEditWizard.field)
)
async def sale_edit_field(
    callback: CallbackQuery, state: FSMContext, db: Database
) -> None:
    if not isinstance(callback.message, Message):
        return
    parts = callback.data.split(":")  # sef:{sale_id}:{field}
    if len(parts) < 3:
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    sale_id = int(parts[1])
    field = parts[2]
    await state.update_data(edit_field=field)

    if field == "prod":
        await state.set_state(SaleEditWizard.product_oem)
        sale = await db.get_sale(sale_id)
        current = (
            (sale.get("product_name") or sale.get("notes") or "—") if sale else "—"
        )
        await callback.message.edit_text(
            f"📦 ახლანდელი: <b>{_e(current)}</b>\n\n"
            "1️⃣ ჩაწერე <b>OEM კოდი</b> (ან <code>-</code> თუ არ გაქვს):",
            parse_mode=_PARSE,
            reply_markup=_kb(_CANCEL_ROW),
        )
        await callback.answer()
        return

    await state.set_state(SaleEditWizard.value)

    if field == "pay":
        await callback.message.edit_text(
            "💳 <b>ახალი გადახდის მეთოდი:</b>",
            parse_mode=_PARSE,
            reply_markup=_kb(
                [_btn("💵 ხელზე", "wiz:epay:cash")],
                [_btn("🏦 დარიცხა", "wiz:epay:transfer")],
                [_btn("📋 ნისია", "wiz:epay:credit")],
                _CANCEL_ROW,
            ),
        )
    else:
        label = _SALE_FIELDS.get(field, field)
        sale = await db.get_sale(sale_id)
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


@wizard_router.callback_query(
    F.data.startswith("wiz:epay:"), IsAdmin(), StateFilter(SaleEditWizard.value)
)
async def sale_edit_payment_pick(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    method = callback.data.split(":")[2]
    await state.update_data(edit_value=method)
    await state.set_state(SaleEditWizard.confirm)
    label = {"cash": "ხელზე 💵", "transfer": "დარიცხა 🏦", "credit": "ნისია 📋"}.get(
        method, method
    )
    await callback.message.edit_text(
        f"💳 ახალი გადახდა: <b>{label}</b>\n\nდაადასტურე?",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [
                _btn("✅ შენახვა", "wiz:econfirm:yes"),
                _btn("❌ გაუქმება", "wiz:econfirm:no"),
            ]
        ),
    )
    await callback.answer()


@wizard_router.message(SaleEditWizard.value, IsAdmin(), _PRIVATE)
async def sale_edit_value_input(message: Message, state: FSMContext) -> None:
    d = await state.get_data()
    field = d.get("edit_field", "")
    text = (message.text or "").strip()

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
            val_price = float(text.replace(",", ".").replace("₾", "").replace("ლ", ""))
            if val_price <= 0:
                raise ValueError
        except ValueError:
            await message.answer(
                "⚠️ ჩაწერე სწორი ფასი, მაგ: <code>35</code>", parse_mode=_PARSE
            )
            return
        await state.update_data(edit_value=val_price)

    elif field == "cust":
        await state.update_data(edit_value=text or None)

    label = _SALE_FIELDS.get(field, field)
    await state.set_state(SaleEditWizard.confirm)
    await message.answer(
        f"✏️ <b>{label}</b> → <b>{_e(text)}</b>\n\nდაადასტურე?",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [
                _btn("✅ შენახვა", "wiz:econfirm:yes"),
                _btn("❌ გაუქმება", "wiz:econfirm:no"),
            ]
        ),
    )


@wizard_router.message(SaleEditWizard.product_oem, IsAdmin(), _PRIVATE)
async def sale_edit_product_oem_input(message: Message, state: FSMContext) -> None:
    raw = (message.text or "").strip()
    oem = None if raw == "-" else (raw or None)
    await state.update_data(_edit_oem=oem)
    await state.set_state(SaleEditWizard.product_search)
    oem_line = f"✅ OEM: <code>{_e(oem)}</code>\n\n" if oem else ""
    await message.answer(
        f"{oem_line}2️⃣ ჩაწერე პროდუქტის <b>დასახელება</b>:",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )


@wizard_router.message(SaleEditWizard.product_search, IsAdmin(), _PRIVATE)
async def sale_edit_product_search(
    message: Message,
    state: FSMContext,
    db: Database,
) -> None:
    query = (message.text or "").strip()
    if not query:
        await message.answer("⚠️ ჩაწერე პროდუქტის დასახელება.", parse_mode=_PARSE)
        return

    data = await state.get_data()
    edit_oem: Optional[str] = data.get("_edit_oem")

    products: list = []
    if edit_oem:
        products = await db.search_products(edit_oem, limit=6)
    if not products:
        products = await db.search_products(query, limit=6)

    _confirm_kb = _kb(
        [_btn("✅ შენახვა", "wiz:econfirm:yes"), _btn("❌ გაუქმება", "wiz:econfirm:no")]
    )

    if len(products) == 1:
        p = products[0]
        await state.update_data(
            edit_value={
                "product_id": p["id"],
                "product_name": p["name"],
                "freeform": False,
            },
            edit_display=p["name"],
        )
        await state.set_state(SaleEditWizard.confirm)
        await message.answer(
            f"📦 ახალი პროდუქტი: <b>{_e(p['name'])}</b>\n\nდაადასტურე?",
            parse_mode=_PARSE,
            reply_markup=_confirm_kb,
        )
        return

    buttons: list = []
    if len(products) > 1:
        for p in products:
            label = p["name"]
            if p.get("oem_code"):
                label += f" [{p['oem_code']}]"
            buttons.append([_btn(label, f"sep:id:{p['id']}")])
        buttons.append([_btn(f"❓ ჩაწერე თავისუფლად: {query[:30]}", "sep:free")])
        buttons.append(_CANCEL_ROW)
        await state.update_data(_pending_freeform_name=query)
        await state.set_state(SaleEditWizard.product_select)
        await message.answer(
            f"🔍 <b>ვიპოვე {len(products)} პროდუქტი.</b> აირჩიე:",
            parse_mode=_PARSE,
            reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons),
        )
        return

    await state.update_data(_pending_freeform_name=query)
    await state.set_state(SaleEditWizard.product_select)
    await message.answer(
        f"⚠️ <b>'{_e(query)}'</b> ბაზაში ვერ ვიპოვე.\n"
        "ჩავწეროთ თავისუფალ ფორმატში? (product_id გაუქმდება)",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [_btn(f"✅ ჩაწერა: {query[:40]}", "sep:free")],
            _CANCEL_ROW,
        ),
    )


@wizard_router.callback_query(
    F.data.startswith("sep:"), IsAdmin(), StateFilter(SaleEditWizard.product_select)
)
async def sale_edit_product_pick(
    callback: CallbackQuery,
    state: FSMContext,
    db: Database,
) -> None:
    if not isinstance(callback.message, Message):
        return
    parts = callback.data.split(":")  # sep:free  |  sep:id:{pid}
    d = await state.get_data()

    if parts[1] == "free":
        name = (d.get("_pending_freeform_name") or "").strip()
        if not name:
            await callback.answer("❌ სახელი ცარიელია", show_alert=True)
            return
        await state.update_data(
            edit_value={"product_id": None, "product_name": name, "freeform": True},
            edit_display=name,
        )
    elif parts[1] == "id" and len(parts) >= 3:
        try:
            pid = int(parts[2])
        except ValueError:
            await callback.answer("❌ შეცდომა", show_alert=True)
            return
        prod = await db.get_product_by_id(pid)
        if not prod:
            await callback.answer("⚠️ პროდუქტი ვერ მოიძებნა", show_alert=True)
            return
        await state.update_data(
            edit_value={
                "product_id": pid,
                "product_name": prod["name"],
                "freeform": False,
            },
            edit_display=prod["name"],
        )
    else:
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    display = (await state.get_data()).get("edit_display", "—")
    await state.set_state(SaleEditWizard.confirm)
    await callback.message.edit_text(
        f"📦 ახალი პროდუქტი: <b>{_e(display)}</b>\n\nდაადასტურე?",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [
                _btn("✅ შენახვა", "wiz:econfirm:yes"),
                _btn("❌ გაუქმება", "wiz:econfirm:no"),
            ]
        ),
    )
    await callback.answer()


@wizard_router.callback_query(
    F.data == "wiz:econfirm:yes", IsAdmin(), StateFilter(SaleEditWizard.confirm)
)
async def sale_edit_confirm(
    callback: CallbackQuery, state: FSMContext, db: Database
) -> None:
    if not isinstance(callback.message, Message):
        return
    d = await state.get_data()
    sale_id = d["edit_sale_id"]
    field = d["edit_field"]
    new_val = d["edit_value"]
    await state.clear()

    kwargs: dict = {}
    if field == "qty":
        kwargs["quantity"] = new_val
    elif field == "price":
        kwargs["unit_price"] = new_val
    elif field == "pay":
        kwargs["payment_method"] = new_val
    elif field == "cust":
        kwargs["customer_name"] = new_val
    elif field == "prod":
        # new_val is {"product_id": Optional[int], "product_name": str, "freeform": bool}
        if new_val.get("freeform"):
            kwargs["clear_product"] = True
            kwargs["notes"] = new_val["product_name"]
        else:
            kwargs["product_id"] = int(new_val["product_id"])
            sale_now = await db.get_sale(sale_id)
            if (
                sale_now
                and sale_now.get("product_id") is None
                and sale_now.get("notes")
            ):
                kwargs["notes"] = ""

    updated = await db.edit_sale(sale_id, **kwargs)
    if not updated:
        await callback.message.edit_text(
            f"⚠️ გაყიდვა #{sale_id} ვერ მოიძებნა.", parse_mode=_PARSE
        )
        return

    qty = updated["quantity"]
    price = float(updated["unit_price"])
    pay = {"cash": "ხელზე 💵", "transfer": "დარიცხა 🏦", "credit": "ნისია 📋"}.get(
        updated["payment_method"], updated["payment_method"]
    )
    prod_name = updated.get("product_name") or updated.get("notes") or "—"

    await callback.message.edit_text(
        f"✅ <b>გაყიდვა #{sale_id} განახლდა</b>\n"
        f"📦 {_e(prod_name)}\n"
        f"🔢 {qty}ც × {price:.2f}₾ = <b>{qty * price:.2f}₾</b>\n"
        f"💳 {pay}",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [
                _btn(f"🗑 წაშლა #{sale_id}", f"ds:{sale_id}"),
                _btn(f"✏️ რედ. #{sale_id}", f"edit:sale:{sale_id}"),
            ]
        ),
    )

    # Refresh the topic message: edit in place when the topic does not
    # change; otherwise cancel the old post and mirror to the new topic.
    old_topic_id = updated.get("topic_id")
    old_topic_msg = updated.get("topic_message_id")
    new_topic_id = (
        config.NISIAS_TOPIC_ID
        if updated["payment_method"] == "credit"
        else config.SALES_TOPIC_ID
    )
    product_name = (
        updated.get("product_name") or updated.get("notes") or f"გაყიდვა #{sale_id}"
    )
    new_topic_text = format_topic_sale(
        product_name=product_name,
        qty=qty,
        price=price,
        payment=updated["payment_method"],
        sale_id=sale_id,
        customer_name=updated.get("customer_name"),
        oem_code=updated.get("oem_code"),
    )

    if old_topic_msg and old_topic_id == new_topic_id:
        edit_count = await db.get_sale_edit_count(sale_id)
        await mark_updated(
            callback.bot,
            config.GROUP_ID,
            old_topic_msg,
            new_topic_text,
            edit_count=edit_count,
        )
    else:
        if old_topic_msg:
            await mark_cancelled(
                callback.bot,
                config.GROUP_ID,
                old_topic_msg,
                new_topic_text,
            )
        new_topic_kb = (
            topic_nisia_kb(sale_id)
            if updated["payment_method"] == "credit"
            else topic_sale_kb(sale_id)
        )
        try:
            new_topic = await callback.bot.send_message(
                chat_id=config.GROUP_ID,
                message_thread_id=new_topic_id,
                text=new_topic_text,
                parse_mode=_PARSE,
                reply_markup=new_topic_kb,
            )
            await db.update_sale_topic_message(
                sale_id, new_topic_id, new_topic.message_id
            )
        except Exception as exc:
            logger.warning(
                "Failed to refresh topic after sale edit #%d: %s", sale_id, exc
            )

    await callback.answer(f"✅ #{sale_id} განახლდა")


@wizard_router.callback_query(
    F.data == "wiz:econfirm:no", IsAdmin(), StateFilter(SaleEditWizard.confirm)
)
async def sale_edit_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    await state.clear()
    await callback.message.edit_text(
        "❌ <b>რედაქტირება გაუქმდა.</b>", parse_mode=_PARSE
    )


# ═══════════════════════════════════════════════════════════════════════════════
# EXPENSE EDIT WIZARD
# ═══════════════════════════════════════════════════════════════════════════════

_EXPENSE_FIELDS = {
    "amt": "თანხა (₾)",
    "desc": "აღწერა",
    "cat": "კატეგორია",
}


@wizard_router.callback_query(F.data.startswith("edit:exp:"), IsAdmin())
async def expense_edit_start(
    callback: CallbackQuery, state: FSMContext, db: Database
) -> None:
    if not isinstance(callback.message, Message):
        return
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

    amt = float(exp["amount"])
    desc = exp.get("description") or "—"
    cat = exp.get("category") or "სხვა"

    text = (
        f"✏️ <b>ხარჯი #{expense_id} — რედაქტირება</b>\n\n"
        f"💰 {amt:.2f}₾  |  🏷 {_e(cat)}  |  📝 {_e(desc)}\n\n"
        "რომელი ველი შეიცვალოს?"
    )
    kb = _kb(
        [
            _btn("💰 თანხა", f"eef:{expense_id}:amt"),
            _btn("📝 აღწერა", f"eef:{expense_id}:desc"),
        ],
        [_btn("🏷 კატეგორია", f"eef:{expense_id}:cat")],
        _CANCEL_ROW,
    )

    target_chat_id = _edit_target_chat(callback)
    await callback.bot.send_message(
        chat_id=target_chat_id,
        text=text,
        parse_mode=_PARSE,
        reply_markup=kb,
    )
    if target_chat_id != callback.message.chat.id:
        await callback.answer("✏️ რედაქტირება DM-ში")
    else:
        await callback.answer()


@wizard_router.callback_query(
    F.data.startswith("eef:"), IsAdmin(), StateFilter(ExpenseEditWizard.field)
)
async def expense_edit_field(
    callback: CallbackQuery, state: FSMContext, db: Database
) -> None:
    if not isinstance(callback.message, Message):
        return
    parts = callback.data.split(":")  # eef:{expense_id}:{field}
    if len(parts) < 3:
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    expense_id = int(parts[1])
    field = parts[2]
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


@wizard_router.callback_query(
    F.data.startswith("wiz:cat:"), IsAdmin(), StateFilter(ExpenseEditWizard.value)
)
async def expense_edit_cat_pick(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
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
        reply_markup=_kb(
            [
                _btn("✅ შენახვა", "wiz:econfirm:exp:yes"),
                _btn("❌ გაუქმება", "wiz:econfirm:exp:no"),
            ]
        ),
    )
    await callback.answer()


@wizard_router.message(ExpenseEditWizard.value, IsAdmin(), _PRIVATE)
async def expense_edit_value_input(message: Message, state: FSMContext) -> None:
    d = await state.get_data()
    field = d.get("edit_field", "")
    text = (message.text or "").strip()

    if field == "amt":
        try:
            val = float(text.replace(",", ".").replace("₾", "").replace("ლ", ""))
            if val <= 0:
                raise ValueError
        except ValueError:
            await message.answer(
                "⚠️ ჩაწერე სწორი თანხა, მაგ: <code>50</code>", parse_mode=_PARSE
            )
            return
        await state.update_data(edit_value=val)
    else:
        await state.update_data(edit_value=text or None)

    label = _EXPENSE_FIELDS.get(field, field)
    await state.set_state(ExpenseEditWizard.confirm)
    await message.answer(
        f"✏️ <b>{label}</b> → <b>{_e(text)}</b>\n\nდაადასტურე?",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [
                _btn("✅ შენახვა", "wiz:econfirm:exp:yes"),
                _btn("❌ გაუქმება", "wiz:econfirm:exp:no"),
            ]
        ),
    )


@wizard_router.callback_query(
    F.data == "wiz:econfirm:exp:yes", IsAdmin(), StateFilter(ExpenseEditWizard.confirm)
)
async def expense_edit_confirm(
    callback: CallbackQuery, state: FSMContext, db: Database
) -> None:
    if not isinstance(callback.message, Message):
        return
    d = await state.get_data()
    expense_id = d["edit_expense_id"]
    field = d["edit_field"]
    new_val = d["edit_value"]
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

    amt = float(updated["amount"])
    cat = updated.get("category")
    desc = updated.get("description") or ""

    await callback.message.edit_text(
        f"✅ <b>ხარჯი #{expense_id} განახლდა</b>\n"
        f"💰 <b>{amt:.2f}₾</b>" + (f"\n📝 {_e(desc)}" if desc else ""),
        parse_mode=_PARSE,
        reply_markup=_kb([_btn(f"✏️ რედ. #{expense_id}", f"edit:exp:{expense_id}")]),
    )

    # Refresh the topic message: edit in place with the "შეცვლილია"
    # banner. Expenses always live in the same topic, so no cross-topic
    # cancel+re-post path is needed.
    old_topic_msg = updated.get("topic_message_id")
    new_topic_text = format_topic_expense(
        amount=amt,
        category=cat,
        description=desc or None,
        expense_id=expense_id,
    )

    if old_topic_msg:
        edit_count = await db.get_expense_edit_count(expense_id)
        await mark_updated(
            callback.bot,
            config.GROUP_ID,
            old_topic_msg,
            new_topic_text,
            edit_count=edit_count,
        )
    else:
        try:
            new_topic = await callback.bot.send_message(
                chat_id=config.GROUP_ID,
                message_thread_id=config.EXPENSES_TOPIC_ID,
                text=new_topic_text,
                parse_mode=_PARSE,
                reply_markup=topic_expense_kb(expense_id),
            )
            await db.update_expense_topic_message(
                expense_id,
                config.EXPENSES_TOPIC_ID,
                new_topic.message_id,
            )
        except Exception as exc:
            logger.warning(
                "Failed to refresh topic after expense edit #%d: %s", expense_id, exc
            )

    await callback.answer(f"✅ #{expense_id} განახლდა")


@wizard_router.callback_query(
    F.data == "wiz:econfirm:exp:no", IsAdmin(), StateFilter(ExpenseEditWizard.confirm)
)
async def expense_edit_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(callback.message, Message):
        return
    await state.clear()
    await callback.message.edit_text(
        "❌ <b>რედაქტირება გაუქმდა.</b>", parse_mode=_PARSE
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Shared sub-flows (product search, quantity, price)
# ═══════════════════════════════════════════════════════════════════════════════


async def _handle_wizard_oem_input(
    message: Message, state: FSMContext, db: Database, wizard: str
) -> None:
    """Step 1 of product entry: collect OEM code, then query the DB.

    - OEM found in DB  → store product details, skip product-name step, go to quantity.
    - OEM not in DB    → store oem, go directly to new-product-name (skip search step).
    - No OEM given ("-") → fall back to the product-name search step as before.
    """
    raw = (message.text or "").strip()
    oem = None if raw == "-" else (raw or None)
    await state.update_data(entered_oem=oem)

    step = "2" if wizard == "sale" else "3"

    if oem:
        product = await db.get_product_by_oem(oem)
        if product:
            # OEM found — skip product-name step entirely
            await state.update_data(
                product_id=product["id"],
                product_name=product["name"],
                oem_code=product.get("oem_code"),
                is_freeform=False,
            )
            rec_price = product.get("recommended_price")
            wac = await db.get_product_wac(product["id"])
            cost_line = (
                f"\n💰 თვითღირებულება: <b>{wac:.2f} ₾</b>"
                if wac > 0
                else "\n💰 თვითღირებულება: -"
            )
            if rec_price is not None and float(rec_price) > 0:
                found_text = (
                    f"✅ OEM <code>{_e(oem)}</code> — ბაზაში ნაპოვნია:\n"
                    f"📦 <b>{_e(product['name'])}</b>\n\n"
                    f"💡 რეკომენდებული გასაყიდი ფასია: <b>{float(rec_price):.2f} ₾</b>"
                    f"{cost_line}"
                )
            else:
                found_text = (
                    f"✅ OEM <code>{_e(oem)}</code> — ბაზაში ნაპოვნია:\n"
                    f"📦 <b>{_e(product['name'])}</b>"
                    f"{cost_line}"
                )
            await message.answer(found_text, parse_mode=_PARSE)
            await _goto_quantity(message, state, wizard, product["name"], send=True)
            return

        # OEM not in DB — skip search step, go straight to new-product-name input
        new_name_state = (
            SaleWizard.new_product_name
            if wizard == "sale"
            else NisiaWizard.new_product_name
        )
        await state.set_state(new_name_state)
        await message.answer(
            f"⚠️ OEM <code>{_e(oem)}</code> ბაზაში ვერ მოიძებნა.\n\n"
            f"➕ <b>ნაბიჯი {step}/6</b> — შეიყვანე ნაწილის <b>დასახელება</b>\n"
            "<i>(ახალი პროდუქტი ავტომატურად შეიქმნება)</i>:",
            parse_mode=_PARSE,
            reply_markup=_kb(_CANCEL_ROW),
        )
        return

    # No OEM provided — fall back to product-name search as before
    product_state = SaleWizard.product if wizard == "sale" else NisiaWizard.product
    await state.set_state(product_state)
    await message.answer(
        f"➕ <b>ნაბიჯი {step}/6</b>\n\n2️⃣ ჩაწერე პროდუქტის <b>დასახელება</b>:",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )


async def _handle_product_search(
    message: Message, state: FSMContext, db: Database, wizard: str
) -> None:
    """Step 2: receive product name, search DB (using stored OEM if available)."""
    query = (message.text or "").strip()
    if not query:
        return

    data = await state.get_data()
    entered_oem: Optional[str] = data.get("entered_oem")

    # Try OEM-based search first (exact / prefix match), then fall back to name.
    products: list = []
    if entered_oem:
        products = await db.search_products(entered_oem, limit=6)
    if not products:
        products = await db.search_products(query, limit=6)

    if len(products) == 1:
        p = products[0]
        await state.update_data(
            product_id=p["id"],
            product_name=p["name"],
            oem_code=p.get("oem_code"),
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
    if not isinstance(callback.message, Message):
        return
    choice = callback.data.split(":", 2)[2]  # product id or "free"

    if choice == "free":
        d = await state.get_data()
        existing_name: Optional[str] = d.get("product_name")
        entered_oem: Optional[str] = d.get("entered_oem")

        if existing_name:
            # Name already captured from search step — skip asking again
            await state.update_data(product_id=None, is_freeform=True)
            if entered_oem:
                new_id = await db.create_product(name=existing_name, oem_code=entered_oem)
                await state.update_data(product_id=new_id, is_freeform=False)
                await callback.message.edit_text(
                    f"✅ <b>{_e(existing_name)}</b> ბაზაში დაემატა!\n"
                    f"OEM: <code>{_e(entered_oem)}</code>",
                    parse_mode=_PARSE,
                )
                await _goto_quantity(callback.message, state, wizard, existing_name, send=True)
            else:
                price_state = (
                    SaleWizard.new_product_price
                    if wizard == "sale"
                    else NisiaWizard.new_product_price
                )
                await state.set_state(price_state)
                await callback.message.edit_text(
                    f"✅ <b>{_e(existing_name)}</b>\n\n"
                    "💰 შეიყვანეთ ნაწილის <b>ერთეულის ფასი</b> (₾):",
                    parse_mode=_PARSE,
                    reply_markup=_kb(_CANCEL_ROW),
                )
            return

        new_name_state = (
            SaleWizard.new_product_name
            if wizard == "sale"
            else NisiaWizard.new_product_name
        )
        await state.update_data(product_id=None, is_freeform=True)
        await state.set_state(new_name_state)
        await callback.message.edit_text(
            "➕ <b>ახალი ნაწილის დამატება</b>\n\n"
            "✏️ შეიყვანეთ ახალი ნაწილის <b>დასახელება</b>:",
            parse_mode=_PARSE,
            reply_markup=_kb(_CANCEL_ROW),
        )
        return

    product_id = int(choice)
    product = await db.get_product_by_id(product_id)
    if not product:
        await callback.answer("პროდუქტი ვერ მოიძებნა", show_alert=True)
        return

    await state.update_data(
        product_id=product_id,
        product_name=product["name"],
        oem_code=product.get("oem_code"),
        is_freeform=False,
    )
    await _goto_quantity(callback.message, state, wizard, product["name"], send=False)


async def _handle_new_product_name(
    message: Message, state: FSMContext, db: Database, wizard: str
) -> None:
    name = (message.text or "").strip()
    if not name:
        await message.answer(
            "⚠️ დასახელება ვერ იქნება ცარიელი. სცადე თავიდან:", parse_mode=_PARSE
        )
        return

    await state.update_data(product_name=name)
    d = await state.get_data()
    entered_oem: Optional[str] = d.get("entered_oem")

    # OEM-not-found path — create product with just name + OEM, then continue.
    if entered_oem:
        new_id = await db.create_product(name=name, oem_code=entered_oem)
        await state.update_data(product_id=new_id, is_freeform=False)
        await message.answer(
            f"✅ <b>{_e(name)}</b> ბაზაში დაემატა!\n"
            f"OEM: <code>{_e(entered_oem)}</code>",
            parse_mode=_PARSE,
        )
        await _goto_quantity(message, state, wizard, name, send=True)
        return

    # No OEM context (came from free-text search path) — ask for catalog price
    price_state = (
        SaleWizard.new_product_price
        if wizard == "sale"
        else NisiaWizard.new_product_price
    )
    await state.set_state(price_state)
    await message.answer(
        f"✅ <b>{_e(name)}</b>\n\n💰 შეიყვანეთ ნაწილის <b>ერთეულის ფასი</b> (₾):",
        parse_mode=_PARSE,
        reply_markup=_kb(_CANCEL_ROW),
    )


async def _handle_new_product_price(
    message: Message, state: FSMContext, db: Database, wizard: str
) -> None:
    try:
        price = float((message.text or "").strip().replace(",", "."))
        if price < 0:
            raise ValueError
    except ValueError:
        await message.answer(
            "⚠️ ჩაწერე სწორი ფასი, მაგ: <code>25.50</code>", parse_mode=_PARSE
        )
        return

    d = await state.get_data()
    name = d.get("product_name") or "უცნობი"
    oem = d.get("entered_oem")

    new_id = await db.create_product(name=name, oem_code=oem, price=price)
    await state.update_data(product_id=new_id, is_freeform=False)

    oem_line = f"\nOEM: <code>{_e(oem)}</code>" if oem else ""
    await message.answer(
        f"✅ <b>{_e(name)}</b> დაემატა ბაზაში!{oem_line}\nფასი: <b>{price:.2f} ₾</b>",
        parse_mode=_PARSE,
    )
    await _goto_quantity(message, state, wizard, name, send=True)


async def _goto_quantity(
    msg: Message, state: FSMContext, wizard: str, product_name: str, send: bool
) -> None:
    qty_state = SaleWizard.quantity if wizard == "sale" else NisiaWizard.quantity
    await state.set_state(qty_state)

    step = "3" if wizard == "nisia" else "2"
    text = f"✅ <b>{_e(product_name)}</b>\n\n📦 <b>ნაბიჯი {step}/5</b> — რამდენი ცალი?"
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
        await message.answer(
            "⚠️ ჩაწერე დადებითი მთელი რიცხვი, მაგ: <code>2</code>", parse_mode=_PARSE
        )
        return

    await state.update_data(quantity=qty)
    price_state = SaleWizard.price_type if wizard == "sale" else NisiaWizard.price_type
    await state.set_state(price_state)

    step = "4" if wizard == "nisia" else "3"
    await message.answer(
        f"🔢 <b>{qty} ცალი</b>\n\n💰 <b>ნაბიჯი {step}/5</b> — ფასი როგორ შეიყვანო?",
        parse_mode=_PARSE,
        reply_markup=_kb(
            [_btn("1️⃣ ერთეულის ფასი", "wiz:price:unit")],
            [_btn("Σ ჯამური თანხა", "wiz:price:total")],
            _CANCEL_ROW,
        ),
    )


async def _handle_price_type(
    callback: CallbackQuery, state: FSMContext, wizard: str
) -> None:
    if not isinstance(callback.message, Message):
        return
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
        raw = (
            (message.text or "")
            .strip()
            .replace(",", ".")
            .replace("₾", "")
            .replace("ლ", "")
        )
        value = float(raw)
        if value <= 0:
            raise ValueError
    except ValueError:
        await message.answer(
            "⚠️ ჩაწერე სწორი თანხა, მაგ: <code>35</code> ან <code>70.50</code>",
            parse_mode=_PARSE,
        )
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
                [_btn("💵 ხელზე", "wiz:pay:cash")],
                [_btn("🏦 დარიცხა", "wiz:pay:transfer")],
                [_btn("📋 ნისია", "wiz:pay:credit")],
                _CANCEL_ROW,
            ),
        )
    else:
        # Nisia — no payment step, ask seller type then confirm
        await state.update_data(payment="credit")
        await state.set_state(NisiaWizard.seller_type)
        await message.answer(
            "🏢 <b>ნაბიჯი 5/6</b> — ვისგან გაიყიდა?",
            parse_mode=_PARSE,
            reply_markup=_kb(
                [
                    _btn("🏢 შპს", "wiz:seller:company"),
                    _btn("👤 ფზ პირი", "wiz:seller:individual"),
                ],
                _CANCEL_ROW,
            ),
        )


async def _show_sale_confirm(msg: Message, state: FSMContext, edit: bool) -> None:
    d = await state.get_data()
    qty = d["quantity"]
    unit_price = d["unit_price"]
    payment = d["payment"]
    product = d["product_name"]
    seller = d.get("seller_type", "individual")
    buyer = d.get("buyer_type", "retail")
    is_vat_included = d.get("is_vat_included", False)
    vat_amount = d.get("vat_amount", 0.0)
    total = qty * unit_price
    pay_label = {
        "cash": "ხელზე 💵",
        "transfer": "დარიცხა 🏦",
        "credit": "ნისია 📋",
    }.get(payment, payment)
    seller_label = "🏢 შპს" if seller == "llc" else "👤 ფზ პირი"
    buyer_label = "🏭 მეწარმე" if buyer == "business" else "🛍 საცალო"
    vat_line = f"\n🧾 დღგ 18%: <b>{vat_amount:.2f}₾</b>" if is_vat_included else ""

    text = (
        f"✅ <b>ნაბიჯი 7/7 — გადამოწმება</b>\n\n"
        f"📦 პროდუქტი: <b>{_e(product)}</b>\n"
        f"🔢 რაოდ: {qty}ც × {unit_price:.2f}₾ = <b>{total:.2f}₾</b>\n"
        f"💳 გადახდა: {pay_label}\n"
        f"🏢 გამყიდველი: {seller_label}\n"
        f"🛒 მყიდველი: {buyer_label}"
        f"{vat_line}\n\n"
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
    qty = d["quantity"]
    unit_price = d["unit_price"]
    product = d["product_name"]
    customer = d["customer_name"]
    seller = d.get("seller_type", "individual")
    buyer = d.get("buyer_type", "retail")
    is_vat_included = d.get("is_vat_included", False)
    vat_amount = d.get("vat_amount", 0.0)
    total = qty * unit_price
    seller_label = "🏢 შპს" if seller == "llc" else "👤 ფზ პირი"
    buyer_label = "🏭 მეწარმე" if buyer == "business" else "🛍 საცალო"
    vat_line = f"\n🧾 დღგ 18%: <b>{vat_amount:.2f}₾</b>" if is_vat_included else ""

    text = (
        f"✅ <b>გადამოწმება</b>\n\n"
        f"👤 კლიენტი: <b>{_e(customer)}</b>\n"
        f"📦 პროდუქტი: <b>{_e(product)}</b>\n"
        f"🔢 რაოდ: {qty}ც × {unit_price:.2f}₾ = <b>{total:.2f}₾</b>\n"
        f"💳 ნისია 📋\n"
        f"🏢 გამყიდველი: {seller_label}\n"
        f"🛒 მყიდველი: {buyer_label}"
        f"{vat_line}\n\n"
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
    amount = d["amount"]
    cat_label = d.get("category_label", "")
    desc = d.get("description") or ""
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


# ═══════════════════════════════════════════════════════════════════════════════
# SALE RETURN WIZARD
# ═══════════════════════════════════════════════════════════════════════════════


@wizard_router.callback_query(F.data.startswith("ret:sale:"), IsAdmin())
async def sale_return_start(callback: CallbackQuery, db: Database) -> None:
    """Show the refund-method picker for a sale return."""
    if not isinstance(callback.message, Message):
        return
    try:
        sale_id = int(callback.data.split(":")[2])
    except (IndexError, ValueError):
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    sale = await db.get_sale(sale_id)
    if not sale:
        await callback.answer(f"⚠️ #{sale_id} ვერ მოიძებნა.", show_alert=True)
        return

    if sale.get("status") == "returned":
        await callback.answer("⚠️ ეს გაყიდვა უკვე დაბრუნებულია.", show_alert=True)
        return

    qty = sale["quantity"]
    price = float(sale["unit_price"])
    name = sale.get("product_name") or sale.get("notes") or f"#{sale_id}"

    text = (
        f"↩️ <b>გაყიდვის დაბრუნება #{sale_id}</b>\n\n"
        f"📦 {_e(name)}\n"
        f"🔢 {qty}ც × {price:.2f}₾ = <b>{qty * price:.2f}₾</b>\n\n"
        "რა ფორმით დაუბრუნეთ თანხა კლიენტს?"
    )
    kb = _kb(
        [
            _btn("💵 ხელზე", f"ret:c:{sale_id}:cash"),
            _btn("🏦 ბანკით", f"ret:c:{sale_id}:bank"),
        ],
        _CANCEL_ROW,
    )

    target_chat_id = _edit_target_chat(callback)
    if target_chat_id != callback.message.chat.id:
        await callback.bot.send_message(
            chat_id=target_chat_id,
            text=text,
            parse_mode=_PARSE,
            reply_markup=kb,
        )
        await callback.answer("↩️ დაბრუნება DM-ში")
    else:
        await callback.message.edit_text(text, parse_mode=_PARSE, reply_markup=kb)
        await callback.answer()


@wizard_router.callback_query(F.data.startswith("ret:c:"), IsAdmin())
async def sale_return_confirm(callback: CallbackQuery, db: Database) -> None:
    """Execute the return: restore stock, mark sale returned, notify admin."""
    if not isinstance(callback.message, Message):
        return
    try:
        parts = callback.data.split(":")  # ret:c:{sale_id}:{method}
        sale_id = int(parts[2])
        method = parts[3]  # cash | bank
    except (IndexError, ValueError):
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    if method not in ("cash", "bank"):
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    sale = await db.get_sale(sale_id)
    if not sale:
        await callback.answer(f"⚠️ #{sale_id} ვერ მოიძებნა.", show_alert=True)
        return

    if sale.get("status") == "returned":
        await callback.answer("⚠️ ეს გაყიდვა უკვე დაბრუნებულია.", show_alert=True)
        return

    product_id = sale.get("product_id")
    if not product_id:
        await callback.answer(
            "⚠️ ამ გაყიდვას პროდუქტი არ აქვს მიბმული — დაბრუნება ვერ მოხდება.",
            show_alert=True,
        )
        return

    qty = sale["quantity"]
    price = float(sale["unit_price"])
    refund = round(qty * price, 2)
    name = sale.get("product_name") or sale.get("notes") or f"#{sale_id}"

    refund_method_db = "cash" if method == "cash" else "transfer"
    _return_id, new_stock = await db.create_return(
        product_id=product_id,
        quantity=qty,
        refund_amount=refund,
        sale_id=sale_id,
        refund_method=refund_method_db,
        notes=f"დაბრუნება — გაყიდვა #{sale_id}",
    )

    topic_msg = sale.get("topic_message_id")
    if topic_msg:
        from bot.reports.formatter import format_topic_sale as _fmt_topic  # noqa: PLC0415

        try:
            original_text = _fmt_topic(
                product_name=name,
                qty=qty,
                price=price,
                payment=sale.get("payment_method", "cash"),
                sale_id=sale_id,
                customer_name=sale.get("customer_name"),
            )
        except Exception:
            original_text = f"გაყიდვა #{sale_id}"
        await mark_cancelled(callback.bot, config.GROUP_ID, topic_msg, original_text)

    from bot.reports.formatter import format_return_confirmation  # noqa: PLC0415

    confirmation = format_return_confirmation(
        product_name=name,
        qty=qty,
        refund=refund,
        new_stock=new_stock,
        refund_method=method,
    )

    await callback.message.edit_text(confirmation, parse_mode=_PARSE)
    await callback.answer(f"✅ #{sale_id} დაბრუნდა — {refund:.2f}₾")
