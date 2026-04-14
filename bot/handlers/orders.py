import html
import logging

from aiogram import F, Router
from aiogram.enums import ParseMode
from aiogram.types import Message

import config
from bot.handlers import InTopic, IsAdmin
from bot.parsers.message_parser import (
    ORDER_PRIORITY_LOW,
    ORDER_PRIORITY_URGENT,
    parse_expense_message,
    parse_order_message,
)
from bot.reports.formatter import _category_label, format_topic_expense
from database.db import Database

logger = logging.getLogger(__name__)
orders_router = Router(name="orders")

_PARSE = ParseMode.HTML

_PRIORITY_LABEL = {
    ORDER_PRIORITY_URGENT: "🔴 სასწრაფო — ახლავე",
    "normal": "🟡 ჩვეულებრივი",
    ORDER_PRIORITY_LOW: "🟢 ლოდინი — ჯერ არ მჭირდება",
}


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

        await db.create_order(
            product_id=product_id,
            quantity_needed=parsed.quantity,
            priority=parsed.priority,
            notes=text,
        )

        priority_label = _PRIORITY_LABEL.get(parsed.priority, "🟡 ჩვეულებრივი")
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
            await message.bot.send_message(
                chat_id=config.GROUP_ID,
                message_thread_id=config.EXPENSES_TOPIC_ID,
                text=format_topic_expense(
                    amount=parsed.amount,
                    category=parsed.category,
                    description=parsed.description,
                    expense_id=expense_id,
                ),
                parse_mode=_PARSE,
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
