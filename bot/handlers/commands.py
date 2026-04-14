import asyncio
import hashlib
import html
import io
import logging
from typing import Optional

import openpyxl

from aiogram import Router
from aiogram.enums import ParseMode
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Document, InaccessibleMessage, InlineKeyboardButton, InlineKeyboardMarkup, Message

import config
from bot.handlers import IsAdmin, is_rate_limited
from bot.reports.formatter import (
    format_cash_on_hand,
    format_credit_sales_report,
    format_diagnostics_report,
    format_orders_report,
    format_stock_report,
    format_weekly_report,
)
from database.db import Database

logger = logging.getLogger(__name__)
commands_router = Router(name="commands")

_PARSE = ParseMode.HTML

_HELP_TEXT = """
🤝 <b>WishMotors ბოტი — გამოყენების სახელმძღვანელო</b>

━━━━━━━━━━━━━━━━━━━━━
📌 <b>გაყიდვის ფორმატი (Sales topic):</b>
<code>მარჭვენა რეფლექტორი 1ც 30₾ ხელზე</code>
<code>8390132500 2ც 45₾ დარიცხა</code>
<code>კოდი: 8390132500, 1ც, 35₾</code>
<code>სარკე 1ც 30₾</code> ← ცარიელი = ნისია

💳 <b>გადახდა:</b>
• <b>ხელზე</b> — ნაღდი ფული
• <b>დარიცხა</b> — გადარიცხვა (ასევე: გადარიცხვა, ბარათი, კარტი)
• <i>(ცარიელი)</i> — ნისია (გახსოვდეს დარეკვა!)

🏢 <b>გამყიდველი:</b>
• <code>შპსდან</code> ან <code>შპს-დან</code> — შპს-ით გაყიდვა
• <i>(ცარიელი)</i> — ფიზიკური პირი (ფზ)

👤 <b>კლიენტის სახელი (სურვილისამებრ):</b>
<code>სარკე 1ც 30₾ გიო</code>
<code>სარკე 1ც 30₾ ხელზე გიო</code>
<code>სარკე 1ც 30₾ ხელზე შპსდან გიო</code>

↩️ <b>დაბრუნება (Sales topic):</b>
<code>დაბრუნება 8390132500 1ც 45₾</code>

📋 <b>შეკვეთა (Orders topic):</b>
<code>8390132500 5ც</code>  |  <code>მარჭვენა სარკე 3ც</code>

🧾 <b>ხარჯი (Expenses topic):</b>
<code>50₾ ბენზინი</code>  |  <code>ბენზინი 50₾</code>  |  <code>-20ლ საბაჟო</code>

📂 <b>Excel ატვირთვა (Capital topic):</b>
სვეტები: <b>სახელი | OEM | მარაგი | ფასი</b>

━━━━━━━━━━━━━━━━━━━━━
📊 <b>ანგარიშები:</b>
/report — კვირის ანგარიში (DM + ჯგუფი)
/report_period — პერიოდის ანგარიში (კალენდარი)

🏪 <b>საწყობი:</b>
/stock — საწყობის მდგომარეობა
/addproduct — პროდუქტის დამატება
/editproduct ID ველი მნიშვნელობა — რედაქტირება
  ველები: <code>name</code> | <code>oem</code> | <code>price</code> | <code>minstock</code>

📋 <b>შეკვეთები:</b>
/orders — მომლოდინე შეკვეთები (ავტო: 0 მარაგი)
/completeorder ID — შეკვეთის დახურვა

💳 <b>ნისია:</b>
/nisias — სია + ღილაკები გადახდისთვის
/paid ID ხელზე — ნისიის გადახდა ნაღდით
/paid ID დარიცხა — ნისიის გადახდა გადარიცხვით

🗑 <b>გასწორება:</b>
/deletesale ID — გაყიდვის წაშლა + მარაგის აღდგენა

🔧 <b>სისტემა:</b>
/diagnostics — ვერ ამოცნობილი შეტყობინებები
/help — ეს სახელმძღვანელო
""".strip()


@commands_router.message(Command("help"), IsAdmin())
async def cmd_help(message: Message) -> None:
    await message.bot.send_message(chat_id=message.from_user.id, text=_HELP_TEXT, parse_mode=_PARSE)


@commands_router.message(Command("stock"), IsAdmin())
async def cmd_stock(message: Message, db: Database) -> None:
    products = await db.get_all_products()
    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=format_stock_report(products),
        parse_mode=_PARSE,
    )


@commands_router.message(Command("report"), IsAdmin())
async def cmd_report(message: Message, db: Database) -> None:
    if message.from_user and is_rate_limited(message.from_user.id, "report", min_interval=10.0):
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text="⏳ ძალიან სწრაფად. 10 წამი დაიცადე.",
        )
        return
    await message.bot.send_message(
        chat_id=message.from_user.id,
        text="⏳ ანგარიში მუშავდება...",
        parse_mode=_PARSE,
    )

    sales, returns, expenses, products, cash = await asyncio.gather(
        db.get_weekly_sales(),
        db.get_weekly_returns(),
        db.get_weekly_expenses(),
        db.get_all_products(),
        db.get_cash_on_hand(),
    )

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=format_weekly_report(sales, returns, expenses, products, cash),
        parse_mode=_PARSE,
    )


