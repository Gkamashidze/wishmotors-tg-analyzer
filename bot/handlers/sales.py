import logging
from io import BytesIO

import openpyxl
from aiogram import F, Router, Bot
from aiogram.enums import ParseMode
from aiogram.types import Message

import config
from bot.handlers import InTopic, IsAdmin
from bot.parsers.message_parser import parse_sale_message
from bot.reports.formatter import format_sale_confirmation, format_return_confirmation
from database.db import Database

logger = logging.getLogger(__name__)
sales_router = Router(name="sales")

_PARSE = ParseMode.HTML


# ─── Sales topic: text messages ───────────────────────────────────────────────

@sales_router.message(InTopic(config.SALES_TOPIC_ID), IsAdmin(), F.text)
async def handle_sales_text(message: Message, db: Database) -> None:
    text = (message.text or "").strip()
    parsed = parse_sale_message(text)

    if not parsed:
        return

    raw = parsed.raw_product

    product = await db.get_product_by_oem(raw)
    if not product:
        product = await db.get_product_by_name(raw)

    if not product:
        # პროდუქტი ბაზაში არ არის (საწყისი ნაშთები ჯერ არ არის ატვირთული).
        # გაყიდვა მაინც ჩაიწერება — product_id=None, პროდუქტის სახელი notes-ში.
        if parsed.is_return:
            await message.bot.send_message(
                chat_id=message.from_user.id,
                text=f"⚠️ პროდუქტი <b>{raw}</b> ვერ მოიძებნა. დაბრუნება ვერ ჩაიწერება.",
                parse_mode=_PARSE,
            )
            return
        await _record_sale_freeform(message, db, raw, parsed)
        return

    if parsed.is_return:
        await _record_return(message, db, product, parsed)
    else:
        await _record_sale(message, db, product, parsed)


async def _record_sale(message: Message, db: Database, product: dict, parsed) -> None:
    _sale_id, new_stock = await db.create_sale(
        product_id=product["id"],
        quantity=parsed.quantity,
        unit_price=parsed.price,
        payment_method=parsed.payment_method,
    )
    low = new_stock <= product["min_stock"]

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=format_sale_confirmation(
            product_name=product["name"],
            qty=parsed.quantity,
            price=parsed.price,
            payment=parsed.payment_method,
            new_stock=new_stock,
            low_stock=low,
        ),
        parse_mode=_PARSE,
    )

    if low:
        logger.warning(
            "Low stock alert: %s — %d units remaining", product["name"], new_stock
        )


async def _record_sale_freeform(
    message: Message, db: Database, product_name: str, parsed
) -> None:
    """პროდუქტი ბაზაში არ არსებობს — გაყიდვა ჩაიწერება notes-ით, stock ცვლილების გარეშე."""
    payment_str = "ხელზე 💵" if parsed.payment_method == "cash" else "გადარიცხვა 🏦"
    total = parsed.quantity * parsed.price

    await db.create_sale(
        product_id=None,
        quantity=parsed.quantity,
        unit_price=parsed.price,
        payment_method=parsed.payment_method,
        notes=product_name,
    )

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=(
            f"✅ <b>გაყიდვა დაფიქსირდა</b>\n"
            f"📦 პროდუქტი: {product_name}\n"
            f"🔢 რაოდენობა: {parsed.quantity}ც\n"
            f"💰 ფასი: {parsed.price:.2f}₾ × {parsed.quantity} = <b>{total:.2f}₾</b>\n"
            f"💳 გადახდა: {payment_str}\n"
            f"<i>⚠️ პროდუქტი ბაზაში არ არის — მარაგი არ განახლებულა</i>"
        ),
        parse_mode=_PARSE,
    )


async def _record_return(message: Message, db: Database, product: dict, parsed) -> None:
    refund = parsed.price * parsed.quantity

    _return_id, new_stock = await db.create_return(
        product_id=product["id"],
        quantity=parsed.quantity,
        refund_amount=refund,
        notes="დაბრუნება",
    )

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=format_return_confirmation(
            product_name=product["name"],
            qty=parsed.quantity,
            refund=refund,
            new_stock=new_stock,
        ),
        parse_mode=_PARSE,
    )


# ─── Capital topic: Excel stock uploads ───────────────────────────────────────

@sales_router.message(InTopic(config.CAPITAL_TOPIC_ID), IsAdmin(), F.document)
async def handle_excel_upload(message: Message, bot: Bot, db: Database) -> None:
    doc = message.document
    if not doc or not doc.file_name:
        return

    if not doc.file_name.lower().endswith((".xlsx", ".xls")):
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text="❌ გთხოვთ Excel ფაილი (.xlsx) გამოაგზავნოთ.",
            parse_mode=_PARSE,
        )
        return

    if doc.file_size and doc.file_size > config.MAX_EXCEL_BYTES:
        mb = config.MAX_EXCEL_BYTES // (1024 * 1024)
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=f"❌ ფაილი ძალიან დიდია. მაქსიმალური ზომა: <b>{mb} MB</b>.",
            parse_mode=_PARSE,
        )
        return

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text="⏳ ფაილი მუშავდება...",
        parse_mode=_PARSE,
    )

    file_info = await bot.get_file(doc.file_id)
    buf = BytesIO()
    await bot.download_file(file_info.file_path, destination=buf)
    buf.seek(0)

    try:
        wb = openpyxl.load_workbook(buf, read_only=True, data_only=True)
        ws = wb.active
    except Exception as exc:
        logger.error("Excel parse error: %s", exc)
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text="❌ ფაილი ვერ წაიკითხა. გადაამოწმეთ ფორმატი.\nსვეტები: <b>სახელი | OEM | მარაგი | ფასი</b>",
            parse_mode=_PARSE,
        )
        return

    updated = 0
    errors = 0

    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or row[0] is None:
            continue
        try:
            name = str(row[0]).strip()
            oem = str(row[1]).strip() if row[1] is not None else None
            stock = int(row[2]) if row[2] is not None else 0
            price = float(row[3]) if row[3] is not None else 0.0

            if not name:
                continue

            await db.upsert_product(
                name=name,
                oem_code=oem,
                stock=stock,
                min_stock=config.MIN_STOCK_THRESHOLD,
                price=price,
            )
            updated += 1
        except Exception as exc:
            logger.error("Row error %s: %s", row, exc)
            errors += 1

    summary = f"✅ <b>საწყობი განახლდა!</b>\n📦 პროდუქტები: {updated}ც"
    if errors:
        summary += f"\n⚠️ გამოტოვებული სტრიქონები: {errors}"

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=summary,
        parse_mode=_PARSE,
    )
