import html
import logging

from aiogram import F, Router
from aiogram.enums import ParseMode
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    InaccessibleMessage,
)

import config
from bot.handlers import InTopic, IsAdmin
from bot.handlers.topic_messages import topic_expense_kb
from bot.parsers.message_parser import (
    ORDER_PRIORITY_LOW,
    ORDER_PRIORITY_URGENT,
    parse_expense_message,
    parse_order_message,
)
from bot.reports.formatter import (
    _category_label,
    format_topic_expense,
    format_topic_order,
)
from database.db import Database

logger = logging.getLogger(__name__)
orders_router = Router(name="orders")

_PARSE = ParseMode.HTML

_PRIORITY_LABEL = {
    ORDER_PRIORITY_URGENT: "🚨 სასწრაფო — ახლავე",
    ORDER_PRIORITY_LOW: "🟢 არც ისე სასწრაფო",
    # Legacy value: map 'normal' to low label so old DB rows display correctly.
    "normal": "🟢 არც ისე სასწრაფო",
}

_STATUS_BUTTON_LABELS = [
    ("🆕 ახალი",       "new"),
    ("⚙️ მუშავდება",   "processing"),
    ("📦 შეკვეთილია",   "ordered"),
    ("✅ მზადაა",       "ready"),
    ("🚚 მიტანილი",    "delivered"),
    ("❌ გაუქმება",     "cancelled"),
]

_STATUS_ANSWER_LABELS = {
    "new":        "🆕 ახალი",
    "processing": "⚙️ მუშავდება",
    "ordered":    "📦 შეკვეთილია",
    "ready":      "✅ მზადაა",
    "delivered":  "🚚 მიტანილი",
    "cancelled":  "❌ გაუქმდა",
}


def _order_status_kb(order_id: int) -> InlineKeyboardMarkup:
    """6-button inline keyboard for changing a single order's status."""
    rows = [
        [InlineKeyboardButton(text=label, callback_data=f"order_status:{order_id}:{status}")]
        for label, status in _STATUS_BUTTON_LABELS
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


# ─── Orders topic ─────────────────────────────────────────────────────────────

@orders_router.message(InTopic(config.ORDERS_TOPIC_ID), IsAdmin(), F.text)
async def handle_order_message(message: Message, db: Database) -> None:
    text = (message.text or "").strip()
    try:
        parsed = parse_order_message(text)

        if not parsed:
            await db.log_parse_failure(config.ORDERS_TOPIC_ID, text)
            return

        if parsed.quantity == 0:
            await message.bot.send_message(
                chat_id=message.from_user.id,
                text=(
                    "⚠️ რაოდენობა არ მითითებულია.\n"
                    "ფორმატი: <code>სახელი Nც</code> ან <code>OEM Nც</code>"
                ),
                parse_mode=_PARSE,
            )
            return

        product = await db.get_product_by_oem(parsed.raw_product)
        if not product:
            product = await db.get_product_by_name(parsed.raw_product)

        product_id = product["id"] if product else None
        product_name = product["name"] if product else parsed.raw_product

        order_id = await db.create_order(
            product_id=product_id,
            quantity_needed=parsed.quantity,
            priority=parsed.priority,
            notes=text,
            part_name=product_name,
        )

        # Post confirmation to the orders topic with inline status keyboard.
        try:
            topic_text = format_topic_order(
                product_name=product_name,
                qty=parsed.quantity,
                status="new",
                priority=parsed.priority,
                order_id=order_id,
                notes=text,
            )
            topic_msg = await message.bot.send_message(
                chat_id=config.GROUP_ID,
                message_thread_id=config.ORDERS_TOPIC_ID,
                text=topic_text,
                parse_mode=_PARSE,
                reply_markup=_order_status_kb(order_id),
            )
            await db.update_orders_topic_message(
                [order_id], config.ORDERS_TOPIC_ID, topic_msg.message_id,
            )
        except Exception as _te:
            logger.warning("Failed to post order to topic: %s", _te)

        priority_label = _PRIORITY_LABEL.get(parsed.priority, "🟢 არც ისე სასწრაფო")
        qty_line = f"🔢 საჭირო რაოდენობა: {parsed.quantity}ც\n" if parsed.quantity else ""
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=(
                f"📋 <b>შეკვეთა დაფიქსირდა</b>\n"
                f"📦 პროდუქტი: <b>{html.escape(product_name)}</b>\n"
                f"{qty_line}"
                f"⏱ პრიორიტეტი: {priority_label}"
            ),
            parse_mode=_PARSE,
        )
    except Exception:
        logger.exception("Unexpected error in handle_order_message: %r", text)
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text="❌ სისტემური შეცდომა. გთხოვთ, სცადოთ ხელახლა.",
            parse_mode=_PARSE,
        )