@commands_router.message(Command("cash"), IsAdmin())
async def cmd_cash(message: Message, db: Database) -> None:
    """Show current cash-on-hand balance."""
    data = await db.get_cash_on_hand()
    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=format_cash_on_hand(data),
        parse_mode=_PARSE,
    )


class DepositState(StatesGroup):
    waiting_amount = State()


@commands_router.message(Command("deposit"), IsAdmin())
async def cmd_deposit(message: Message, state: FSMContext) -> None:
    """Start deposit wizard — ask for amount."""
    await state.set_state(DepositState.waiting_amount)
    await message.bot.send_message(
        chat_id=message.from_user.id,
        text="🏦 <b>ბანკში შეტანა</b>\n\nრამდენი შეიტანე? (მაგ: <code>500</code>)",
        parse_mode=_PARSE,
    )


@commands_router.message(StateFilter(DepositState.waiting_amount), IsAdmin())
async def deposit_amount_input(message: Message, state: FSMContext, db: Database) -> None:
    """Handle the amount entered by the user."""
    raw = (message.text or "").strip().replace(",", ".").replace("₾", "").replace("ლ", "")
    try:
        amount = float(raw)
        if amount <= 0:
            raise ValueError
    except ValueError:
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text="⚠️ სწორი თანხა ჩაწერე, მაგ: <code>500</code>",
            parse_mode=_PARSE,
        )
        return

    await state.clear()
    deposit_id = await db.create_cash_deposit(amount)
    cash = await db.get_cash_on_hand()
    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=(
            f"✅ <b>ბანკში შეტანა #{deposit_id} დაფიქსირდა</b>\n"
            f"💰 <b>{amount:.2f}₾</b>\n\n"
            f"💼 დარჩენილი ხელზე: <b>{cash['balance']:.2f}₾</b>"
        ),
        parse_mode=_PARSE,
    )


@commands_router.message(Command("orders"), IsAdmin())
async def cmd_orders(message: Message, db: Database) -> None:
    orders = await db.get_pending_orders()
    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=format_orders_report(orders),
        parse_mode=_PARSE,
    )


_NISIAS_KEYBOARD_MAX = 30  # max rows safety margin (2 rows per named customer)


class NisiasStates(StatesGroup):
    waiting_partial_amount = State()
    waiting_rename_customer = State()


def _customer_key(name: str) -> str:
    """8-char deterministic hash of a customer name for use in callback_data."""
    return hashlib.md5(name.encode()).hexdigest()[:8]


def _nisias_keyboard(sales: list) -> InlineKeyboardMarkup:
    """Build inline keyboard grouped by customer name.

    Named customers get two rows each:
      Row 1: [💵 სრულად ხელზე] [🏦 სრულად დარიცხა]
      Row 2: [💸 ნაწილობრივ — name]
    Unnamed sales retain the old per-sale two-button row.
    Capped at _NISIAS_KEYBOARD_MAX rows total.
    """
    named: dict = {}
    unnamed: list = []
    for s in sales:
        cname = s.get("customer_name")
        if cname:
            named.setdefault(cname, [])
        else:
            unnamed.append(s)

    rows = []

    for cname in named:
        label = (cname[:10] + "…") if len(cname) > 11 else cname
        key = _customer_key(cname)
        rows.append([
            InlineKeyboardButton(text=f"✅ სრულად — {label}", callback_data=f"npc:{key}:cash"),
            InlineKeyboardButton(text=f"💸 ნაწილობრივ — {label}", callback_data=f"npp:{key}"),
            InlineKeyboardButton(text="✏️", callback_data=f"npr:{key}"),
        ])

    # Per-sale rows for unnamed sales (no grouping possible)
    for s in unnamed:
        sale_id = s["id"]
        rows.append([
            InlineKeyboardButton(text=f"💵 ხელზე #{sale_id}",  callback_data=f"np:{sale_id}:cash"),
            InlineKeyboardButton(text=f"🏦 დარიცხა #{sale_id}", callback_data=f"np:{sale_id}:transfer"),
        ])

    if len(rows) > _NISIAS_KEYBOARD_MAX:
        rows = rows[:_NISIAS_KEYBOARD_MAX]
        rows.append([
            InlineKeyboardButton(text="... კიდევ მეტი ნისია", callback_data="np:0:ignore")
        ])

    return InlineKeyboardMarkup(inline_keyboard=rows)


