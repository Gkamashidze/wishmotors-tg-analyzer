import html
import logging
from datetime import date, datetime
from io import BytesIO

import openpyxl
import pytz
from aiogram import F, Router, Bot
from aiogram.enums import ParseMode
from aiogram.types import Message

import config
from bot.handlers import InTopic, IsAdmin
from bot.parsers.message_parser import ParsedSale, parse_sale_message
from bot.reports.formatter import format_sale_confirmation, format_return_confirmation
from database.db import Database

logger = logging.getLogger(__name__)
sales_router = Router(name="sales")

_PARSE = ParseMode.HTML


# ─── Sales topic: text messages ───────────────────────────────────────────────

@sales_router.message(InTopic(config.SALES_TOPIC_ID), IsAdmin(), F.text)
async def handle_sales_text(message: Message, db: Database) -> None:
    text = (message.text or "").strip()
    try:
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
                    text=f"⚠️ პროდუქტი <b>{html.escape(raw)}</b> ვერ მოიძებნა. დაბრუნება ვერ ჩაიწერება.",
                    parse_mode=_PARSE,
                )
                return
            await _record_sale_freeform(message, db, raw, parsed)
            return

        if parsed.is_return:
            await _record_return(message, db, product, parsed)
        else:
            await _record_sale(message, db, product, parsed)
    except Exception:
        logger.exception("Unexpected error in handle_sales_text: %r", text)
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text="❌ სისტემური შეცდომა. გთხოვთ, სცადოთ ხელახლა.",
            parse_mode=_PARSE,
        )


async def _record_sale(message: Message, db: Database, product: dict, parsed: ParsedSale) -> None:
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
    message: Message, db: Database, product_name: str, parsed: ParsedSale
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
            f"📦 პროდუქტი: {html.escape(product_name)}\n"
            f"🔢 რაოდენობა: {parsed.quantity}ც\n"
            f"💰 ფასი: {parsed.price:.2f}₾ × {parsed.quantity} = <b>{total:.2f}₾</b>\n"
            f"💳 გადახდა: {payment_str}\n"
            f"<i>⚠️ პროდუქტი ბაზაში არ არის — მარაგი არ განახლებულა</i>"
        ),
        parse_mode=_PARSE,
    )


async def _record_return(message: Message, db: Database, product: dict, parsed: ParsedSale) -> None:
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


# ─── Sales topic: Excel historical import ────────────────────────────────────

def _parse_import_date(val: object, tz: pytz.BaseTzInfo) -> datetime:
    """Accept Excel date objects or strings (DD.MM.YYYY / YYYY-MM-DD / DD/MM/YYYY)."""
    if isinstance(val, datetime):
        return tz.localize(val.replace(tzinfo=None))
    if isinstance(val, date):
        return tz.localize(datetime(val.year, val.month, val.day))
    s = str(val).strip()
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return tz.localize(datetime.strptime(s, fmt))
        except ValueError:
            continue
    raise ValueError(f"თარიღი ვერ წაიკითხა: {s}")


def _parse_import_payment(val: object) -> str:
    v = str(val).lower().strip()
    if any(k in v for k in ("გადარიცხვა", "transfer", "ბარათი", "card")):
        return "transfer"
    return "cash"


@sales_router.message(InTopic(config.SALES_TOPIC_ID), IsAdmin(), F.document)
async def handle_sales_import_excel(message: Message, bot: Bot, db: Database) -> None:
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

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text="⏳ გაყიდვების იმპორტი მუშავდება...",
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
        logger.error("Sales import Excel parse error: %s", exc)
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=(
                "❌ ფაილი ვერ წაიკითხა.\n"
                "სვეტები: <b>თარიღი | პროდუქტი/OEM | რაოდენობა | ფასი | გადახდა</b>"
            ),
            parse_mode=_PARSE,
        )
        return

    tz = pytz.timezone(config.TIMEZONE)
    imported = 0
    errors: list[str] = []

    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if not row or row[0] is None:
            continue
        try:
            sold_at = _parse_import_date(row[0], tz)
            raw_product = str(row[1]).strip() if row[1] is not None else ""
            quantity = int(row[2])
            unit_price = float(row[3])
            payment = _parse_import_payment(row[4]) if len(row) > 4 and row[4] else "cash"

            if not raw_product or quantity <= 0 or unit_price < 0:
                raise ValueError("ცარიელი ან არასწორი მნიშვნელობა")

            product = await db.get_product_by_oem(raw_product)
            if not product:
                product = await db.get_product_by_name(raw_product)

            await db.import_sale(
                product_id=product["id"] if product else None,
                quantity=quantity,
                unit_price=unit_price,
                payment_method=payment,
                sold_at=sold_at,
                notes=raw_product if not product else None,
            )
            imported += 1
        except Exception as exc:
            errors.append(f"სტრიქონი {i}: {exc}")
            logger.warning("Sales import row %d error: %s", i, exc)

    summary = f"✅ <b>იმპორტი დასრულდა!</b>\n📊 ჩაიწერა: <b>{imported}</b> გაყიდვა"
    if errors:
        preview = "\n".join(errors[:5])
        if len(errors) > 5:
            preview += f"\n... და კიდევ {len(errors) - 5}"
        summary += f"\n⚠️ გამოტოვებული ({len(errors)}):\n<code>{html.escape(preview)}</code>"

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=summary,
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