# ─── Order status callback ────────────────────────────────────────────────────

@orders_router.callback_query(F.data.startswith("order_status:"))
async def handle_order_status_callback(callback: CallbackQuery, db: Database) -> None:
    data = callback.data or ""
    parts = data.split(":")
    if len(parts) != 3:
        await callback.answer("❌ არასწორი მოქმედება", show_alert=True)
        return

    try:
        order_id = int(parts[1])
    except ValueError:
        await callback.answer("❌ არასწორი ID", show_alert=True)
        return

    new_status = parts[2]

    try:
        updated = await db.update_order_status(order_id, new_status)
    except ValueError:
        await callback.answer("❌ არასწორი სტატუსი", show_alert=True)
        return

    if not updated:
        await callback.answer("⚠️ შეკვეთა ვერ მოიძებნა", show_alert=True)
        return

    # Refresh the topic message text with the new status.
    order = await db.get_order_by_id(order_id)
    if order and callback.message and not isinstance(callback.message, InaccessibleMessage):
        product_name = order.get("product_name") or order.get("part_name") or f"#{order_id}"
        new_text = format_topic_order(
            product_name=str(product_name),
            qty=int(order["quantity_needed"]),
            status=new_status,
            priority=str(order.get("priority") or "low"),
            order_id=order_id,
            notes=order.get("notes"),
        )
        try:
            await callback.message.edit_text(
                new_text,
                parse_mode=_PARSE,
                reply_markup=_order_status_kb(order_id),
            )
        except Exception as _te:
            logger.info("Could not edit order topic message: %s", _te)

    label = _STATUS_ANSWER_LABELS.get(new_status, new_status)
    await callback.answer(f"✅ სტატუსი: {label}")


# ─── Expenses topic ───────────────────────────────────────────────────────────

@orders_router.message(InTopic(config.EXPENSES_TOPIC_ID), IsAdmin(), F.text)
async def handle_expense_message(message: Message, db: Database) -> None:
    text = (message.text or "").strip()
    try:
        parsed = parse_expense_message(text)

        if not parsed:
            await db.log_parse_failure(config.EXPENSES_TOPIC_ID, text)
            return

        expense_id = await db.create_expense(
            amount=parsed.amount,
            description=parsed.description,
            category=parsed.category,
        )

        cat = _category_label(parsed.category)
        cat_line = f"\n🏷 კატეგორია: {cat}" if cat else ""
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=(
                f"🧾 <b>ხარჯი დაფიქსირდა</b>\n"
                f"💰 თანხა: <b>{parsed.amount:.2f}₾</b>\n"
                f"📝 აღწერა: {parsed.description}"
                f"{cat_line}"
            ),
            parse_mode=_PARSE,
        )

        try:
            topic_msg = await message.bot.send_message(
                chat_id=config.GROUP_ID,
                message_thread_id=config.EXPENSES_TOPIC_ID,
                text=format_topic_expense(
                    amount=parsed.amount,
                    category=parsed.category,
                    description=parsed.description,
                    expense_id=expense_id,
                ),
                parse_mode=_PARSE,
                reply_markup=topic_expense_kb(expense_id),
            )
            await db.update_expense_topic_message(
                expense_id, config.EXPENSES_TOPIC_ID, topic_msg.message_id,
            )
        except Exception as _te:
            logger.warning("Failed to post expense to topic: %s", _te)
    except Exception:
        logger.exception("Unexpected error in handle_expense_message: %r", text)
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text="❌ სისტემური შეცდომა. გთხოვთ, სცადოთ ხელახლა.",
            parse_mode=_PARSE,
        )