@commands_router.message(Command("nisias"), IsAdmin())
async def cmd_nisias(message: Message, state: FSMContext, db: Database) -> None:
    """Show all unpaid credit sales with inline pay buttons."""
    await state.clear()  # cancel any in-progress partial payment entry
    sales = await db.get_credit_sales()
    text = format_credit_sales_report(sales)
    keyboard = _nisias_keyboard(sales) if sales else None
    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=text,
        parse_mode=_PARSE,
        reply_markup=keyboard,
    )


@commands_router.callback_query(lambda c: c.data and c.data.startswith("npc:"), IsAdmin())
async def callback_nisias_pay_customer(callback: CallbackQuery, db: Database) -> None:
    """Handle customer-level nisias pay: npc:{customer_hash}:{cash|transfer}
    Marks ALL unpaid credit sales for that customer as paid in one action."""
    try:
        _, customer_hash, method = (callback.data or "").split(":")
        label = "ხელზე 💵" if method == "cash" else "დარიცხა 🏦"
    except (ValueError, AttributeError):
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    # Resolve customer name from hash against current unpaid sales
    all_sales = await db.get_credit_sales()
    target_customer: Optional[str] = None
    for s in all_sales:
        cname = s.get("customer_name")
        if cname and _customer_key(cname) == customer_hash:
            target_customer = cname
            break

    if not target_customer:
        await callback.answer("⚠️ კლიენტი ვერ მოიძებნა ან ნისია უკვე გადახდილია.", show_alert=True)
        return

    count = await db.mark_customer_sales_paid(target_customer, method)
    if count > 0:
        logger.info(
            "AUDIT: admin %d marked %d credit sale(s) for '%s' as paid (%s)",
            callback.from_user.id, count, target_customer, method,
        )
        await callback.answer(f"✅ {target_customer} — {label} ({count} ნისია)", show_alert=False)
    else:
        await callback.answer(
            f"⚠️ {target_customer} — ნისია ვერ მოიძებნა ან უკვე გადახდილია.", show_alert=True
        )
        return

    # Refresh the nisias list
    sales = await db.get_credit_sales()
    text = format_credit_sales_report(sales)
    keyboard = _nisias_keyboard(sales) if sales else None
    if isinstance(callback.message, InaccessibleMessage):
        return
    try:
        await callback.message.edit_text(text, parse_mode=_PARSE, reply_markup=keyboard)
    except Exception as exc:
        logger.debug("Could not refresh nisias message after customer payment: %s", exc)


