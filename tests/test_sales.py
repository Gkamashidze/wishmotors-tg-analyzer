"""Tests for bot/handlers/sales.py — pure helpers and handler paths."""
from __future__ import annotations

import os
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytz
import pytest

# Minimal env so config.py loads without errors
os.environ.setdefault("BOT_TOKEN", "test")
os.environ.setdefault("GROUP_ID", "1")
os.environ.setdefault("SALES_TOPIC_ID", "2")
os.environ.setdefault("ORDERS_TOPIC_ID", "3")
os.environ.setdefault("EXPENSES_TOPIC_ID", "4")
os.environ.setdefault("STOCK_TOPIC_ID", "5")
os.environ.setdefault("NISIAS_TOPIC_ID", "6")
os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost/test")
os.environ.setdefault("ADMIN_IDS", "12345")
os.environ.setdefault("TIMEZONE", "Asia/Tbilisi")

from bot.handlers.sales import (  # noqa: E402
    _delete_keyboard,
    _delete_keyboard_batch,
    _parse_backdate,
    _parse_import_date,
    _parse_import_payment,
    handle_sales_text,
)


# ─── _parse_backdate ──────────────────────────────────────────────────────────

class TestParseBackdate:
    def test_none_returns_none(self):
        assert _parse_backdate(None) is None

    def test_empty_string_returns_none(self):
        assert _parse_backdate("") is None
        assert _parse_backdate("   ") is None

    def test_datetime_naive_gets_utc(self):
        dt = datetime(2024, 3, 15, 10, 0)
        result = _parse_backdate(dt)
        assert result is not None
        assert result.tzinfo == timezone.utc
        assert result.year == 2024 and result.month == 3 and result.day == 15

    def test_datetime_aware_converts_to_utc(self):
        tz = pytz.timezone("Asia/Tbilisi")
        dt = tz.localize(datetime(2024, 3, 15, 12, 0))
        result = _parse_backdate(dt)
        assert result is not None
        assert result.tzinfo == timezone.utc

    def test_date_object_returns_midnight_utc(self):
        d = date(2024, 6, 1)
        result = _parse_backdate(d)
        assert result is not None
        assert result.year == 2024 and result.month == 6 and result.day == 1
        assert result.hour == 0 and result.minute == 0

    def test_iso_string_format(self):
        result = _parse_backdate("2024-03-15")
        assert result is not None
        assert result.year == 2024 and result.month == 3 and result.day == 15
        assert result.tzinfo == timezone.utc

    def test_dotted_dmy_format(self):
        result = _parse_backdate("15.03.2024")
        assert result is not None
        assert result.year == 2024 and result.month == 3 and result.day == 15

    def test_slash_dmy_format(self):
        result = _parse_backdate("15/03/2024")
        assert result is not None
        assert result.year == 2024 and result.month == 3 and result.day == 15

    def test_slash_ymd_format(self):
        result = _parse_backdate("2024/03/15")
        assert result is not None
        assert result.year == 2024 and result.month == 3 and result.day == 15

    def test_unparseable_string_returns_none(self):
        assert _parse_backdate("not-a-date") is None
        assert _parse_backdate("32.13.2024") is None

    def test_integer_value_returns_none(self):
        # Integers can't match any date format after str()
        assert _parse_backdate(99999) is None


# ─── _delete_keyboard ─────────────────────────────────────────────────────────

class TestDeleteKeyboard:
    def test_single_button_callback_data(self):
        kb = _delete_keyboard(42)
        assert len(kb.inline_keyboard) == 1
        assert kb.inline_keyboard[0][0].callback_data == "ds:42"

    def test_button_text_contains_sale_id(self):
        kb = _delete_keyboard(7)
        assert "7" in kb.inline_keyboard[0][0].text

    def test_batch_keyboard_pairs_per_row(self):
        kb = _delete_keyboard_batch([1, 2, 3, 4, 5])
        # 5 items → rows of 2: [1,2], [3,4], [5]
        assert len(kb.inline_keyboard) == 3
        assert len(kb.inline_keyboard[0]) == 2
        assert len(kb.inline_keyboard[2]) == 1

    def test_batch_keyboard_callback_data(self):
        kb = _delete_keyboard_batch([10, 20])
        assert kb.inline_keyboard[0][0].callback_data == "ds:10"
        assert kb.inline_keyboard[0][1].callback_data == "ds:20"

    def test_batch_keyboard_empty_list(self):
        kb = _delete_keyboard_batch([])
        assert kb.inline_keyboard == []


# ─── _parse_import_payment ────────────────────────────────────────────────────

