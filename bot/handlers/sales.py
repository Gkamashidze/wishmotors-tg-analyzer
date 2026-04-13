import html
import logging
from datetime import date, datetime
from io import BytesIO

import openpyxl
import pytz
from aiogram import F, Router, Bot
from aiogram.enums import ParseMode
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message

import config
from bot.handlers import InTopic, IsAdmin
from bot.parsers.message_parser import (
    ParsedSale,
    parse_batch_sales,
    parse_dual_sale_message,
    parse_sale_message,
)
from bot.reports.formatter import (
    format_batch_confirmation,
    format_sale_confirmation,
    format_return_confirmation,
)
from database.db import Database
from database.models import ProductRow

logger = logging.getLogger(__name__)
sales_router = Router(name="sales")

_PARSE = ParseMode.HTML
_MAX_IMPORT_ROWS = 2_000  # Safety limit per Excel import


def _delete_keyboard(sale_id: int) -> InlineKeyboardMarkup:
    """Single delete button for one sale confirmation."""
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=f"🗑 წაშლა #{sale_id}", callback_data=f"ds:{sale_id}")
    ]])


def _delete_keyboard_batch(sale_ids: list[int]) -> InlineKeyboardMarkup:
    """Delete buttons for a batch confirmation — pairs per row."""
    rows = []
    for i in range(0, len(sale_ids), 2):
        row = [
            InlineKeyboardButton(text=f"🗑 #{sid}", callback_data=f"ds:{sid}")
            for sid in sale_ids[i:i + 2]
        ]
        rows.append(row)
    return InlineKeyboardMarkup(inline_keyboard=rows)


# ─── Sales topic: text messages ───────────────────────────────────────────────

@sales_router.message(InTopic(config.SALES_TOPIC_ID), IsAdmin(), F.text)
async def handle_sales_text(message: Message, db: Database) -> None:
    text = (message.text or "").strip()
    try:
        # Multi-line → batch handler (one customer, many items)
        if "\n" in text:
            await _handle_batch_sales(message, db, text)
            return

        # Dual-product format: "008b03 და 108000 1-1ც ჯამში 100₾" → two separate sales
        dual = parse_dual_sale_message(text)
        if dual is not None:
            await _handle_dual_sale(message, db, dual)
            return

        parsed = parse_sale_message(text)

        if not parsed:
            await db.log_parse_failure(config.SALES_TOPIC_ID, text)
            return

        raw = parsed.raw_product

        product = await db.get_product_by_oem(raw)
        if not product and raw:
            product = await db.get_product_by_partial_oem(raw)
        if not product:
            product = await db.get_product_by_name(raw)

        if not product:
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


async def _handle_batch_sales(message: Message, db: Database, text: str) -> None:
    """Process a multi-line message — each line is a separate sale, customer shared."""
    customer_name, parsed_list = parse_batch_sales(text)

    if not parsed_list:
        await db.log_parse_failure(config.SALES_TOPIC_ID, text)
        return

    results = []
    failed_lines = []
    grand_total = 0.0

    raw_lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    offset = 1 if customer_name else 0

    for i, item_group in enumerate(parsed_list):
        if item_group is None:
            line_idx = offset + i
            failed_lines.append(raw_lines[line_idx] if line_idx < len(raw_lines) else "?")
            continue

        for parsed in item_group:
            raw = parsed.raw_product
            product = await db.get_product_by_oem(raw) if raw else None
            if not product and raw:
                product = await db.get_product_by_partial_oem(raw)
            if not product and raw:
                product = await db.get_product_by_name(raw)

            sale_id, _ = await db.create_sale(
                product_id=product["id"] if product else None,
                quantity=parsed.quantity,
                unit_price=parsed.price,
                payment_method=parsed.payment_method,
                seller_type=parsed.seller_type,
                customer_name=parsed.customer_name or None,
                notes=raw if not product else None,
            )
            grand_total += parsed.quantity * parsed.price
            results.append((parsed, product, sale_id))

    if not results:
        # All lines failed — log and bail
        await db.log_parse_failure(config.SALES_TOPIC_ID, text)
        return

    sale_ids = [sale_id for _, _, sale_id in results]
    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=format_batch_confirmation(customer_name, results, grand_total, failed_lines),
        parse_mode=_PARSE,
        reply_markup=_delete_keyboard_batch(sale_ids),
    )


