import logging

from aiogram import Router
from aiogram.enums import ParseMode
from aiogram.filters import Command
from aiogram.types import Message

import config
from bot.handlers import IsAdmin
from bot.reports.formatter import format_orders_report, format_stock_report, format_weekly_report
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
/stock — საწყობის მდგომარეობა
/orders — მომლოდინე შეკვეთები
/completeorder ID — შეკვეთის დახურვა
/addproduct — პროდუქტის დამატება
/help — ეს შეტყობინება

📦 <b>პროდუქტის დამატება:</b>
<code>/addproduct სახელი OEM_კოდი მარაგი ფასი</code>
სახელში გამოიყენეთ _ სფეისის ნაცვლად.

მაგალითი:
<code>/addproduct მარჭვენა_რეფლექტორი 8390132500 50 30.00</code>
""".strip()


@commands_router.message(Command("help"), IsAdmin())
async def cmd_help(message: Message) -> None:
    await message.answer(_HELP_TEXT, parse_mode=_PARSE)


@commands_router.message(Command("stock"), IsAdmin())
async def cmd_stock(message: Message, db: Database) -> None:
    products = await db.get_all_products()
    await message.answer(format_stock_report(products), parse_mode=_PARSE)


@commands_router.message(Command("report"), IsAdmin())
async def cmd_report(message: Message, db: Database) -> None:
    await message.answer("⏳ ანგარიში მუშავდება...", parse_mode=_PARSE)

    sales = await db.get_weekly_sales()
    returns = await db.get_weekly_returns()
    expenses = await db.get_weekly_expenses()
    products = await db.get_all_products()

    await message.answer(
        format_weekly_report(sales, returns, expenses, products),
        parse_mode=_PARSE,
    )


@commands_router.message(Command("orders"), IsAdmin())
async def cmd_orders(message: Message, db: Database) -> None:
    orders = await db.get_pending_orders()
    await message.answer(format_orders_report(orders), parse_mode=_PARSE)


@commands_router.message(Command("completeorder"), IsAdmin())
async def cmd_complete_order(message: Message, db: Database) -> None:
    parts = (message.text or "").split()
    if len(parts) < 2 or not parts[1].isdigit():
        await message.answer(
            "❌ მიუთითეთ შეკვეთის ID.\n"
            "მაგალითი: <code>/completeorder 5</code>",
            parse_mode=_PARSE,
        )
        return

    order_id = int(parts[1])
    done = await db.complete_order(order_id)

    if done:
        await message.answer(
            f"✅ შეკვეთა #{order_id} დახურულია.",
            parse_mode=_PARSE,
        )
    else:
        await message.answer(
            f"⚠️ შეკვეთა #{order_id} ვერ მოიძებნა ან უკვე დახურულია.",
            parse_mode=_PARSE,
        )


@commands_router.message(Command("addproduct"), IsAdmin())
async def cmd_addproduct(message: Message, db: Database) -> None:
    args = (message.text or "").split()[1:]

    if len(args) < 4:
        await message.answer(
            "❌ <b>არასწორი ფორმატი.</b>\n\n"
            "გამოიყენეთ:\n"
            "<code>/addproduct სახელი OEM_კოდი მარაგი ფასი</code>\n\n"
            "მაგალითი:\n"
            "<code>/addproduct მარჭვენა_რეფლექტორი 8390132500 50 30.00</code>\n\n"
            "სახელში _ სფეისის ნაცვლად.",
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
        await message.answer(
            "❌ შეამოწმეთ ფორმატი. <b>მარაგი</b> მთელი რიცხვია, <b>ფასი</b> — ათობითი.",
            parse_mode=_PARSE,
        )
        return

    existing = await db.get_product_by_oem(oem) if oem else None
    if not existing:
        existing = await db.get_product_by_name(name)

    if existing:
        await message.answer(
            f"⚠️ პროდუქტი უკვე არსებობს: <b>{existing['name']}</b> (ID: {existing['id']})\n"
            f"მარაგის განახლებისთვის გამოიყენეთ Excel ატვირთვა Capital topic-ში.",
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

    await message.answer(
        f"✅ <b>პროდუქტი დამატებულია!</b>\n"
        f"📦 სახელი: {name}\n"
        f"🔑 OEM: {oem or '—'}\n"
        f"📊 საწყობი: {stock}ც\n"
        f"💰 ფასი: {price:.2f}₾\n"
        f"🆔 ID: {product_id}",
        parse_mode=_PARSE,
    )
