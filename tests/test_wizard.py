"""Tests for bot/handlers/wizard.py — pure helpers and critical FSM handler paths."""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

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

from aiogram.types import Message  # noqa: E402
from bot.handlers.wizard import (  # noqa: E402
    SaleWizard,
    _btn,
    _calc_vat,
    _e,
    _expense_action_kb,
    _kb,
    _nisia_action_kb,
    _sale_action_kb,
    cb_cancel,
    cb_done,
    sale_confirm,
    sale_payment,
    sale_seller_type,
    sale_start,
)


# ─── Pure helpers ─────────────────────────────────────────────────────────────

class TestCalcVat:
    def test_standard_amount(self):
        """100₾ inclusive-VAT → vat ≈ 15.25₾ (100 - 100/1.18)."""
        vat = _calc_vat(100.0)
        assert abs(vat - 15.25) < 0.01

    def test_zero_amount(self):
        assert _calc_vat(0.0) == 0.0

    def test_result_is_rounded_to_two_decimals(self):
        vat = _calc_vat(59.0)
        assert round(vat, 2) == vat

    def test_large_amount(self):
        vat = _calc_vat(1180.0)
        assert abs(vat - 180.0) < 0.01


class TestHtmlEscape:
    def test_escapes_angle_brackets(self):
        assert _e("<script>") == "&lt;script&gt;"

    def test_escapes_ampersand(self):
        assert _e("a & b") == "a &amp; b"

    def test_georgian_unchanged(self):
        assert _e("სარკე") == "სარკე"

    def test_converts_non_string_to_str(self):
        assert _e(42) == "42"
        assert _e(None) == "None"


class TestKeyboardBuilders:
    def test_btn_sets_text_and_data(self):
        b = _btn("Hello", "data:123")
        assert b.text == "Hello"
        assert b.callback_data == "data:123"

    def test_kb_wraps_rows(self):
        kb = _kb([_btn("A", "a")], [_btn("B", "b")])
        assert len(kb.inline_keyboard) == 2
        assert kb.inline_keyboard[0][0].callback_data == "a"
        assert kb.inline_keyboard[1][0].callback_data == "b"

    def test_sale_action_kb_has_four_buttons(self):
        kb = _sale_action_kb(5)
        all_btns = [b for row in kb.inline_keyboard for b in row]
        # delete + edit + more + done = 4
        assert len(all_btns) == 4

    def test_sale_action_kb_contains_sale_id(self):
        kb = _sale_action_kb(99)
        all_data = [b.callback_data for row in kb.inline_keyboard for b in row]
        assert any("99" in (d or "") for d in all_data)

    def test_nisia_action_kb_structure(self):
        kb = _nisia_action_kb(3)
        all_btns = [b for row in kb.inline_keyboard for b in row]
        assert len(all_btns) >= 2

    def test_expense_action_kb_structure(self):
        kb = _expense_action_kb(7)
        all_btns = [b for row in kb.inline_keyboard for b in row]
        assert len(all_btns) >= 2


# ─── FSM handler helpers ──────────────────────────────────────────────────────

def _make_callback(data: str = "wiz:test", user_id: int = 12345) -> MagicMock:
    cb = MagicMock()
    cb.data = data
    cb.from_user = MagicMock(id=user_id)
    cb.bot = MagicMock()
    cb.bot.send_message = AsyncMock()
    cb.answer = AsyncMock()
    # spec=Message so isinstance(cb.message, Message) passes in handler asserts
    cb.message = MagicMock(spec=Message)
    cb.message.edit_text = AsyncMock()
    cb.message.edit_reply_markup = AsyncMock()
    cb.message.answer = AsyncMock()
    return cb


def _make_state(data: dict | None = None) -> MagicMock:
    state = MagicMock()
    state.clear = AsyncMock()
    state.set_state = AsyncMock()
    state.set_data = AsyncMock()
    state.update_data = AsyncMock()
    state.get_data = AsyncMock(return_value=data or {})
    return state


def _make_db() -> MagicMock:
    db = MagicMock()
    db.create_sale = AsyncMock(return_value=(1, 10))
    db.get_product_by_id = AsyncMock(return_value=None)
    db.create_order = AsyncMock()
    db.update_sale_topic_message = AsyncMock()
    db.log_parse_failure = AsyncMock()
    return db


# ─── cb_cancel ────────────────────────────────────────────────────────────────

class TestCbCancel:
    @pytest.mark.asyncio
    async def test_clears_state_and_edits_text(self):
        cb = _make_callback("wiz:cancel")
        state = _make_state()

        await cb_cancel(cb, state)

        state.clear.assert_awaited_once()
        cb.message.edit_text.assert_awaited_once()
        edited_text = cb.message.edit_text.call_args[0][0]
        assert "გაუქმებულია" in edited_text


# ─── cb_done ──────────────────────────────────────────────────────────────────

class TestCbDone:
    @pytest.mark.asyncio
    async def test_clears_state_and_removes_keyboard(self):
        cb = _make_callback("wiz:done:sale")
        state = _make_state()

        await cb_done(cb, state)

        state.clear.assert_awaited_once()
        cb.message.edit_reply_markup.assert_awaited_once_with(reply_markup=None)
        cb.answer.assert_awaited_once()


# ─── sale_start ───────────────────────────────────────────────────────────────

class TestSaleStart:
    @pytest.mark.asyncio
    async def test_sets_oem_state_and_edits_message(self):
        cb = _make_callback("wiz:main:sale")
        state = _make_state()

        await sale_start(cb, state)

        state.set_state.assert_awaited_once_with(SaleWizard.oem)
        cb.message.edit_text.assert_awaited_once()
        text = cb.message.edit_text.call_args[0][0]
        assert "OEM" in text


