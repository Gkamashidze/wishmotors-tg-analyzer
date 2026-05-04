"""
Handles t.me/{bot}?start=order_{product_id} deep-links from the public catalog.

Filter is intentionally narrow: only fires when the /start payload starts with
"order_" followed by digits, so plain /start (no payload or different payload)
falls through to commands_router unaffected.
"""

import asyncio
import html
import logging
from typing import Optional

from aiogram import F, Router
from aiogram.exceptions import (
    TelegramBadRequest,
    TelegramNetworkError,
    TelegramRetryAfter,
)
from aiogram.types import Message

import config
from database.db import Database

logger = logging.getLogger(__name__)

deeplink_router = Router(name="deeplink")

_PREFIX = "/start order_"


def _parse_product_id(text: str) -> Optional[int]:
    """Return numeric product ID from '/start order_N', or None if payload is invalid."""
    payload = text[len(_PREFIX) :].strip()
    return int(payload) if payload.isdigit() else None


@deeplink_router.message(F.text.startswith(_PREFIX))
async def handle_catalog_deeplink(message: Message, db: Database) -> None:
    if message.from_user is None:
        return

    user = message.from_user
    raw_text = message.text or ""
    logger.info("catalog deeplink: user=%d text=%r", user.id, raw_text)

    product_id = _parse_product_id(raw_text)

    if product_id is None:
        logger.warning(
            "catalog deeplink: invalid payload from user=%d text=%r", user.id, raw_text
        )
        await message.answer(
            "ბოდიში, ეს პროდუქტი ვეღარ მოიძებნა. დაგვიკავშირდით ხელით."
        )
        return

    try:
        product = await db.get_product_by_id(product_id)
    except Exception as exc:
        logger.exception(
            "catalog deeplink: get_product_by_id(%d) failed: %s", product_id, exc
        )
        await message.answer("⚠️ სისტემური შეცდომა. გთხოვთ სცადოთ მოგვიანებით.")
        return

    if product is None:
        logger.info("catalog deeplink: product_id=%d not found", product_id)
        await message.answer(
            "ბოდიში, ეს პროდუქტი ვეღარ მოიძებნა. დაგვიკავშირდით ხელით."
        )
        return

    try:
        order_id = await db.upsert_client_and_create_catalog_order(
            telegram_id=user.id,
            full_name=user.full_name,
            username=user.username,
            product_id=product["id"],
            product_name=product["name"],
            oem_code=product["oem_code"],
            price=float(product["unit_price"]),
            notes="კატალოგიდან",
        )
    except Exception as exc:
        logger.exception(
            "catalog deeplink: order creation failed for product_id=%d user=%d: %s",
            product_id,
            user.id,
            exc,
        )
        await message.answer("⚠️ შეკვეთა ვერ შეიქმნა. გთხოვთ სცადოთ მოგვიანებით.")
        return

    price_str = f"₾{float(product['unit_price']):.2f}"
    oem_line = (
        f"\nOEM: <code>{html.escape(product['oem_code'])}</code>"
        if product["oem_code"]
        else ""
    )

    await message.answer(
        f"✅ <b>შეკვეთა მიღებულია</b>\n"
        f"{html.escape(product['name'])}"
        f"{oem_line}\n"
        f"ფასი: {price_str}\n\n"
        f"ჩვენ მალე დაგიკავშირდებით",
        parse_mode="HTML",
    )

    logger.info(
        "catalog deeplink: catalog_order #%d created product_id=%d user=%d",
        order_id,
        product_id,
        user.id,
    )

    if message.bot is None:
        return

    client_ref = (
        f"@{html.escape(user.username)}"
        if user.username
        else html.escape(user.full_name or str(user.id))
    )
    notify_text = (
        f"🌐 <b>კატალოგის შეკვეთა #{order_id}</b>\n"
        f"პროდუქტი: {html.escape(product['name'])}"
        f"{oem_line}\n"
        f"ფასი: {price_str}\n"
        f"კლიენტი: {client_ref} (ID: <code>{user.id}</code>)"
    )

    try:
        await message.bot.send_message(
            chat_id=config.GROUP_ID,
            message_thread_id=config.ORDERS_TOPIC_ID,
            text=notify_text,
            parse_mode="HTML",
        )
    except TelegramRetryAfter as exc:
        await asyncio.sleep(exc.retry_after)
        await message.bot.send_message(
            chat_id=config.GROUP_ID,
            message_thread_id=config.ORDERS_TOPIC_ID,
            text=notify_text,
            parse_mode="HTML",
        )
    except (TelegramNetworkError, TelegramBadRequest) as exc:
        logger.warning(
            "Could not forward catalog order #%d to group: %s", order_id, exc
        )
