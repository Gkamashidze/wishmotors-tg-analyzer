"""
Handler integration tests.

Tests orchestration logic in bot/handlers — argument parsing, DB dispatch,
and reply content. Uses AsyncMock for both the Telegram Bot object and
Database to avoid any real network or DB connections.
"""

import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# Minimal env so config.py loads without errors
os.environ.setdefault("BOT_TOKEN", "test")
os.environ.setdefault("GROUP_ID", "1")
os.environ.setdefault("SALES_TOPIC_ID", "2")
os.environ.setdefault("ORDERS_TOPIC_ID", "3")
os.environ.setdefault("EXPENSES_TOPIC_ID", "4")
os.environ.setdefault("CAPITAL_TOPIC_ID", "5")
os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost/test")
os.environ.setdefault("ADMIN_IDS", "12345")
os.environ.setdefault("TIMEZONE", "Asia/Tbilisi")

from bot.handlers.commands import (
    cmd_addproduct,
    cmd_deletesale,
    cmd_editproduct,
)
from bot.handlers.orders import handle_expense_message, handle_order_message

pytestmark = pytest.mark.asyncio

_USER_ID = 12345


def _msg(text: str, user_id: int = _USER_ID) -> MagicMock:
    """Build a minimal mock Message suitable for handler calls."""
    msg = MagicMock()
    msg.text = text
    msg.from_user = MagicMock()
    msg.from_user.id = user_id
    msg.bot = AsyncMock()
    return msg


def _db(**overrides) -> MagicMock:
    """Build a minimal mock Database. Pass keyword overrides to replace defaults."""
    db = MagicMock()
    db.get_product_by_oem = AsyncMock(return_value=None)
    db.get_product_by_name = AsyncMock(return_value=None)
    db.get_product_by_id = AsyncMock(return_value=None)
    db.create_order = AsyncMock(return_value=1)
    db.complete_order = AsyncMock(return_value=True)
    db.log_parse_failure = AsyncMock()
    db.create_expense = AsyncMock(return_value=1)
    db.delete_sale = AsyncMock(return_value=None)
    db.create_product = AsyncMock(return_value=42)
    db.edit_product = AsyncMock(return_value=None)
    db.mark_sale_paid = AsyncMock(return_value=False)
    for k, v in overrides.items():
        setattr(db, k, v)
    return db


def _sent_text(msg: MagicMock, call_index: int = 0) -> str:
    """Extract the 'text' kwarg from the Nth bot.send_message call."""
    return msg.bot.send_message.call_args_list[call_index][1]["text"]


# ─── handle_order_message ──────────────────────────────────────────────────────

class TestHandleOrderMessage:
    async def test_parse_failure_logs_and_does_not_create_order(self):
        """Expense-format text in orders topic → parse failure logged, no order."""
        msg = _msg("50₾ ბენზინი")  # valid expense, invalid order
        db = _db()
        await handle_order_message(msg, db)
        db.log_parse_failure.assert_called_once()
        db.create_order.assert_not_called()

    async def test_quantity_zero_sends_warning_no_db_write(self):
        """Product-only message (qty=0) → warning sent, no order created."""
        msg = _msg("მარჭვენა სარკე")  # product name only → quantity=0
        db = _db()
        await handle_order_message(msg, db)
        db.create_order.assert_not_called()
        msg.bot.send_message.assert_called_once()
        assert "რაოდენობა" in _sent_text(msg)

    async def test_valid_order_unknown_product_uses_null_product_id(self):
        """Product not in DB → order created with product_id=None."""
        msg = _msg("8390132500 3ც")
        db = _db()  # both lookups return None
        await handle_order_message(msg, db)
        db.create_order.assert_called_once()
        kwargs = db.create_order.call_args[1]
        assert kwargs["product_id"] is None
        assert kwargs["quantity_needed"] == 3

    async def test_valid_order_known_product_passes_correct_product_id(self):
        """Product found in DB → order created with its id."""
        product = {"id": 7, "name": "სარკე", "oem_code": "8390132500"}
        msg = _msg("8390132500 2ც")
        db = _db(get_product_by_oem=AsyncMock(return_value=product))
        await handle_order_message(msg, db)
        db.create_order.assert_called_once()
        kwargs = db.create_order.call_args[1]
        assert kwargs["product_id"] == 7
        assert kwargs["quantity_needed"] == 2


