import logging

from aiogram import Router
from aiogram.enums import ParseMode
from aiogram.filters import Command
from aiogram.types import Message

import config
from bot.handlers import IsAdmin
from bot.reports.formatter import (
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
/report — კვირის ანგარიში
/report_period — პერიოდის ანგარიში (კალენდარი)

🏪 <b>საწყობი:</b>
/stock — საწყობის მდგომარეობა
/addproduct — პროდუქტის დამატება

📋 <b>შეკვეთები:</b>
/orders — მომლოდინე შეკვეთები
/completeorder ID — შეკვეთის დახურვა

💳 <b>ნისია:</b>
/nisias — გადაუხდელი ნისიების სია
/paid ID ხელზე — ნისიის გადახდა ნაღდით
/paid ID დარიცხა — ნისიის გადახდა გადარიცხვით

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


@commands_router.message(Command("nisias"), IsAdmin())
async def cmd_nisias(message: Message, db: Database) -> None:
    """Show all unpaid credit sales."""
    sales = await db.get_credit_sales()
    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=format_credit_sales_report(sales),
        parse_mode=_PARSE,
    )


@commands_router.message(Command("paid"), IsAdmin())
async def cmd_paid(message: Message, db: Database) -> None:
    """Mark a credit sale as paid. Usage: /paid ID ხელზე  or  /paid ID დარიცხა"""
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
    failures = await db.get_parse_failure_stats(days=30)
    total_7d = await db.get_parse_failure_count(days=7)
    total_30d = await db.get_parse_failure_count(days=30)

    await message.bot.send_message(
        chat_id=message.from_user.id,
        text=format_diagnostics_report(failures, total_7d, total_30d),
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