@commands_router.callback_query(lambda c: c.data and c.data.startswith("npp:"), IsAdmin())
async def callback_nisias_partial(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    """Start partial payment flow: npp:{customer_hash}
    Saves the customer name in FSM state and asks for the amount."""
    try:
        _, customer_hash = (callback.data or "").split(":", 1)
    except ValueError:
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    # Resolve customer name and current debt
    all_sales = await db.get_credit_sales()
    target_customer: Optional[str] = None
    customer_debt = 0.0
    for s in all_sales:
        cname = s.get("customer_name")
        if cname and _customer_key(cname) == customer_hash:
            if target_customer is None:
                target_customer = cname
            customer_debt += float(s["unit_price"]) * s["quantity"]

    if not target_customer:
        await callback.answer("⚠️ კლიენტი ვერ მოიძებნა ან ნისია უკვე გადახდილია.", show_alert=True)
        return

    await state.set_state(NisiasStates.waiting_partial_amount)
    await state.update_data(customer_name=target_customer)
    await callback.answer()

    if isinstance(callback.message, InaccessibleMessage):
        return
    await callback.message.reply(
        f"💸 <b>{html.escape(target_customer)}</b>\n"
        f"მიმდინარე ვალი: <b>{customer_debt:.2f}₾</b>\n\n"
        f"რამდენი გადაიხადა? <i>(₾)</i>\n"
        f"<i>მაგ: <code>150</code> ან <code>75.50</code></i>",
        parse_mode=_PARSE,
    )


@commands_router.callback_query(lambda c: c.data and c.data.startswith("npr:"), IsAdmin())
async def callback_nisias_rename(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    """Start customer rename flow: npr:{customer_hash}"""
    try:
        _, customer_hash = (callback.data or "").split(":", 1)
    except ValueError:
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    all_sales = await db.get_credit_sales()
    target_customer: Optional[str] = None
    for s in all_sales:
        cname = s.get("customer_name")
        if cname and _customer_key(cname) == customer_hash:
            target_customer = cname
            break

    if not target_customer:
        await callback.answer("⚠️ კლიენტი ვერ მოიძებნა.", show_alert=True)
        return

    await state.set_state(NisiasStates.waiting_rename_customer)
    await state.update_data(old_customer_name=target_customer)
    await callback.answer()

    if isinstance(callback.message, InaccessibleMessage):
        return
    await callback.message.reply(
        f"✏️ <b>{html.escape(target_customer)}</b>\n\n"
        f"ახალი სახელი ან ტელ. ნომერი მიწერე:",
        parse_mode=_PARSE,
    )


@commands_router.message(NisiasStates.waiting_rename_customer, IsAdmin())
async def handle_rename_customer(message: Message, state: FSMContext, db: Database) -> None:
    """Receive new customer name and update all their credit sales."""
    new_name = (message.text or "").strip()
    if not new_name:
        await message.reply("❌ სახელი ცარიელია. სცადე ხელახლა.")
        return

    data = await state.get_data()
    old_name: str = data.get("old_customer_name", "")
    await state.clear()

    updated = await db.rename_customer(old_name, new_name)
    logger.info(
        "AUDIT: admin %d renamed customer %r → %r (%d sales)",
        message.from_user.id, old_name, new_name, updated,
    )

    await message.reply(
        f"✅ <b>{html.escape(old_name)}</b> → <b>{html.escape(new_name)}</b>\n"
        f"განახლდა: {updated} ჩანაწერი",
        parse_mode=_PARSE,
    )

    sales = await db.get_credit_sales()
    text = format_credit_sales_report(sales)
    keyboard = _nisias_keyboard(sales) if sales else None
    await message.answer(text, parse_mode=_PARSE, reply_markup=keyboard)


@commands_router.message(NisiasStates.waiting_partial_amount, IsAdmin())
async def handle_partial_payment_amount(message: Message, state: FSMContext, db: Database) -> None:
    """Receive the amount for partial payment and apply it."""
    data = await state.get_data()
    customer_name: str = data.get("customer_name", "")

    raw = (message.text or "").strip().replace(",", ".").replace("₾", "").replace("ლ", "").strip()
    try:
        amount = float(raw)
        if amount <= 0:
            raise ValueError("non-positive")
    except ValueError:
        await message.reply(
            "❌ შეიყვანეთ სწორი თანხა. მაგ: <code>150</code> ან <code>75.50</code>",
            parse_mode=_PARSE,
        )
        return  # stay in state — wait for a valid number

    remaining = await db.apply_partial_payment(customer_name, amount)
    await state.clear()

    logger.info(
        "AUDIT: admin %d applied partial payment %.2f₾ for '%s', remaining=%.2f₾",
        message.from_user.id, amount, customer_name, remaining,
    )

    if remaining <= 0.005:
        result_text = f"✅ <b>{html.escape(customer_name)}</b> — სრულად გადახდილია!"
    else:
        result_text = (
            f"✅ <b>{html.escape(customer_name)}</b>\n"
            f"💸 გადახდა: <b>{amount:.2f}₾</b>\n"
            f"💳 დარჩა: <b>{remaining:.2f}₾</b>"
        )

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=result_text,
        parse_mode=_PARSE,
    )

    # Refresh full nisias list
    sales = await db.get_credit_sales()
    updated_text = format_credit_sales_report(sales)
    keyboard = _nisias_keyboard(sales) if sales else None
    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=updated_text,
        parse_mode=_PARSE,
        reply_markup=keyboard,
    )


@commands_router.callback_query(lambda c: c.data and c.data.startswith("np:"), IsAdmin())
async def callback_nisias_pay(callback: CallbackQuery, db: Database) -> None:
    """Handle nisias inline pay button: np:{sale_id}:{cash|transfer}"""
    try:
        _, sale_id_str, method = (callback.data or "").split(":")
        sale_id = int(sale_id_str)
        if sale_id == 0:  # "overflow" indicator button
            await callback.answer()
            return
        payment_method = method  # "cash" or "transfer"
        label = "ხელზე 💵" if method == "cash" else "დარიცხა 🏦"
    except (ValueError, AttributeError):
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    updated = await db.mark_sale_paid(sale_id, payment_method)
    if updated:
        logger.info(
            "AUDIT: admin %d marked sale #%d as paid (%s)",
            callback.from_user.id, sale_id, payment_method,
        )
        await callback.answer(f"✅ #{sale_id} — {label}", show_alert=False)
        # Refresh the list
        sales = await db.get_credit_sales()
        text = format_credit_sales_report(sales)
        keyboard = _nisias_keyboard(sales) if sales else None
        if isinstance(callback.message, InaccessibleMessage):
            return
        try:
            await callback.message.edit_text(text, parse_mode=_PARSE, reply_markup=keyboard)
        except Exception as exc:
            logger.debug("Could not refresh nisias message (likely unchanged): %s", exc)
    else:
        await callback.answer(f"⚠️ #{sale_id} ვერ მოიძებნა ან უკვე გადახდილია.", show_alert=True)


