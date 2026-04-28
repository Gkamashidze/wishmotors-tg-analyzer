import asyncio
import html
import logging
import os
import sys
from datetime import datetime, timedelta
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
from aiogram.fsm.storage.base import BaseStorage
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand, TelegramObject
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

import config
from bot.financial_ai import generate_weekly_advice
from bot.handlers.addorder import addorder_router
from bot.handlers.barcode import barcode_router
from database.audit_log import AuditLogger
from bot.handlers.commands import commands_router
from bot.handlers.personal_orders_handler import personal_orders_router
from bot.handlers.wizard import wizard_router
from bot.handlers.orders import orders_router
from bot.handlers.period_report import period_router
from bot.handlers.sales import sales_router
from bot.handlers.search import search_router
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

async def _run_integrity_check(db: Database, bot: Bot) -> None:
    """Hourly: verify audit log checksums and warn admins if tampering is found."""
    if db.audit is None:
        return
    try:
        result = await db.audit.verify_integrity(since_hours=25)
        if result.get("tampered"):
            warn = (
                f"⚠️ <b>Audit integrity alert</b>\n"
                f"Tampered rows: {result['tampered']}\n"
                f"Checked: {result['checked']}, OK: {result['ok']}"
            )
            for admin_id in config.ADMIN_IDS:
                try:
                    await bot.send_message(chat_id=admin_id, text=warn, parse_mode="HTML")
                except Exception:
                    pass
        else:
            logger.info(
                "Integrity check OK — %d rows verified.", result.get("checked", 0)
            )
    except Exception as exc:
        logger.warning("Integrity check failed: %s", exc)


async def _purge_expired_deleted_sales(db: Database) -> None:
    """Hourly cleanup: remove deleted_sales records past their 24h restore window."""
    try:
        count = await db.purge_expired_deleted_sales()
        if count:
            logger.info("Purged %d expired deleted_sales records.", count)
    except Exception as exc:
        logger.warning("Failed to purge expired deleted sales: %s", exc)


async def _purge_old_parse_failures(db: Database) -> None:
    """Nightly cleanup: remove parse_failures older than 90 days."""
    try:
        count = await db.purge_old_parse_failures(days=90)
        if count:
            logger.info("Purged %d old parse failure records (>90 days).", count)
    except Exception as exc:
        logger.warning("Failed to purge old parse failures: %s", exc)


async def _send_weekly_report(bot: Bot, db: Database) -> None:
    logger.info("Sending scheduled weekly report...")
    try:
        sales = await db.get_weekly_sales()
        returns = await db.get_weekly_returns()
        expenses = await db.get_weekly_expenses()
        products = await db.get_all_products()
        cash = await db.get_cash_on_hand()

        tz = pytz.timezone(config.TIMEZONE)
        now = datetime.now(tz)
        ai_advice = await generate_weekly_advice(db, now - timedelta(days=7), now)

        text = format_weekly_report(sales, returns, expenses, products, cash, ai_advice=ai_advice)

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
                    text=f"⚠️ <b>კვირის ანგარიში ვერ გაიგზავნა</b>\n<code>{html.escape(str(exc))}</code>",
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

    # Attach real-time audit logger — fire-and-forget, never blocks the bot
    db.audit = AuditLogger(pool=db.pool)
    logger.info("AuditLogger ready (local logging only)")

    await bot.set_my_commands([
        # ── ✏️ შეყვანა ────────────────────────────────
        BotCommand(command="new",           description="✏️ გაყიდვა / ნისია / ხარჯი"),
        # ── 💳 ნისია ──────────────────────────────────
        BotCommand(command="nisias",        description="💳 გადაუხდელი ნისიები"),
        # ── 📦 საწყობი ────────────────────────────────
        BotCommand(command="stock",         description="🏪 საწყობის მდგომარეობა"),
        BotCommand(command="addproduct",    description="➕ პროდუქტის დამატება"),
        BotCommand(command="import",        description="📂 Excel-ის იმპორტი — საწყისი ნაშთები"),
        BotCommand(command="orders",        description="📋 მომლოდინე შეკვეთები"),
        BotCommand(command="addorder",      description="📝 ახალი შეკვეთის დამატება — wizard"),
        # ── 💰 ანგარიში და ფული ───────────────────────
        BotCommand(command="report",        description="📊 კვირის ანგარიში"),
        BotCommand(command="report_period", description="📅 პერიოდის ანგარიში — კალენდარი"),
        BotCommand(command="cash",          description="💵 ხელზე — მიმდინარე ნაღდი ბალანსი"),
        BotCommand(command="deposit",       description="🏦 ბანკში შეტანა"),
        BotCommand(command="checksales",    description="🏢 შპს — ჩაუბეჭდავი ჩეკები"),
        # ── 🛒 კერძო შეკვეთები ───────────────────────
        BotCommand(command="po",            description="🛒 კერძო შეკვეთების სია"),
        BotCommand(command="addpo",         description="➕ ახალი კერძო შეკვეთა — wizard"),
        # ── 🔧 სისტემა ────────────────────────────────
        BotCommand(command="diagnostics",   description="🔍 ვერ ამოცნობილი შეტყობინებები"),
        BotCommand(command="help",          description="❓ გამოყენების სახელმძღვანელო"),
    ])
    logger.info("Bot commands menu registered.")

    storage: BaseStorage
    if config.REDIS_URL:
        from aiogram.fsm.storage.redis import RedisStorage  # type: ignore[import]
        storage = RedisStorage.from_url(config.REDIS_URL)
        logger.info("FSM storage: Redis (state persists across restarts)")
    else:
        storage = MemoryStorage()
        logger.info("FSM storage: MemoryStorage (set REDIS_URL for persistence)")

    dp = Dispatcher(storage=storage)
    dp.message.middleware(DatabaseMiddleware(db))
    dp.callback_query.middleware(DatabaseMiddleware(db))

    dp.include_router(wizard_router)
    dp.include_router(addorder_router)
    dp.include_router(personal_orders_router)
    dp.include_router(barcode_router)
    dp.include_router(sales_router)
    dp.include_router(orders_router)
    dp.include_router(period_router)
    dp.include_router(commands_router)
    dp.include_router(search_router)  # last: catches unhandled DM text as search

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
    scheduler.add_job(
        _purge_old_parse_failures,
        trigger=CronTrigger(hour=3, minute=0, timezone=tz),
        kwargs={"db": db},
        id="purge_parse_failures",
        replace_existing=True,
    )
    scheduler.add_job(
        _purge_expired_deleted_sales,
        trigger=CronTrigger(minute=30, timezone=tz),  # every hour at :30
        kwargs={"db": db},
        id="purge_deleted_sales",
        replace_existing=True,
    )
    scheduler.add_job(
        _run_integrity_check,
        trigger=CronTrigger(minute=45, timezone=tz),  # every hour at :45
        kwargs={"db": db, "bot": bot},
        id="audit_integrity_check",
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
