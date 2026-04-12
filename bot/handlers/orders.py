import logging

from aiogram import F, Router
from aiogram.enums import ParseMode
from aiogram.types import Message

import config
from bot.handlers import InTopic, IsAdmin
from bot.parsers.message_parser import parse_expense_message, parse_order_message
from database.db import Database

logger = logging.getLogger(__name__)
orders_router = Router(name="orders")

_PARSE = ParseMode.HTML


# ─── Orders topic ─────────────────────────────────────────────────────────────

@orders_router.message(InTopic(config.ORDERS_TOPIC_ID), IsAdmin(), F.text)
async def handle_order_message(message: Message, db: Database) -> None:
    text = (message.text or "").strip()
    parsed = parse_order_message(text)

    if not parsed:
        return

    product = await db.get_product_by_oem(parsed.raw_product)
    if not product:
        product = await db.get_product_by_name(parsed.raw_product)

    product_id = product["id"] if product else None
    product_name = product["name"] if product else parsed.raw_product

    await db.create_order(
        product_id=product_id,
        quantity_needed=parsed.quantity,
        notes=text,
    )

    await message.reply(
        f"📋 <b>შეკვეთა დაფიქსირდა</b>\n"
        f"📦 პროდუქტი: <b>{product_name}</b>\n"
        f"🔢 საჭირო რაოდენობა: {parsed.quantity}ც",
        parse_mode=_PARSE,
    )


# ─── Expenses topic ───────────────────────────────────────────────────────────

@orders_router.message(InTopic(config.EXPENSES_TOPIC_ID), IsAdmin(), F.text)
async def handle_expense_message(message: Message, db: Database) -> None:
    text = (message.text or "").strip()
    parsed = parse_expense_message(text)

    if not parsed:
        return

    await db.create_expense(
        amount=parsed.amount,
        description=parsed.description,
        category=parsed.category,
    )

    await message.reply(
        f"🧾 <b>ხარჯი დაფიქსირდა</b>\n"
        f"💰 თანხა: <b>{parsed.amount:.2f}₾</b>\n"
        f"📝 აღწერა: {parsed.description}",
        parse_mode=_PARSE,
    )
