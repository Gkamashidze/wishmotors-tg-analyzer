"""
Handler integration tests.

Tests orchestration logic in bot/handlers — argument parsing, DB dispatch,
and reply content. Uses AsyncMock for both the Telegram Bot object and
Database to avoid any real network or DB connections.
"""

import os
from unittest.mock import AsyncMock, MagicMock, patch

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

from bot.handlers.commands import (  # noqa: E402
    cmd_addproduct,
    cmd_deletesale,
    cmd_editproduct,
)
from bot.handlers.orders import handle_expense_message, handle_order_message  # noqa: E402


_USER_ID = 12345


def _msg(text: str, user_id: int = _USER_ID) -> MagicMock:
    """Build a minimal mock Message suitable for handler calls."""
    msg = MagicMock()
    msg.text = text
    msg.from_user = MagicMock()
    msg.from_user.id = user_id
    msg.bot = AsyncMock()
    msg.answer = AsyncMock()
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
        # Handler now sends DM + topic mirror (2 calls)
        assert msg.bot.send_message.call_count >= 1
        first_call_kwargs = msg.bot.send_message.call_args_list[0].kwargs
        text = first_call_kwargs.get("text", "")
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
# cmd_addproduct is now a wizard entry: it clears FSM state and asks for
# the product name as step 1/5.  All inline-arg tests are replaced accordingly.

def _async_state() -> AsyncMock:
    """Build a minimal FSMContext mock where every method is awaitable."""
    state = AsyncMock()
    state.clear = AsyncMock()
    state.set_state = AsyncMock()
    return state


class TestCmdAddProduct:
    async def test_clears_state_and_asks_for_oem(self):
        msg = _msg("/addproduct")
        state = _async_state()
        await cmd_addproduct(msg, state)
        state.clear.assert_called_once()
        state.set_state.assert_called_once()
        text = _sent_text(msg)
        assert "OEM" in text

    async def test_sends_to_private_dm(self):
        """Handler must DM the user, not reply in-group."""
        msg = _msg("/addproduct")
        state = _async_state()
        await cmd_addproduct(msg, state)
        msg.bot.send_message.assert_called_once()
        kwargs = msg.bot.send_message.call_args[1]
        assert kwargs["chat_id"] == _USER_ID

    async def test_step_label_is_first_of_five(self):
        msg = _msg("/addproduct")
        state = _async_state()
        await cmd_addproduct(msg, state)
        assert "1/5" in _sent_text(msg)


# ─── cmd_editproduct ──────────────────────────────────────────────────────────
# cmd_editproduct is now a wizard entry: it clears FSM state and asks for
# an OEM/name search term as step 1.

class TestCmdEditProduct:
    async def test_clears_state_and_asks_for_oem(self):
        msg = _msg("/editproduct")
        state = _async_state()
        await cmd_editproduct(msg, state)
        state.clear.assert_called_once()
        state.set_state.assert_called_once()
        text = _sent_text(msg)
        assert "OEM" in text

    async def test_sends_to_private_dm(self):
        msg = _msg("/editproduct")
        state = _async_state()
        await cmd_editproduct(msg, state)
        msg.bot.send_message.assert_called_once()
        kwargs = msg.bot.send_message.call_args[1]
        assert kwargs["chat_id"] == _USER_ID


# ─── AddOrder wizard ──────────────────────────────────────────────────────────

from bot.handlers.addorder import (  # noqa: E402
    AddOrderWizard,
    cmd_addorder,
    on_oem_input,
    on_name_qty_input,
    _parse_name_qty,
)


def _state_mock(data=None) -> AsyncMock:
    state = AsyncMock()
    state.get_data = AsyncMock(return_value=data or {})
    state.update_data = AsyncMock()
    state.set_state = AsyncMock()
    state.clear = AsyncMock()
    state.set_data = AsyncMock()
    return state


class TestParseNameQty:
    def test_name_and_qty_trailing_int(self):
        name, qty = _parse_name_qty("უკანა სუხო 3")
        assert name == "უკანა სუხო"
        assert qty == 3

    def test_name_only_returns_none_qty(self):
        name, qty = _parse_name_qty("უკანა სუხო")
        assert name == "უკანა სუხო"
        assert qty is None

    def test_zero_qty_treated_as_name_only(self):
        _, qty = _parse_name_qty("სარკე 0")
        assert qty is None

    def test_negative_qty_treated_as_name_only(self):
        _, qty = _parse_name_qty("სარკე -1")
        assert qty is None

    def test_single_word_name_with_qty(self):
        name, qty = _parse_name_qty("სარკე 10")
        assert name == "სარკე"
        assert qty == 10


class TestCmdAddorder:
    async def test_clears_state_and_asks_for_oem(self):
        msg = _msg("/addorder")
        state = _state_mock({"items": []})
        await cmd_addorder(msg, state)
        state.clear.assert_called_once()
        text = msg.answer.call_args[0][0]
        assert "OEM" in text

    async def test_prompt_contains_step_label(self):
        msg = _msg("/addorder")
        state = _state_mock({"items": []})
        await cmd_addorder(msg, state)
        text = msg.answer.call_args[0][0]
        assert "ნივთი #1" in text


class TestOnOemInput:
    async def test_valid_oem_advances_to_name_step(self):
        msg = _msg("4571234000")
        state = _state_mock({"items": []})
        await on_oem_input(msg, state)
        state.set_state.assert_called_once_with(AddOrderWizard.name)

    async def test_invalid_oem_with_special_chars_sends_warning(self):
        msg = _msg("!@#$")
        state = _state_mock({"items": []})
        await on_oem_input(msg, state)
        state.set_state.assert_not_called()
        text = msg.answer.call_args[0][0]
        assert "ციფრებს" in text

    async def test_short_oem_under_four_digits_rejected(self):
        msg = _msg("123")
        state = _state_mock({"items": []})
        await on_oem_input(msg, state)
        state.set_state.assert_not_called()

    async def test_oem_stored_in_state(self):
        msg = _msg("8390132500")
        state = _state_mock({"items": []})
        await on_oem_input(msg, state)
        state.update_data.assert_called_once_with(current_oem_code="8390132500")


class TestOnNameQtyInput:
    async def test_name_stored_and_advances_to_quantity(self):
        msg = _msg("უკანა სუხო")
        db = _db()
        state = _state_mock({"items": [], "current_oem_code": "1234"})
        await on_name_qty_input(msg, state, db)
        state.set_state.assert_called_once_with(AddOrderWizard.quantity)

    async def test_name_with_trailing_number_stored_as_full_name(self):
        # Previously "სარკე 3" was parsed as name="სარკე" qty=3.
        # Now the whole string is stored as the name; quantity is asked separately.
        msg = _msg("სარკე 3")
        db = _db()
        state = _state_mock({"items": [], "current_oem_code": "1234"})
        await on_name_qty_input(msg, state, db)
        state.update_data.assert_called_once_with(current_product_name="სარკე 3")
        state.set_state.assert_called_once_with(AddOrderWizard.quantity)

    async def test_empty_input_sends_warning_and_stays(self):
        msg = _msg("")
        db = _db()
        state = _state_mock({"items": [], "current_oem_code": "1234"})
        await on_name_qty_input(msg, state, db)
        state.set_state.assert_not_called()
        text = msg.answer.call_args[0][0]
        assert "დასახელება" in text