# ─── handle_expense_message ───────────────────────────────────────────────────

class TestHandleExpenseMessage:
    async def test_parse_failure_logs_and_does_not_create_expense(self):
        """Text with no price or currency in expenses topic → parse failure logged."""
        msg = _msg("სარკე 1ც")  # order format — no currency symbol → None from parse_expense_message
        db = _db()
        await handle_expense_message(msg, db)
        db.log_parse_failure.assert_called_once()
        db.create_expense.assert_not_called()

    async def test_valid_expense_calls_create_with_parsed_values(self):
        """Valid expense → db.create_expense called with correct amount + description."""
        msg = _msg("50₾ ბენზინი")
        db = _db()
        await handle_expense_message(msg, db)
        db.create_expense.assert_called_once()
        kwargs = db.create_expense.call_args[1]
        assert kwargs["amount"] == 50.0
        assert kwargs["description"] == "ბენზინი"

    async def test_expense_confirmation_contains_amount_and_header(self):
        """Confirmation DM is sent after recording the expense."""
        msg = _msg("20₾ საბაჟო")
        db = _db()
        await handle_expense_message(msg, db)
        msg.bot.send_message.assert_called_once()
        text = _sent_text(msg)
        assert "ხარჯი დაფიქსირდა" in text
        assert "20.00₾" in text


# ─── cmd_deletesale ───────────────────────────────────────────────────────────

class TestCmdDeleteSale:
    @patch("bot.handlers.commands.is_rate_limited", return_value=False)
    async def test_missing_id_sends_usage_hint(self, _rl):
        msg = _msg("/deletesale")
        db = _db()
        await cmd_deletesale(msg, db)
        db.delete_sale.assert_not_called()
        assert "ფორმატი" in _sent_text(msg)

    @patch("bot.handlers.commands.is_rate_limited", return_value=False)
    async def test_not_found_sends_warning(self, _rl):
        msg = _msg("/deletesale 99")
        db = _db(delete_sale=AsyncMock(return_value=None))
        await cmd_deletesale(msg, db)
        assert "ვერ მოიძებნა" in _sent_text(msg)

    @patch("bot.handlers.commands.is_rate_limited", return_value=False)
    async def test_found_sale_sends_confirmation_with_total(self, _rl):
        deleted = {"product_id": None, "quantity": 2, "unit_price": 30.0, "notes": "სარკე"}
        msg = _msg("/deletesale 5")
        db = _db(delete_sale=AsyncMock(return_value=deleted))
        await cmd_deletesale(msg, db)
        text = _sent_text(msg)
        assert "წაიშალა" in text
        assert "60.00₾" in text

    @patch("bot.handlers.commands.is_rate_limited", return_value=False)
    async def test_html_chars_in_notes_are_escaped(self, _rl):
        """Notes with < > characters must not break Telegram HTML parsing."""
        deleted = {
            "product_id": None,
            "quantity": 1,
            "unit_price": 10.0,
            "notes": "<script>alert(1)</script>",
        }
        msg = _msg("/deletesale 1")
        db = _db(delete_sale=AsyncMock(return_value=deleted))
        await cmd_deletesale(msg, db)
        text = _sent_text(msg)
        assert "<script>" not in text
        assert "&lt;script&gt;" in text

    @patch("bot.handlers.commands.is_rate_limited", return_value=False)
    async def test_product_stock_restored_note_shown(self, _rl):
        """When sale has a product_id, stock-restored note appears."""
        deleted = {"product_id": 3, "quantity": 1, "unit_price": 15.0, "notes": None}
        msg = _msg("/deletesale 2")
        db = _db(delete_sale=AsyncMock(return_value=deleted))
        await cmd_deletesale(msg, db)
        assert "მარაგი აღდგა" in _sent_text(msg)


# ─── cmd_addproduct ───────────────────────────────────────────────────────────