async def _handle_dual_sale(message: Message, db: Database, dual: list) -> None:
    """Record two sales from a single-line dual entry (e.g. '008b03 და 108000 1-1ც ჯამში 100₾')."""
    results = []
    grand_total = 0.0
    customer_name = dual[0].customer_name or None

    for parsed in dual:
        raw = parsed.raw_product
        product = await db.get_product_by_oem(raw) if raw else None
        if not product and raw:
            product = await db.get_product_by_partial_oem(raw)
        if not product and raw:
            product = await db.get_product_by_name(raw)

        sale_id, _ = await db.create_sale(
            product_id=product["id"] if product else None,
            quantity=parsed.quantity,
            unit_price=parsed.price,
            payment_method=parsed.payment_method,
            seller_type=parsed.seller_type,
            customer_name=parsed.customer_name or None,
            notes=raw if not product else None,
        )
        grand_total += parsed.quantity * parsed.price
        results.append((parsed, product, sale_id))

    sale_ids = [sale_id for _, _, sale_id in results]
    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=format_batch_confirmation(customer_name, results, grand_total, []),
        parse_mode=_PARSE,
        reply_markup=_delete_keyboard_batch(sale_ids),
    )


async def _record_sale(message: Message, db: Database, product: ProductRow, parsed: ParsedSale) -> None:
    sale_id, new_stock = await db.create_sale(
        product_id=product["id"],
        quantity=parsed.quantity,
        unit_price=parsed.price,
        payment_method=parsed.payment_method,
        seller_type=parsed.seller_type,
        customer_name=parsed.customer_name or None,
    )
    low = new_stock <= product["min_stock"]

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=format_sale_confirmation(
            product_name=product["name"],
            qty=parsed.quantity,
            price=parsed.price,
            payment=parsed.payment_method,
            seller_type=parsed.seller_type,
            customer_name=parsed.customer_name,
            new_stock=new_stock,
            low_stock=low,
            sale_id=sale_id,
        ),
        parse_mode=_PARSE,
        reply_markup=_delete_keyboard(sale_id),
    )

    if low:
        logger.warning(
            "Low stock alert: %s — %d units remaining", product["name"], new_stock
        )

    if new_stock == 0:
        await db.create_order(
            product_id=product["id"],
            quantity_needed=product["min_stock"],
            notes=f"ავტო: {product['name']} — 0-ზე ჩამოვიდა",
        )
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=(
                f"🔔 <b>ავტოშეკვეთა!</b>\n"
                f"📦 {product['name']} — საწყობი 0-ზე ჩამოვიდა.\n"
                f"📋 შეკვეთა ავტომატურად შეიქმნა ({product['min_stock']}ც)."
            ),
            parse_mode=_PARSE,
        )


async def _record_sale_freeform(
    message: Message, db: Database, product_name: str, parsed: ParsedSale
) -> None:
    """პროდუქტი ბაზაში არ არსებობს — გაყიდვა ჩაიწერება notes-ით, stock ცვლილების გარეშე."""
    sale_id, _ = await db.create_sale(
        product_id=None,
        quantity=parsed.quantity,
        unit_price=parsed.price,
        payment_method=parsed.payment_method,
        seller_type=parsed.seller_type,
        customer_name=parsed.customer_name or None,
        notes=product_name,
    )

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=format_sale_confirmation(
            product_name=product_name,
            qty=parsed.quantity,
            price=parsed.price,
            payment=parsed.payment_method,
            seller_type=parsed.seller_type,
            customer_name=parsed.customer_name,
            new_stock=None,
            low_stock=False,
            sale_id=sale_id,
            unknown_product=True,
        ),
        parse_mode=_PARSE,
        reply_markup=_delete_keyboard(sale_id),
    )


async def _record_return(message: Message, db: Database, product: ProductRow, parsed: ParsedSale) -> None:
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
    if any(k in v for k in ("გადარიცხვა", "დარიცხა", "transfer", "ბარათი", "კარტი", "card")):
        return "transfer"
    if any(k in v for k in ("ნისია", "credit")):
        return "credit"
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
    data_rows = 0

    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if not row or row[0] is None:
            continue
        data_rows += 1
        if data_rows > _MAX_IMPORT_ROWS:
            errors.append(f"⚠️ ლიმიტი: {_MAX_IMPORT_ROWS} სტრიქონი. დანარჩენი გამოტოვდა.")
            break
        try:
            sold_at = _parse_import_date(row[0], tz)
            raw_product = str(row[1]).strip() if row[1] is not None else ""
            quantity = int(row[2])
            unit_price = float(row[3])
            payment = _parse_import_payment(row[4]) if len(row) > 4 and row[4] else "credit"

            if not raw_product or quantity <= 0 or unit_price < 0:
                raise ValueError("ცარიელი ან არასწორი მნიშვნელობა")

            product = await db.get_product_by_oem(raw_product)
            if not product:
                product = await db.get_product_by_partial_oem(raw_product)
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
    data_rows = 0

    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or row[0] is None:
            continue
        data_rows += 1
        if data_rows > _MAX_IMPORT_ROWS:
            errors += 1
            logger.warning("Excel upload exceeded %d row limit — remaining rows skipped.", _MAX_IMPORT_ROWS)
            break
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