class TestParseImportPayment:
    def test_cash_default(self):
        assert _parse_import_payment("ნაღდი") == "cash"
        assert _parse_import_payment("") == "cash"
        assert _parse_import_payment("სხვა") == "cash"

    def test_transfer_keywords(self):
        assert _parse_import_payment("გადარიცხვა") == "transfer"
        assert _parse_import_payment("Transfer") == "transfer"
        assert _parse_import_payment("ბარათი") == "transfer"
        assert _parse_import_payment("კარტი") == "transfer"
        assert _parse_import_payment("card") == "transfer"
        assert _parse_import_payment("დარიცხა") == "transfer"

    def test_credit_keywords(self):
        assert _parse_import_payment("ნისია") == "credit"
        assert _parse_import_payment("credit") == "credit"

    def test_case_insensitive(self):
        assert _parse_import_payment("TRANSFER") == "transfer"
        assert _parse_import_payment("CREDIT") == "credit"


# ─── _parse_import_date ───────────────────────────────────────────────────────

class TestParseImportDate:
    _TZ = pytz.timezone("Asia/Tbilisi")

    def test_datetime_input_localizes(self):
        dt = datetime(2024, 5, 1, 12, 0)
        result = _parse_import_date(dt, self._TZ)
        assert result.tzinfo is not None

    def test_date_input_gives_midnight(self):
        d = date(2024, 5, 1)
        result = _parse_import_date(d, self._TZ)
        assert result.hour == 0 and result.minute == 0

    def test_dmy_dot_format(self):
        result = _parse_import_date("01.05.2024", self._TZ)
        assert result.year == 2024 and result.month == 5 and result.day == 1

    def test_iso_format(self):
        result = _parse_import_date("2024-05-01", self._TZ)
        assert result.year == 2024 and result.month == 5

    def test_invalid_raises(self):
        with pytest.raises(ValueError, match="თარიღი ვერ წაიკითხა"):
            _parse_import_date("not-a-date", self._TZ)


# ─── handle_sales_text ────────────────────────────────────────────────────────

def _make_message(text: str, user_id: int = 12345) -> MagicMock:
    msg = MagicMock()
    msg.text = text
    msg.from_user = MagicMock(id=user_id)
    msg.bot = MagicMock()
    msg.bot.send_message = AsyncMock()
    return msg


def _make_db() -> MagicMock:
    db = MagicMock()
    db.get_product_by_oem = AsyncMock(return_value=None)
    db.get_product_by_partial_oem = AsyncMock(return_value=None)
    db.get_product_by_name = AsyncMock(return_value=None)
    db.create_sale = AsyncMock(return_value=(1, 10))
    db.log_parse_failure = AsyncMock()
    db.update_sale_topic_message = AsyncMock()
    db.has_active_order_for_product = AsyncMock(return_value=False)
    db.create_order = AsyncMock()
    return db


def _make_product(
    product_id: int = 1,
    name: str = "სარკე",
    oem: str = "12345",
    stock: int = 10,
    min_stock: int = 5,
) -> dict:
    return {
        "id": product_id, "name": name, "oem_code": oem,
        "current_stock": stock, "min_stock": min_stock, "unit_price": 30.0,
    }