class TestCmdAddProduct:
    @patch("bot.handlers.commands.is_rate_limited", return_value=False)
    async def test_too_few_args_sends_usage_hint(self, _rl):
        msg = _msg("/addproduct სარკე")
        db = _db()
        await cmd_addproduct(msg, db)
        db.create_product.assert_not_called()
        assert "ფორმატი" in _sent_text(msg)

    @patch("bot.handlers.commands.is_rate_limited", return_value=False)
    async def test_negative_price_rejected(self, _rl):
        msg = _msg("/addproduct სარკე OEM123 10 -5")
        db = _db()
        await cmd_addproduct(msg, db)
        db.create_product.assert_not_called()

    @patch("bot.handlers.commands.is_rate_limited", return_value=False)
    async def test_duplicate_product_blocks_creation(self, _rl):
        existing = {"id": 3, "name": "სარკე"}
        msg = _msg("/addproduct სარკე OEM123 10 30")
        db = _db(get_product_by_oem=AsyncMock(return_value=existing))
        await cmd_addproduct(msg, db)
        db.create_product.assert_not_called()
        assert "უკვე არსებობს" in _sent_text(msg)

    @patch("bot.handlers.commands.is_rate_limited", return_value=False)
    async def test_valid_product_creates_and_confirms(self, _rl):
        msg = _msg("/addproduct სარკე OEM123 10 30")
        db = _db()
        await cmd_addproduct(msg, db)
        db.create_product.assert_called_once()
        assert "დამატებულია" in _sent_text(msg)

    @patch("bot.handlers.commands.is_rate_limited", return_value=False)
    async def test_html_chars_in_name_are_escaped_in_confirmation(self, _rl):
        """Product name with < > must not break HTML in the confirmation."""
        msg = _msg("/addproduct Mirror<L> OEM123 10 30")
        db = _db()
        await cmd_addproduct(msg, db)
        text = _sent_text(msg)
        assert "<L>" not in text
        assert "&lt;L&gt;" in text


# ─── cmd_editproduct ──────────────────────────────────────────────────────────

class TestCmdEditProduct:
    @patch("bot.handlers.commands.is_rate_limited", return_value=False)
    async def test_product_not_found_sends_warning(self, _rl):
        msg = _msg("/editproduct 999 name სარკე")
        db = _db(get_product_by_id=AsyncMock(return_value=None))
        await cmd_editproduct(msg, db)
        db.edit_product.assert_not_called()
        assert "ვერ მოიძებნა" in _sent_text(msg)

    @patch("bot.handlers.commands.is_rate_limited", return_value=False)
    async def test_unknown_field_sends_error(self, _rl):
        product = {"id": 1, "name": "სარკე"}
        msg = _msg("/editproduct 1 color red")
        db = _db(get_product_by_id=AsyncMock(return_value=product))
        await cmd_editproduct(msg, db)
        db.edit_product.assert_not_called()
        assert "უცნობი ველი" in _sent_text(msg)

    @patch("bot.handlers.commands.is_rate_limited", return_value=False)
    async def test_invalid_price_value_sends_error(self, _rl):
        product = {"id": 1, "name": "სარკე"}
        msg = _msg("/editproduct 1 price abc")
        db = _db(get_product_by_id=AsyncMock(return_value=product))
        await cmd_editproduct(msg, db)
        db.edit_product.assert_not_called()
        assert "არასწორია" in _sent_text(msg)

    @patch("bot.handlers.commands.is_rate_limited", return_value=False)
    async def test_html_chars_in_name_value_are_escaped(self, _rl):
        """Editing product name to a value with < > must escape both in field_label
        and in the updated['name'] line of the confirmation."""
        product = {"id": 1, "name": "სარკე"}
        updated = {"id": 1, "name": "<Mirror>"}
        msg = _msg("/editproduct 1 name <Mirror>")
        db = _db(
            get_product_by_id=AsyncMock(return_value=product),
            edit_product=AsyncMock(return_value=updated),
        )
        await cmd_editproduct(msg, db)
        text = _sent_text(msg)
        assert "<Mirror>" not in text
        assert "&lt;Mirror&gt;" in text

    @patch("bot.handlers.commands.is_rate_limited", return_value=False)
    async def test_valid_price_edit_confirms_with_formatted_price(self, _rl):
        product = {"id": 2, "name": "ნათურა"}
        updated = {"id": 2, "name": "ნათურა"}
        msg = _msg("/editproduct 2 price 45.50")
        db = _db(
            get_product_by_id=AsyncMock(return_value=product),
            edit_product=AsyncMock(return_value=updated),
        )
        await cmd_editproduct(msg, db)
        db.edit_product.assert_called_once_with(2, price=45.5)
        assert "45.50₾" in _sent_text(msg)