@commands_router.callback_query(lambda c: c.data and c.data.startswith("ds:"), IsAdmin())
async def callback_delete_sale(callback: CallbackQuery, db: Database) -> None:
    """Delete a sale: soft-deletes to deleted_sales (24h restore window), removes topic message."""
    try:
        sale_id = int((callback.data or "").split(":")[1])
    except (IndexError, ValueError):
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    deleted = await db.soft_delete_sale(sale_id)
    if not deleted:
        await callback.answer(f"⚠️ #{sale_id} ვერ მოიძებნა ან უკვე წაშლილია.", show_alert=True)
        return

    logger.info(
        "AUDIT: admin %d deleted sale #%d (product_id=%s, qty=%s, price=%s)",
        callback.from_user.id, sale_id,
        deleted.get("product_id"), deleted.get("quantity"), deleted.get("unit_price"),
    )

    # Delete the topic message if we know where it was posted
    topic_id  = deleted.get("topic_id")
    topic_msg = deleted.get("topic_message_id")
    if topic_id and topic_msg:
        try:
            await callback.bot.delete_message(
                chat_id=config.GROUP_ID, message_id=topic_msg
            )
        except Exception as exc:
            logger.debug("Could not delete topic message for sale #%d: %s", sale_id, exc)

    total = float(deleted["unit_price"]) * deleted["quantity"]
    deleted_id = deleted["deleted_id"]

    await callback.answer(f"🗑 #{sale_id} წაიშალა — {total:.2f}₾", show_alert=False)

    if isinstance(callback.message, InaccessibleMessage):
        return
    try:
        restore_kb = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="↩️ აღდგენა (24სთ)", callback_data=f"rs:{deleted_id}")
        ]])
        await callback.message.edit_text(
            f"🗑 <b>გაყიდვა #{sale_id} წაიშალა</b>\n"
            f"💰 {deleted['quantity']}ც × {float(deleted['unit_price']):.2f}₾ = <b>{total:.2f}₾</b>\n"
            "<i>24 საათის განმავლობაში შეგიძლია აღადგინო.</i>",
            parse_mode=_PARSE,
            reply_markup=restore_kb,
        )
    except Exception as exc:
        logger.debug("Could not update message after sale deletion: %s", exc)


@commands_router.callback_query(lambda c: c.data and c.data.startswith("rs:"), IsAdmin())
async def callback_restore_sale(callback: CallbackQuery, db: Database) -> None:
    """Restore a soft-deleted sale within 24h: rs:{deleted_id}"""
    try:
        deleted_id = int((callback.data or "").split(":")[1])
    except (IndexError, ValueError):
        await callback.answer("❌ შეცდომა", show_alert=True)
        return

    ds = await db.get_deleted_sale(deleted_id)
    if not ds:
        await callback.answer("⚠️ ვადა გავიდა ან ჩანაწერი ვერ მოიძებნა.", show_alert=True)
        return

    new_sale_id = await db.restore_deleted_sale(deleted_id)
    if not new_sale_id:
        await callback.answer("⚠️ 24 საათი გავიდა — აღდგენა შეუძლებელია.", show_alert=True)
        return

    logger.info(
        "AUDIT: admin %d restored deleted sale (original #%d → new #%d)",
        callback.from_user.id, ds.get("original_sale_id", "?"), new_sale_id,
    )

    # Re-post to topic
    topic_id  = ds.get("topic_id")
    new_topic_msg_id: Optional[int] = None
    if topic_id:
        try:
            from bot.reports.formatter import format_topic_sale, format_topic_nisia
            product_name = ds.get("notes") or f"გაყიდვა #{new_sale_id}"
            is_nisia = ds.get("payment_method") == "credit"
            customer = ds.get("customer_name")

            if is_nisia and customer:
                text = format_topic_nisia(
                    customer_name=customer,
                    product_name=product_name,
                    qty=ds["quantity"],
                    price=float(ds["unit_price"]),
                    sale_id=new_sale_id,
                )
            else:
                text = format_topic_sale(
                    product_name=product_name,
                    qty=ds["quantity"],
                    price=float(ds["unit_price"]),
                    payment=ds["payment_method"],
                    sale_id=new_sale_id,
                    customer_name=customer,
                )
            r = await callback.bot.send_message(
                chat_id=config.GROUP_ID,
                message_thread_id=topic_id,
                text=text,
                parse_mode=_PARSE,
            )
            new_topic_msg_id = r.message_id
        except Exception as exc:
            logger.warning("Could not re-post restored sale to topic: %s", exc)

    if new_topic_msg_id:
        await db.update_sale_topic_message(new_sale_id, topic_id, new_topic_msg_id)

    total = ds["quantity"] * float(ds["unit_price"])
    await callback.answer(f"✅ #{new_sale_id} აღდგენილია", show_alert=False)

    if isinstance(callback.message, InaccessibleMessage):
        return
    try:
        await callback.message.edit_text(
            f"✅ <b>გაყიდვა #{new_sale_id} აღდგენილია</b>\n"
            f"💰 {ds['quantity']}ც × {float(ds['unit_price']):.2f}₾ = <b>{total:.2f}₾</b>",
            parse_mode=_PARSE,
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(text=f"🗑 წაშლა #{new_sale_id}", callback_data=f"ds:{new_sale_id}")
            ]]),
        )
    except Exception as exc:
        logger.debug("Could not update message after restore: %s", exc)


