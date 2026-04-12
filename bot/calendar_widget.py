"""
Minimal inline calendar widget for aiogram 3.
Replaces aiogram3-calendar (broken dependency on Python 3.12).

Public API (drop-in replacement):
    from bot.calendar_widget import SimpleCalendar, simple_cal_callback
"""

import calendar
from datetime import datetime

from aiogram.filters.callback_data import CallbackData
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

_MONTH_NAMES = [
    "იანვარი", "თებერვალი", "მარტი", "აპრილი",
    "მაისი", "ივნისი", "ივლისი", "აგვისტო",
    "სექტემბერი", "ოქტომბერი", "ნოემბერი", "დეკემბერი",
]
_DAY_NAMES = ["ორ", "სა", "ოთ", "ხუ", "პა", "შა", "კვ"]


class SimpleCalCallback(CallbackData, prefix="scal"):
    act: str   # "day" | "prev" | "next" | "ignore"
    year: int
    month: int
    day: int


# Alias so handlers can write `callback_data: simple_cal_callback` just like before
simple_cal_callback = SimpleCalCallback


class SimpleCalendar:
    """Inline keyboard calendar.  Usage matches aiogram3-calendar's SimpleCalendar."""

    async def start_calendar(
        self, year: int | None = None, month: int | None = None
    ) -> InlineKeyboardMarkup:
        now = datetime.now()
        return self._build(year or now.year, month or now.month)

    def _build(self, year: int, month: int) -> InlineKeyboardMarkup:
        def btn(text: str, act: str, y: int, m: int, d: int) -> InlineKeyboardButton:
            return InlineKeyboardButton(
                text=text,
                callback_data=SimpleCalCallback(act=act, year=y, month=m, day=d).pack(),
            )

        def ignore(label: str) -> InlineKeyboardButton:
            return btn(label, "ignore", year, month, 0)

        prev_y, prev_m = (year - 1, 12) if month == 1 else (year, month - 1)
        next_y, next_m = (year + 1, 1) if month == 12 else (year, month + 1)

        rows: list[list[InlineKeyboardButton]] = [
            # Navigation row
            [
                btn("◀️", "prev", prev_y, prev_m, 1),
                ignore(f"{_MONTH_NAMES[month - 1]} {year}"),
                btn("▶️", "next", next_y, next_m, 1),
            ],
            # Weekday labels
            [ignore(d) for d in _DAY_NAMES],
        ]

        for week in calendar.monthcalendar(year, month):
            row = []
            for day in week:
                if day == 0:
                    row.append(ignore(" "))
                else:
                    row.append(btn(str(day), "day", year, month, day))
            rows.append(row)

        return InlineKeyboardMarkup(inline_keyboard=rows)

    async def process_selection(
        self, callback, callback_data: SimpleCalCallback
    ) -> tuple[bool, datetime | None]:
        """Returns (selected, date). Handles navigation internally."""
        if callback_data.act == "ignore":
            await callback.answer()
            return False, None

        if callback_data.act in ("prev", "next"):
            await callback.message.edit_reply_markup(
                reply_markup=self._build(callback_data.year, callback_data.month)
            )
            await callback.answer()
            return False, None

        if callback_data.act == "day":
            await callback.answer()
            return True, datetime(callback_data.year, callback_data.month, callback_data.day)

        await callback.answer()
        return False, None
