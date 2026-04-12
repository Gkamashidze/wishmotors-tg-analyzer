import asyncio
import logging
import os
import sys
from typing import Any, Awaitable, Callable, Dict

# Guard: prevent accidental local runs that conflict with Railway
if not os.getenv("RAILWAY_ENVIRONMENT"):
    print("🚫 ბოტის ლოკალური გაშვება დაბლოკილია.")
    print("   გაუშვი მხოლოდ Railway-ზე, კონფლიქტის თავიდან ასაცილებლად.")
    sys.exit(0)

import pytz
from aiogram import BaseMiddleware, Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand, TelegramObject
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

import config
from bot.handlers.commands import commands_router
from bot.handlers.orders import orders_router
from bot.handlers.period_report import period_router
from bot.handlers.sales import sales_router
from bot.reports.formatter import format_weekly_report
from database.db import Database

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ─── Dependency injection middleware ──────────────────────────────────────────

class DatabaseMiddleware(BaseMiddleware):
    def __init__(self, db: Database) -> None:
        self.db = db

    async def __call__(
        self,
        handler: Callable[[TelegramObject, Dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: Dict[str, Any],
    ) -> Any:
        data["db"] = self.db
        return await handler(event, data)


# ─── Scheduled weekly report ──────────────────────────────────────────────────

async def _send_weekly_report(bot: Bot, db: Database) -> None:
    logger.info("Sending scheduled weekly report...")
    try:
        sales = await db.get_weekly_sales()
        returns = await db.get_weekly_returns()
        expenses = await db.get_weekly_expenses()
        products = await db.get_all_products()

        text = format_weekly_report(sales, returns, expenses, products)

        # DM each admin
        for admin_id in config.ADMIN_IDS:
            try:
                await bot.send_message(
                    chat_id=admin_id,
                    text=text,
                    parse_mode=ParseMode.HTML,
                )
            except Exception as dm_exc:
                logger.warning("Could not DM admin %d: %s", admin_id, dm_exc)

        logger.info("Weekly report sent successfully.")
    except Exception as exc:
        logger.error("Failed to send weekly report: %s", exc)
        for admin_id in config.ADMIN_IDS:
            try:
                await bot.send_message(
                    chat_id=admin_id,
                    text=f"⚠️ <b>კვირის ანგარიში ვერ გაიგზავნა</b>\n<code>{exc}</code>",
                    parse_mode="HTML",
                )
            except Exception:
                pass


# ─── Entry point ──────────────────────────────────────────────────────────────

async def main() -> None:
    db = Database(dsn=config.DATABASE_URL, timezone=config.TIMEZONE)
    await db.init()
    logger.info("Database pool ready.")

    bot = Bot(
        token=config.BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )

    await bot.set_my_commands([
        # ── 📊 ანგარიშები ──────────────────────────────
        BotCommand(command="report",        description="📊 კვირის ანგარიში"),
        BotCommand(command="report_period", description="📅 პერიოდის ანგარიში — კალენდარი"),
        # ── 🏪 საწყობი ────────────────────────────────
        BotCommand(command="stock",         description="🏪 საწყობის მდგომარეობა"),
        BotCommand(command="addproduct",    description="➕ პროდუქტის დამატება"),
        BotCommand(command="editproduct",   description="✏️ პროდუქტის რედაქტირება — ID ველი"),
        # ── 📋 შეკვეთები ──────────────────────────────
        BotCommand(command="orders",        description="📋 მომლოდინე შეკვეთები"),
        BotCommand(command="completeorder", description="✅ შეკვეთის დახურვა — ID საჭიროა"),
        # ── 💳 ნისია ──────────────────────────────────
        BotCommand(command="nisias",        description="💳 გადაუხდელი ნისიები (ღილაკებით)"),
        BotCommand(command="paid",          description="💵 ნისიის გადახდა — /paid ID ხელზე"),
        # ── 🗑 გასწორება ──────────────────────────────
        BotCommand(command="deletesale",    description="🗑 გაყიდვის წაშლა — /deletesale ID"),
        # ── 🔧 სისტემა ────────────────────────────────
        BotCommand(command="diagnostics",   description="🔍 ვერ ამოცნობილი შეტყობინებები"),
        BotCommand(command="help",          description="❓ გამოყენების სახელმძღვანელო"),
    ])
    logger.info("Bot commands menu registered.")

    dp = Dispatcher(storage=MemoryStorage())
    dp.message.middleware(DatabaseMiddleware(db))
    dp.callback_query.middleware(DatabaseMiddleware(db))

    dp.include_router(sales_router)
    dp.include_router(orders_router)
    dp.include_router(period_router)
    dp.include_router(commands_router)

    tz = pytz.timezone(config.TIMEZONE)
    scheduler = AsyncIOScheduler(timezone=tz)
    scheduler.add_job(
        _send_weekly_report,
        trigger=CronTrigger(
            day_of_week=config.REPORT_WEEKDAY,
            hour=config.REPORT_HOUR,
            minute=config.REPORT_MINUTE,
            timezone=tz,
        ),
        kwargs={"bot": bot, "db": db},
        id="weekly_report",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(
        "Scheduler started — weekly report every %s at %02d:%02d (%s)",
        config.REPORT_WEEKDAY.upper(),
        config.REPORT_HOUR,
        config.REPORT_MINUTE,
        config.TIMEZONE,
    )

    try:
        logger.info("Bot is running. Press Ctrl+C to stop.")
        await dp.start_polling(bot, skip_updates=True)
    finally:
        scheduler.shutdown(wait=False)
        await db.close()
        await bot.session.close()
        logger.info("Bot stopped.")


if __name__ == "__main__":
    asyncio.run(main())