@commands_router.message(Command("paid"), IsAdmin())
async def cmd_paid(message: Message, db: Database) -> None:
    """Mark a credit sale as paid. Usage: /paid ID ხელზე  or  /paid ID დარიცხა"""
    if message.from_user and is_rate_limited(message.from_user.id, "paid"):
        await message.bot.send_message(  # type: ignore[union-attr]
            chat_id=message.from_user.id,
            text="⏳ ძალიან სწრაფად. 2 წამი დაიცადე.",
        )
        return
    parts = (message.text or "").split()
    if len(parts) < 3 or not parts[1].isdigit():
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=(
                "❌ ფორმატი:\n"
                "<code>/paid ID ხელზე</code>\n"
                "<code>/paid ID დარიცხა</code>\n\n"
                "ID-ს ნახვა: /nisias"
            ),
            parse_mode=_PARSE,
        )
        return

    sale_id = int(parts[1])
    payment_word = parts[2].lower()

    if any(k in payment_word for k in ("ხელ", "ნაღ", "ქეშ")):
        payment_method = "cash"
        label = "ხელზე 💵"
    elif any(k in payment_word for k in ("დარ", "გადარ", "ბარათ", "კარტ", "transfer")):
        payment_method = "transfer"
        label = "დარიცხა 🏦"
    else:
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text="❌ გადახდის მეთოდი არ ვიცი. გამოიყენეთ: <code>ხელზე</code> ან <code>დარიცხა</code>",
            parse_mode=_PARSE,
        )
        return

    updated = await db.mark_sale_paid(sale_id, payment_method)
    if updated:
        logger.info(
            "AUDIT: admin %d marked sale #%d as paid (%s) via /paid command",
            message.from_user.id, sale_id, payment_method,
        )
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=f"✅ ნისია <b>#{sale_id}</b> გადახდილია — {label}",
            parse_mode=_PARSE,
        )
    else:
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=f"⚠️ გაყიდვა #{sale_id} ვერ მოიძებნა ან უკვე გადახდილია.",
            parse_mode=_PARSE,
        )


@commands_router.message(Command("diagnostics"), IsAdmin())
async def cmd_diagnostics(message: Message, db: Database) -> None:
    """Show parse failure statistics."""
    if message.from_user and is_rate_limited(message.from_user.id, "diagnostics", min_interval=10.0):
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text="⏳ ძალიან სწრაფად. 10 წამი დაიცადე.",
        )
        return
    failures, total_7d, total_30d = await asyncio.gather(
        db.get_parse_failure_stats(days=30),
        db.get_parse_failure_count(days=7),
        db.get_parse_failure_count(days=30),
    )

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=format_diagnostics_report(failures, total_7d, total_30d),
        parse_mode=_PARSE,
    )


@commands_router.message(Command("deletesale"), IsAdmin())
async def cmd_deletesale(message: Message, db: Database) -> None:
    """Delete a sale by ID and restore stock. Usage: /deletesale ID"""
    if message.from_user and is_rate_limited(message.from_user.id, "deletesale"):
        await message.bot.send_message(  # type: ignore[union-attr]
            chat_id=message.from_user.id,
            text="⏳ ძალიან სწრაფად. 2 წამი დაიცადე.",
        )
        return
    parts = (message.text or "").split()
    if len(parts) < 2 or not parts[1].isdigit():
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=(
                "❌ ფორმატი:\n"
                "<code>/deletesale ID</code>\n\n"
                "ID-ს ნახვა: /nisias ან ანგარიშში"
            ),
            parse_mode=_PARSE,
        )
        return

    sale_id = int(parts[1])
    deleted = await db.delete_sale(sale_id)

    if deleted:
        logger.info(
            "AUDIT: admin %d deleted sale #%d (product_id=%s, qty=%s, price=%s)",
            message.from_user.id,
            sale_id,
            deleted.get("product_id"),
            deleted.get("quantity"),
            deleted.get("unit_price"),
        )

    if not deleted:
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=f"⚠️ გაყიდვა #{sale_id} ვერ მოიძებნა.",
            parse_mode=_PARSE,
        )
        return

    product_note = ""
    if deleted.get("product_id"):
        product_note = f"\n📊 მარაგი აღდგა +{deleted['quantity']}ც"

    name = deleted.get("notes") or f"ID {deleted.get('product_id', '—')}"
    total = float(deleted["unit_price"]) * deleted["quantity"]

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=(
            f"🗑 <b>გაყიდვა #{sale_id} წაიშალა</b>\n"
            f"📦 {html.escape(name)}\n"
            f"💰 {deleted['quantity']}ც × {float(deleted['unit_price']):.2f}₾ = {total:.2f}₾"
            f"{product_note}"
        ),
        parse_mode=_PARSE,
    )


