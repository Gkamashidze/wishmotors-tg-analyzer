import logging
import re
from calendar import monthrange
from datetime import datetime, timedelta
from typing import Optional, Tuple

import pytz
from aiogram import Router
from aiogram.enums import ParseMode
from aiogram.filters import Command
from aiogram.types import Message

import config
from bot.handlers import IsAdmin
from bot.reports.formatter import (
    format_orders_report,
    format_period_report,
    format_stock_report,
    format_weekly_report,
)
from database.db import Database

logger = logging.getLogger(__name__)
commands_router = Router(name="commands")

_PARSE = ParseMode.HTML

_HELP_TEXT = """
🤝 <b>WishMotors ბოტი — გამოყენების სახელმძღვანელო</b>

📌 <b>გაყიდვის ფორმატი (Sales topic):</b>
<code>მარჭვენა რეფლექტორი 1ც 30₾ ხელზე</code>
<code>8390132500 2ც 45₾ გადარიცხვა</code>
<code>კოდი: 8390132500, 1ც, 35₾</code>

↩️ <b>დაბრუნება (Sales topic — same format + სიტყვა "დაბრუნება"):</b>
<code>დაბრუნება 8390132500 1ც 45₾</code>

📋 <b>შეკვეთა (Orders topic):</b>
<code>8390132500 5ც</code>
<code>მარჭვენა სარკე 3ც</code>

🧾 <b>ხარჯი (Expenses topic):</b>
<code>50₾ ბენზინი</code>
<code>ბენზინი 50₾</code>

📂 <b>საწყობის ატვირთვა (Capital topic):</b>
გამოაგზავნეთ Excel (.xlsx) სვეტებით:
<b>სახელი | OEM | მარაგი | ფასი</b>

━━━━━━━━━━━━━━━━━━━━━
🤖 <b>ბრძანებები:</b>
/report — კვირის ანგარიში
/report_period — პერიოდის ანგარიში (იხ. ქვემოთ)
/stock — საწყობის მდგომარეობა
/orders — მომლოდინე შეკვეთები
/completeorder ID — შეკვეთის დახურვა
/addproduct — პროდუქტის დამატება
/help — ეს შეტყობინება

📅 <b>/report_period გამოყენება:</b>
<code>/report_period week</code>       → ბოლო 7 დღე
<code>/report_period month</code>      → მიმდინარე თვე
<code>/report_period lastmonth</code>  → გასული თვე
<code>/report_period 2026-03</code>    → მარტის სრული თვე
<code>/report_period 2026-03-01 2026-03-31</code> → კონკრეტული თარიღები

📦 <b>პროდუქტის დამატება:</b>
<code>/addproduct სახელი OEM_კოდი მარაგი ფასი</code>
სახელში გამოიყენეთ _ სფეისის ნაცვლად.

მაგალითი:
<code>/addproduct მარჭვენა_რეფლექტორი 8390132500 50 30.00</code>
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
    await message.bot.send_message(
        chat_id=message.from_user.id,
        text="⏳ ანგარიში მუშავდება...",
        parse_mode=_PARSE,
    )

    sales = await db.get_weekly_sales()
    returns = await db.get_weekly_returns()
    expenses = await db.get_weekly_expenses()
    products = await db.get_all_products()

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=format_weekly_report(sales, returns, expenses, products),
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


@commands_router.message(Command("completeorder"), IsAdmin())
async def cmd_complete_order(message: Message, db: Database) -> None:
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


# ─── Period report helpers ────────────────────────────────────────────────────

def _parse_period(
    args: list, tz: pytz.BaseTzInfo
) -> Optional[Tuple[datetime, datetime]]:
    """Return (date_from, date_to) in Tbilisi timezone, or None on bad input."""
    now = datetime.now(tz)

    if not args:
        return None

    keyword = args[0].lower()

    if keyword == "week":
        return now - timedelta(days=7), now

    if keyword == "month":
        date_from = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return date_from, now

    if keyword == "lastmonth":
        first_this = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        last_of_prev = first_this - timedelta(seconds=1)
        first_of_prev = last_of_prev.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end_of_prev = last_of_prev.replace(hour=23, minute=59, second=59, microsecond=0)
        return first_of_prev, end_of_prev

    # YYYY-MM → full month
    if len(args) == 1 and re.fullmatch(r"\d{4}-\d{2}", args[0]):
        year, month = int(args[0][:4]), int(args[0][5:7])
        if not (1 <= month <= 12):
            return None
        _, last_day = monthrange(year, month)
        date_from = tz.localize(datetime(year, month, 1, 0, 0, 0))
        date_to = tz.localize(datetime(year, month, last_day, 23, 59, 59))
        return date_from, date_to

    # YYYY-MM-DD YYYY-MM-DD → specific date range
    if (
        len(args) == 2
        and re.fullmatch(r"\d{4}-\d{2}-\d{2}", args[0])
        and re.fullmatch(r"\d{4}-\d{2}-\d{2}", args[1])
    ):
        try:
            date_from = tz.localize(datetime.strptime(args[0], "%Y-%m-%d"))
            date_to = tz.localize(
                datetime.strptime(args[1], "%Y-%m-%d").replace(hour=23, minute=59, second=59)
            )
        except ValueError:
            return None
        if date_from > date_to:
            return None
        return date_from, date_to

    return None


_PERIOD_USAGE = (
    "❌ <b>არასწორი ფორმატი.</b>\n\n"
    "გამოიყენეთ:\n"
    "<code>/report_period week</code>       — ბოლო 7 დღე\n"
    "<code>/report_period month</code>      — მიმდინარე თვე\n"
    "<code>/report_period lastmonth</code>  — გასული თვე\n"
    "<code>/report_period 2026-03</code>    — თვე YYYY-MM ფორმატში\n"
    "<code>/report_period 2026-03-01 2026-03-31</code> — კონკრეტული თარიღები"
)


@commands_router.message(Command("report_period"), IsAdmin())
async def cmd_report_period(message: Message, db: Database) -> None:
    tz = pytz.timezone(config.TIMEZONE)
    args = (message.text or "").split()[1:]
    parsed = _parse_period(args, tz)

    if parsed is None:
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text=_PERIOD_USAGE,
            parse_mode=_PARSE,
        )
        return

    date_from, date_to = parsed

    if date_from > datetime.now(tz):
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text="⚠️ პერიოდის დასაწყისი მომავალ თარიღზეა. გთხოვთ, მიუთითოთ წარსული პერიოდი.",
            parse_mode=_PARSE,
        )
        return

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text="⏳ ანგარიში მუშავდება...",
        parse_mode=_PARSE,
    )

    sales = await db.get_sales_by_period(date_from, date_to)
    returns = await db.get_returns_by_period(date_from, date_to)
    expenses = await db.get_expenses_by_period(date_from, date_to)
    products = await db.get_all_products()

    text = format_period_report(sales, returns, expenses, products, date_from, date_to)
    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=text,
        parse_mode=_PARSE,
    )


# ─── Add product ──────────────────────────────────────────────────────────────

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
    except (ValueError, IndexError):
        await message.bot.send_message(
            chat_id=message.from_user.id,
            text="❌ შეამოწმეთ ფორმატი. <b>მარაგი</b> მთელი რიცხვია, <b>ფასი</b> — ათობითი.",
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
            f"📦 სახელი: {name}\n"
            f"🔑 OEM: {oem or '—'}\n"
            f"📊 საწყობი: {stock}ც\n"
            f"💰 ფასი: {price:.2f}₾\n"
            f"🆔 ID: {product_id}"
        ),
        parse_mode=_PARSE,
    )
