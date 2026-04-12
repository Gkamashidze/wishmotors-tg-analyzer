"""
Period report handler with inline calendar UI.
Flow:
  /report_period → quick-option buttons OR calendar picker
  Calendar: pick start date → pick end date → send report
"""

import logging
from datetime import datetime, timedelta

import pytz
from aiogram import Router
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    CallbackQuery,
    InaccessibleMessage,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)
from bot.calendar_widget import SimpleCalendar, simple_cal_callback

import config
from bot.handlers import IsAdmin
from bot.reports.formatter import format_period_report
from database.db import Database

logger = logging.getLogger(__name__)
period_router = Router(name="period_report")

_PARSE = "HTML"


class PeriodState(StatesGroup):
    waiting_start = State()
    waiting_end = State()


def _quick_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="📅 ბოლო 7 დღე",    callback_data="qperiod:week"),
            InlineKeyboardButton(text="🗓 მიმდინარე თვე", callback_data="qperiod:month"),
        ],
        [
            InlineKeyboardButton(text="◀️ გასული თვე", callback_data="qperiod:lastmonth"),
        ],
        [
            InlineKeyboardButton(text="📆 კონკრეტული თარიღები", callback_data="qperiod:custom"),
        ],
    ])


# ─── /report_period command ───────────────────────────────────────────────────

@period_router.message(Command("report_period"), IsAdmin())
async def cmd_report_period(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.bot.send_message(
        chat_id=message.from_user.id,
        text="📊 <b>პერიოდის ანგარიში</b>\n\nაირჩიე პერიოდი:",
        reply_markup=_quick_menu(),
        parse_mode=_PARSE,
    )


# ─── Quick-option buttons ─────────────────────────────────────────────────────

@period_router.callback_query(lambda c: c.data and c.data.startswith("qperiod:"), IsAdmin())
async def handle_quick_period(
    callback: CallbackQuery, db: Database, state: FSMContext
) -> None:
    period = callback.data.split(":")[1]
    tz = pytz.timezone(config.TIMEZONE)
    now = datetime.now(tz)

    if period == "custom":
        await state.set_state(PeriodState.waiting_start)
        if isinstance(callback.message, InaccessibleMessage):
            await callback.answer()
            return
        await callback.message.edit_text(
            "📆 <b>საწყისი თარიღი</b>\n\nაირჩიე საწყისი თარიღი:",
            reply_markup=await SimpleCalendar().start_calendar(),
            parse_mode=_PARSE,
        )
        await callback.answer()
        return

    if period == "week":
        date_from = now - timedelta(days=7)
        date_to = now
    elif period == "month":
        date_from = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        date_to = now
    elif period == "lastmonth":
        first_this = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        last_prev = first_this - timedelta(seconds=1)
        date_from = last_prev.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        date_to = last_prev.replace(hour=23, minute=59, second=59, microsecond=0)
    else:
        await callback.answer("უცნობი პერიოდი")
        return

    if isinstance(callback.message, InaccessibleMessage):
        await callback.answer()
        return

    await callback.message.edit_text("⏳ ანგარიში მუშავდება...", parse_mode=_PARSE)

    sales = await db.get_sales_by_period(date_from, date_to)
    returns = await db.get_returns_by_period(date_from, date_to)
    expenses = await db.get_expenses_by_period(date_from, date_to)
    products = await db.get_all_products()

    text = format_period_report(sales, returns, expenses, products, date_from, date_to)
    await callback.message.edit_text(text, parse_mode=_PARSE)
    await callback.answer()


# ─── Calendar: start date ─────────────────────────────────────────────────────

@period_router.callback_query(
    simple_cal_callback.filter(), StateFilter(PeriodState.waiting_start), IsAdmin()
)
async def process_start_date(
    callback: CallbackQuery,
    callback_data: simple_cal_callback,
    state: FSMContext,
) -> None:
    selected, date = await SimpleCalendar().process_selection(callback, callback_data)
    if not selected:
        return

    tz = pytz.timezone(config.TIMEZONE)
    date_from = tz.localize(date.replace(hour=0, minute=0, second=0, microsecond=0))
    await state.update_data(start=date_from.isoformat())
    await state.set_state(PeriodState.waiting_end)

    if isinstance(callback.message, InaccessibleMessage):
        await callback.answer()
        return

    await callback.message.answer(
        f"📆 <b>საბოლოო თარიღი</b>\n"
        f"✅ საწყისი: <b>{date_from.strftime('%d.%m.%Y')}</b>\n\n"
        f"ახლა აირჩიე საბოლოო თარიღი:",
        reply_markup=await SimpleCalendar().start_calendar(),
        parse_mode=_PARSE,
    )


# ─── Calendar: end date ───────────────────────────────────────────────────────

@period_router.callback_query(
    simple_cal_callback.filter(), StateFilter(PeriodState.waiting_end), IsAdmin()
)
async def process_end_date(
    callback: CallbackQuery,
    callback_data: simple_cal_callback,
    state: FSMContext,
    db: Database,
) -> None:
    selected, date = await SimpleCalendar().process_selection(callback, callback_data)
    if not selected:
        return

    tz = pytz.timezone(config.TIMEZONE)
    date_to = tz.localize(date.replace(hour=23, minute=59, second=59, microsecond=0))

    data = await state.get_data()
    date_from = datetime.fromisoformat(data["start"])
    await state.clear()

    if isinstance(callback.message, InaccessibleMessage):
        await callback.answer()
        return

    if date_from > date_to:
        await callback.message.answer(
            "⚠️ საბოლოო თარიღი საწყისზე ადრეა. სცადე თავიდან: /report_period",
            parse_mode=_PARSE,
        )
        await callback.answer()
        return

    loading = await callback.message.answer("⏳ ანგარიში მუშავდება...", parse_mode=_PARSE)

    sales = await db.get_sales_by_period(date_from, date_to)
    returns = await db.get_returns_by_period(date_from, date_to)
    expenses = await db.get_expenses_by_period(date_from, date_to)
    products = await db.get_all_products()

    text = format_period_report(sales, returns, expenses, products, date_from, date_to)
    await loading.edit_text(text, parse_mode=_PARSE)
    await callback.answer()