@commands_router.message(Command("editproduct"), IsAdmin())
async def cmd_editproduct(message: Message, db: Database) -> None:
    """Edit a product field. Usage: /editproduct ID field value
    Fields: name | oem | price | minstock"""
    if message.from_user and is_rate_limited(message.from_user.id, "editproduct"):
        await message.bot.send_message(  # type: ignore[union-attr]
            chat_id=message.from_user.id,
            text="⏳ ძალიან სწრაფად. 2 წამი დაიცადე.",
        )
        return
    parts = (message.text or "").split(None, 3)  # max 4 parts
    if len(parts) < 4 or not parts[1].isdigit():
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=(
                "❌ <b>ფორმატი:</b>\n"
                "<code>/editproduct ID ველი მნიშვნელობა</code>\n\n"
                "<b>ველები:</b>\n"
                "• <code>name</code> — სახელი\n"
                "• <code>oem</code> — OEM კოდი\n"
                "• <code>price</code> — ფასი (₾)\n"
                "• <code>minstock</code> — მინ. მარაგი\n\n"
                "<b>მაგალითები:</b>\n"
                "<code>/editproduct 3 price 45.50</code>\n"
                "<code>/editproduct 3 name მარჯვენა სარკე</code>"
            ),
            parse_mode=_PARSE,
        )
        return

    product_id = int(parts[1])
    field = parts[2].lower().strip()
    value_str = parts[3].strip()

    product = await db.get_product_by_id(product_id)
    if not product:
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=f"⚠️ პროდუქტი #{product_id} ვერ მოიძებნა.",
            parse_mode=_PARSE,
        )
        return

    kwargs: dict = {}
    field_label = ""
    try:
        if field == "name":
            kwargs["name"] = value_str
            field_label = f"სახელი → <b>{html.escape(value_str)}</b>"
        elif field == "oem":
            kwargs["oem_code"] = value_str
            field_label = f"OEM → <b>{html.escape(value_str)}</b>"
        elif field == "price":
            kwargs["price"] = float(value_str.replace(",", "."))
            field_label = f"ფასი → <b>{kwargs['price']:.2f}₾</b>"
        elif field == "minstock":
            kwargs["min_stock"] = int(value_str)
            field_label = f"მინ. მარაგი → <b>{kwargs['min_stock']}ც</b>"
        else:
            await message.bot.send_message(
                chat_id=message.from_user.id,
                text="❌ უცნობი ველი. გამოიყენეთ: <code>name</code>, <code>oem</code>, <code>price</code>, <code>minstock</code>",
                parse_mode=_PARSE,
            )
            return
    except ValueError:
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text="❌ მნიშვნელობა არასწორია. შეამოწმეთ ფორმატი.",
            parse_mode=_PARSE,
        )
        return

    updated = await db.edit_product(product_id, **kwargs)
    if updated:
        logger.info(
            "AUDIT: admin %d edited product #%d — %s",
            message.from_user.id, product_id, kwargs,
        )
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=(
                f"✅ <b>პროდუქტი განახლდა</b>\n"
                f"📦 {html.escape(updated['name'])}\n"
                f"🆔 #{product_id}\n"
                f"✏️ {field_label}"
            ),
            parse_mode=_PARSE,
        )
    else:
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text="⚠️ განახლება ვერ მოხდა.",
            parse_mode=_PARSE,
        )


@commands_router.message(Command("completeorder"), IsAdmin())
async def cmd_complete_order(message: Message, db: Database) -> None:
    if message.from_user and is_rate_limited(message.from_user.id, "completeorder"):
        await message.bot.send_message(  # type: ignore[union-attr]
            chat_id=message.from_user.id,
            text="⏳ ძალიან სწრაფად. 2 წამი დაიცადე.",
        )
        return
    parts = (message.text or "").split()
    if len(parts) < 2 or not parts[1].isdigit():
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text="❌ მიუთითეთ შეკვეთის ID.\nმაგალითი: <code>/completeorder 5</code>",
            parse_mode=_PARSE,
        )
        return

    order_id = int(parts[1])
    done = await db.complete_order(order_id)

    if done:
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=f"✅ შეკვეთა #{order_id} დახურულია.",
            parse_mode=_PARSE,
        )
    else:
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=f"⚠️ შეკვეთა #{order_id} ვერ მოიძებნა ან უკვე დახურულია.",
            parse_mode=_PARSE,
        )