class TestHandleSalesText:
    @pytest.mark.asyncio
    async def test_parse_failure_logs_and_returns_silently(self):
        """Unparseable text: log_parse_failure called, no send_message to user."""
        msg = _make_message("gibberish text nobody")
        db = _make_db()

        with patch("bot.handlers.sales.parse_sale_message", return_value=None), \
             patch("bot.handlers.sales.parse_dual_sale_message", return_value=None), \
             patch("bot.handlers.barcode.bc_consume", new_callable=AsyncMock, return_value=None):
            await handle_sales_text(msg, db)

        db.log_parse_failure.assert_awaited_once()
        msg.bot.send_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_known_product_sale_records_and_confirms(self):
        """Happy path: product found by OEM → create_sale called, confirmation sent."""
        msg = _make_message("12345 1ც 50₾")
        db = _make_db()
        product = _make_product(stock=9, min_stock=5)
        db.get_product_by_oem = AsyncMock(return_value=product)
        db.create_sale = AsyncMock(return_value=(42, 9))

        parsed = MagicMock()
        parsed.raw_product = "12345"
        parsed.quantity = 1
        parsed.price = 50.0
        parsed.payment_method = "cash"
        parsed.seller_type = "llc"
        parsed.buyer_type = "retail"
        parsed.customer_name = None
        parsed.debt_client = None
        parsed.is_debt = False
        parsed.is_return = False

        with patch("bot.handlers.sales.parse_sale_message", return_value=parsed), \
             patch("bot.handlers.sales.parse_dual_sale_message", return_value=None):
            await handle_sales_text(msg, db)

        db.create_sale.assert_awaited_once()
        msg.bot.send_message.assert_called()

    @pytest.mark.asyncio
    async def test_product_not_found_records_freeform_sale(self):
        """Product not found → freeform sale path, no error sent to user."""
        msg = _make_message("უცნობი პროდუქტი 1ც 20₾")
        db = _make_db()
        # All product lookups return None
        db.create_sale = AsyncMock(return_value=(99, 0))

        parsed = MagicMock()
        parsed.raw_product = "უცნობი"
        parsed.quantity = 1
        parsed.price = 20.0
        parsed.payment_method = "cash"
        parsed.seller_type = "llc"
        parsed.buyer_type = "retail"
        parsed.customer_name = None
        parsed.debt_client = None
        parsed.is_debt = False
        parsed.is_return = False
        parsed.is_split_payment = False

        with patch("bot.handlers.sales.parse_sale_message", return_value=parsed), \
             patch("bot.handlers.sales.parse_dual_sale_message", return_value=None), \
             patch("bot.handlers.barcode.bc_consume", new_callable=AsyncMock, return_value=None), \
             patch("bot.handlers.sales.format_sale_confirmation", return_value="OK"):
            await handle_sales_text(msg, db)

        db.create_sale.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_return_for_unknown_product_sends_error_dm(self):
        """Return with no matching product → error DM sent, nothing recorded."""
        msg = _make_message("დაბრუნება 99999 1ც")
        db = _make_db()

        parsed = MagicMock()
        parsed.raw_product = "99999"
        parsed.is_return = True

        with patch("bot.handlers.sales.parse_sale_message", return_value=parsed), \
             patch("bot.handlers.sales.parse_dual_sale_message", return_value=None), \
             patch("bot.handlers.barcode.bc_consume", new_callable=AsyncMock, return_value=None):
            await handle_sales_text(msg, db)

        msg.bot.send_message.assert_called_once()
        error_text = msg.bot.send_message.call_args[1]["text"]
        assert "99999" in error_text or "99999" in str(msg.bot.send_message.call_args)
        db.create_sale.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_unexpected_exception_sends_error_dm(self):
        """Unexpected exception in handler → generic error DM, no crash."""
        msg = _make_message("12345 1ც 50₾")
        db = _make_db()
        db.get_product_by_oem = AsyncMock(side_effect=RuntimeError("DB down"))

        parsed = MagicMock()
        parsed.raw_product = "12345"
        parsed.is_return = False

        with patch("bot.handlers.sales.parse_sale_message", return_value=parsed), \
             patch("bot.handlers.sales.parse_dual_sale_message", return_value=None), \
             patch("bot.handlers.barcode.bc_consume", new_callable=AsyncMock, return_value=None):
            await handle_sales_text(msg, db)

        # Must send an error DM, not crash
        msg.bot.send_message.assert_called_once()
        assert "შეცდომა" in msg.bot.send_message.call_args[1]["text"]

    @pytest.mark.asyncio
    async def test_low_stock_triggers_auto_order(self):
        """After sale stock ≤ min_stock → auto-order created and notification sent."""
        msg = _make_message("12345 5ც 50₾")
        db = _make_db()
        product = _make_product(stock=3, min_stock=5)
        db.get_product_by_oem = AsyncMock(return_value=product)
        db.create_sale = AsyncMock(return_value=(10, 3))
        db.has_active_order_for_product = AsyncMock(return_value=False)

        parsed = MagicMock()
        parsed.raw_product = "12345"
        parsed.quantity = 5
        parsed.price = 50.0
        parsed.payment_method = "cash"
        parsed.seller_type = "llc"
        parsed.buyer_type = "retail"
        parsed.customer_name = None
        parsed.debt_client = None
        parsed.is_debt = False
        parsed.is_return = False

        with patch("bot.handlers.sales.parse_sale_message", return_value=parsed), \
             patch("bot.handlers.sales.parse_dual_sale_message", return_value=None), \
             patch("bot.handlers.sales.format_sale_confirmation", return_value="OK"), \
             patch("bot.handlers.sales.format_topic_sale", return_value="OK"):
            await handle_sales_text(msg, db)

        db.create_order.assert_awaited_once()
        # Two send_message calls: confirmation + low-stock alert
        assert msg.bot.send_message.call_count >= 2