# ─── sale_payment ─────────────────────────────────────────────────────────────

class TestSalePayment:
    @pytest.mark.asyncio
    async def test_cash_payment_advances_to_seller_type(self):
        cb = _make_callback("wiz:pay:cash")
        state = _make_state()

        await sale_payment(cb, state)

        state.update_data.assert_awaited_once_with(payment="cash")
        state.set_state.assert_awaited_once_with(SaleWizard.seller_type)
        cb.message.edit_text.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_transfer_payment_stored_correctly(self):
        cb = _make_callback("wiz:pay:transfer")
        state = _make_state()

        await sale_payment(cb, state)

        state.update_data.assert_awaited_with(payment="transfer")

    @pytest.mark.asyncio
    async def test_credit_payment_stored_correctly(self):
        cb = _make_callback("wiz:pay:credit")
        state = _make_state()

        await sale_payment(cb, state)

        state.update_data.assert_awaited_with(payment="credit")


# ─── sale_seller_type ─────────────────────────────────────────────────────────

class TestSaleSellerType:
    @pytest.mark.asyncio
    async def test_company_seller_auto_computes_vat_and_goes_to_buyer_type(self):
        """LLC seller → VAT auto-computed, state goes to buyer_type (step 6/7)."""
        cb = _make_callback("wiz:seller:company")
        state = _make_state(data={"unit_price": "50.0", "quantity": "2"})

        await sale_seller_type(cb, state)

        update_call = state.update_data.call_args[1]
        assert update_call["seller_type"] == "llc"
        assert update_call["is_vat_included"] is True
        assert update_call["vat_amount"] > 0.0
        state.set_state.assert_awaited_once_with(SaleWizard.buyer_type)
        cb.message.edit_text.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_individual_seller_skips_vat_to_buyer_type(self):
        """Individual seller → goes directly to buyer type selection (no VAT)."""
        cb = _make_callback("wiz:seller:individual")
        state = _make_state(data={"unit_price": "50.0", "quantity": "2"})

        await sale_seller_type(cb, state)

        state.set_state.assert_awaited_once_with(SaleWizard.buyer_type)


# ─── sale_confirm ─────────────────────────────────────────────────────────────

class TestSaleConfirm:
    def _state_data(self, **overrides) -> dict:
        base = {
            "product_id": 1,
            "product_name": "სარკე",
            "oem_code": "12345",
            "quantity": 2,
            "unit_price": 30.0,
            "payment": "cash",
            "seller_type": "llc",
            "buyer_type": "retail",
            "is_freeform": False,
            "vat_amount": 0.0,
            "is_vat_included": False,
        }
        base.update(overrides)
        return base

    @pytest.mark.asyncio
    async def test_calls_create_sale_and_edits_confirmation(self):
        cb = _make_callback("wiz:confirm:yes")
        state = _make_state(data=self._state_data())
        db = _make_db()
        db.create_sale = AsyncMock(return_value=(42, 8))

        with patch("bot.handlers.wizard.format_topic_sale", return_value="OK"):
            await sale_confirm(cb, state, db)

        db.create_sale.assert_awaited_once()
        cb.message.edit_text.assert_awaited_once()
        text = cb.message.edit_text.call_args[0][0]
        assert "42" in text  # sale_id in confirmation

    @pytest.mark.asyncio
    async def test_zero_stock_triggers_auto_order(self):
        """Stock hits 0 after sale → auto-order created."""
        cb = _make_callback("wiz:confirm:yes")
        state = _make_state(data=self._state_data(product_id=5))
        db = _make_db()
        db.create_sale = AsyncMock(return_value=(10, 0))
        db.get_product_by_id = AsyncMock(return_value={
            "id": 5, "name": "სარკე", "min_stock": 3,
        })

        with patch("bot.handlers.wizard.format_topic_sale", return_value="OK"):
            await sale_confirm(cb, state, db)

        db.create_order.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_positive_stock_no_auto_order(self):
        """Stock remains positive → no auto-order."""
        cb = _make_callback("wiz:confirm:yes")
        state = _make_state(data=self._state_data())
        db = _make_db()
        db.create_sale = AsyncMock(return_value=(7, 5))

        with patch("bot.handlers.wizard.format_topic_sale", return_value="OK"):
            await sale_confirm(cb, state, db)

        db.create_order.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_state_reset_after_confirm(self):
        """After confirm: state set back to SaleWizard.product, data cleared."""
        cb = _make_callback("wiz:confirm:yes")
        state = _make_state(data=self._state_data())
        db = _make_db()
        db.create_sale = AsyncMock(return_value=(1, 5))

        with patch("bot.handlers.wizard.format_topic_sale", return_value="OK"):
            await sale_confirm(cb, state, db)

        state.set_state.assert_awaited_once_with(SaleWizard.product)
        state.set_data.assert_awaited_once_with({})

    @pytest.mark.asyncio
    async def test_topic_post_failure_does_not_propagate(self):
        """Failure posting to topic (e.g., bot banned) → confirm still succeeds."""
        cb = _make_callback("wiz:confirm:yes")
        cb.bot.send_message = AsyncMock(side_effect=Exception("Telegram error"))
        state = _make_state(data=self._state_data())
        db = _make_db()
        db.create_sale = AsyncMock(return_value=(3, 5))

        with patch("bot.handlers.wizard.format_topic_sale", return_value="OK"):
            await sale_confirm(cb, state, db)

        # Confirmation edit still happened despite topic failure
        cb.message.edit_text.assert_awaited_once()