@commands_router.message(Command("addproduct"), IsAdmin())
async def cmd_addproduct(message: Message, db: Database) -> None:
    args = (message.text or "").split()[1:]

    if len(args) < 4:
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=(
                "❌ <b>არასწორი ფორმატი.</b>\n\n"
                "გამოიყენეთ:\n"
                "<code>/addproduct სახელი OEM_კოდი მარაგი ფასი</code>\n\n"
                "მაგალითი:\n"
                "<code>/addproduct მარჭვენა_რეფლექტორი 8390132500 50 30.00</code>\n\n"
                "სახელში _ სფეისის ნაცვლად."
            ),
            parse_mode=_PARSE,
        )
        return

    try:
        price = float(args[-1])
        stock = int(args[-2])
        oem = args[-3] if args[-3] != "-" else None
        name = " ".join(args[:-3]).replace("_", " ").strip()

        if not name:
            raise ValueError("empty name")
        if price < 0:
            raise ValueError("negative price")
        if stock < 0:
            raise ValueError("negative stock")
    except (ValueError, IndexError):
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text="❌ შეამოწმეთ ფორმატი. <b>მარაგი</b> მთელი რიცხვია, <b>ფასი</b> — ათობითი, ორივე 0 ან მეტი.",
            parse_mode=_PARSE,
        )
        return

    existing = await db.get_product_by_oem(oem) if oem else None
    if not existing:
        existing = await db.get_product_by_name(name)

    if existing:
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=(
                f"⚠️ პროდუქტი უკვე არსებობს: <b>{existing['name']}</b> (ID: {existing['id']})\n"
                f"მარაგის განახლებისთვის გამოიყენეთ Excel ატვირთვა Capital topic-ში."
            ),
            parse_mode=_PARSE,
        )
        return

    product_id = await db.create_product(
        name=name,
        oem_code=oem,
        stock=stock,
        min_stock=config.MIN_STOCK_THRESHOLD,
        price=price,
    )

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=(
            f"✅ <b>პროდუქტი დამატებულია!</b>\n"
            f"📦 სახელი: {html.escape(name)}\n"
            f"🔑 OEM: {html.escape(oem) if oem else '—'}\n"
            f"📊 საწყობი: {stock}ც\n"
            f"💰 ფასი: {price:.2f}₾\n"
            f"🆔 ID: {product_id}"
        ),
        parse_mode=_PARSE,
    )


# ─── /import — Excel product import ──────────────────────────────────────────

class ImportState(StatesGroup):
    waiting_file = State()


@commands_router.message(Command("import"), IsAdmin())
async def cmd_import(message: Message, state: FSMContext) -> None:
    """Start Excel import wizard."""
    await state.set_state(ImportState.waiting_file)
    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=(
            "📂 <b>Excel-ის იმპორტი</b>\n\n"
            "გამოაგზავნე <b>.xlsx</b> ფაილი სვეტებით:\n"
            "<code>OEM კოდი | დასახელება | რაოდენობა | ერთ. ზომა</code>\n\n"
            "პირველი სტრიქონი — სათაური (გამოტოვდება)."
        ),
        parse_mode=_PARSE,
    )


@commands_router.message(StateFilter(ImportState.waiting_file), IsAdmin())
async def import_file_received(message: Message, state: FSMContext, db: "Database") -> None:
    """Handle the uploaded Excel file."""
    doc: Optional[Document] = message.document
    if not doc or not (doc.file_name or "").lower().endswith(".xlsx"):
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text="⚠️ გამოაგზავნე <b>.xlsx</b> ფაილი.",
            parse_mode=_PARSE,
        )
        return

    await state.clear()
    status_msg = await message.bot.send_message(
        chat_id=message.from_user.id,
        text="⏳ ვამუშავებ ფაილს...",
        parse_mode=_PARSE,
    )

    # Download file bytes
    file = await message.bot.get_file(doc.file_id)
    buf = io.BytesIO()
    await message.bot.download_file(file.file_path, destination=buf)
    buf.seek(0)

    # Parse Excel
    try:
        wb = openpyxl.load_workbook(buf, read_only=True, data_only=True)
        ws = wb.active
        rows_data = []
        skipped = 0
        for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True)):
            oem_raw, name_raw, qty_raw, unit_raw = (row[0], row[1], row[2], row[3]) if len(row) >= 4 else (None, None, None, None)
            name = str(name_raw).strip() if name_raw else ""
            if not name:
                skipped += 1
                continue
            try:
                qty = int(float(str(qty_raw).replace(",", "."))) if qty_raw is not None else 0
            except (ValueError, TypeError):
                qty = 0
            rows_data.append({
                "oem_code": str(oem_raw).strip() if oem_raw else None,
                "name": name,
                "current_stock": qty,
                "unit": str(unit_raw).strip() if unit_raw else "ც",
            })
        wb.close()
    except Exception as e:
        await status_msg.edit_text(
            f"❌ ფაილი ვერ წავიკითხე: {html.escape(str(e))}",
            parse_mode=_PARSE,
        )
        return

    if not rows_data:
        await status_msg.edit_text("⚠️ ფაილი ცარიელია ან ყველა სტრიქონი გამოტოვდა.", parse_mode=_PARSE)
        return

    added, updated = await db.upsert_products_bulk(rows_data)
    skip_line = f"\n⏭ გამოტოვებული: {skipped}" if skipped else ""
    await status_msg.edit_text(
        f"✅ <b>იმპორტი დასრულდა</b>\n\n"
        f"➕ დამატებული: <b>{added}</b>\n"
        f"🔄 განახლებული: <b>{updated}</b>{skip_line}",
        parse_mode=_PARSE,
    )
