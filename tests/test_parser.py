"""
Unit tests for bot/parsers/message_parser.py
No external dependencies — runs without a database or Telegram connection.
"""

import pytest
from bot.parsers.message_parser import (
    PAYMENT_CASH,
    PAYMENT_TRANSFER,
    PAYMENT_UNKNOWN,
    ParsedExpense,
    ParsedOrder,
    ParsedSale,
    parse_expense_message,
    parse_order_message,
    parse_sale_message,
)


# ─── parse_sale_message ───────────────────────────────────────────────────────

class TestParseSaleMessage:
    def test_pattern_a_cash_explicit(self):
        result = parse_sale_message("მარჭვენა რეფლექტორი 1ც 30₾ ხელზე")
        assert result is not None
        assert result.raw_product == "მარჭვენა რეფლექტორი"
        assert result.quantity == 1
        assert result.price == 30.0
        assert result.payment_method == PAYMENT_CASH
        assert result.is_return is False

    def test_pattern_a_transfer(self):
        result = parse_sale_message("8390132500 2ც 45₾ გადარიცხვა")
        assert result is not None
        assert result.raw_product == "8390132500"
        assert result.quantity == 2
        assert result.price == 45.0
        assert result.payment_method == PAYMENT_TRANSFER

    def test_pattern_a_no_payment_defaults_to_cash(self):
        result = parse_sale_message("სარკე 3ც 20₾")
        assert result is not None
        assert result.payment_method == PAYMENT_CASH

    def test_pattern_a_lari_symbol_variant(self):
        """Accepts ლ as well as ₾."""
        result = parse_sale_message("ფარი 1ც 100ლ")
        assert result is not None
        assert result.price == 100.0

    def test_pattern_b_explicit_code_prefix(self):
        result = parse_sale_message("კოდი: 8390132500, 1ც, 35₾")
        assert result is not None
        assert result.raw_product == "8390132500"
        assert result.quantity == 1
        assert result.price == 35.0

    def test_pattern_b_with_payment(self):
        result = parse_sale_message("კოდი: ABC123, 2ც, 80₾, გადარიცხვა")
        assert result is not None
        assert result.payment_method == PAYMENT_TRANSFER

    def test_return_flag_detected(self):
        result = parse_sale_message("დაბრუნება მარჭვენა რეფლექტორი 1ც 30₾")
        assert result is not None
        assert result.is_return is True

    def test_return_word_exchange(self):
        result = parse_sale_message("გაცვლა სარკე 2ც 50₾")
        assert result is not None
        assert result.is_return is True

    def test_unrecognised_returns_none(self):
        assert parse_sale_message("გამარჯობა") is None
        assert parse_sale_message("") is None
        assert parse_sale_message("123") is None

    def test_multiword_product_name(self):
        result = parse_sale_message("წინა მარჯვენა ფარი 1ც 150₾ ხელზე")
        assert result is not None
        assert result.raw_product == "წინა მარჯვენა ფარი"

    def test_decimal_price(self):
        result = parse_sale_message("ნათურა 1ც 12.50₾")
        assert result is not None
        assert result.price == 12.50

    def test_quantity_greater_than_one(self):
        result = parse_sale_message("ბოლტი 10ც 5₾")
        assert result is not None
        assert result.quantity == 10

    def test_unknown_payment_keyword(self):
        result = parse_sale_message("ნათურა 1ც 10₾ ბარათი")
        assert result is not None
        assert result.payment_method == PAYMENT_UNKNOWN

    def test_whitespace_stripped(self):
        result = parse_sale_message("  სარკე 1ც 30₾  ")
        assert result is not None
        assert result.raw_product == "სარკე"


# ─── parse_expense_message ────────────────────────────────────────────────────

class TestParseExpenseMessage:
    def test_amount_first(self):
        result = parse_expense_message("50₾ ბენზინი")
        assert result is not None
        assert result.amount == 50.0
        assert result.description == "ბენზინი"

    def test_description_first(self):
        result = parse_expense_message("ბენზინი 50₾")
        assert result is not None
        assert result.amount == 50.0
        assert result.description == "ბენზინი"

    def test_lari_variant(self):
        result = parse_expense_message("100ლ ავტომობილი")
        assert result is not None
        assert result.amount == 100.0

    def test_decimal_amount(self):
        result = parse_expense_message("12.50₾ ყავა")
        assert result is not None
        assert result.amount == 12.50

    def test_multiword_description(self):
        result = parse_expense_message("მანქანის სერვისი 200₾")
        assert result is not None
        assert result.description == "მანქანის სერვისი"
        assert result.amount == 200.0

    def test_unrecognised_returns_none(self):
        assert parse_expense_message("გამარჯობა") is None
        assert parse_expense_message("") is None

    def test_whitespace_stripped(self):
        result = parse_expense_message("  50₾ ბენზინი  ")
        assert result is not None
        assert result.amount == 50.0


# ─── parse_order_message ─────────────────────────────────────────────────────

class TestParseOrderMessage:
    def test_oem_code_order(self):
        result = parse_order_message("8390132500 5ც")
        assert result is not None
        assert result.raw_product == "8390132500"
        assert result.quantity == 5

    def test_product_name_order(self):
        result = parse_order_message("მარჭვენა სარკე 2ც")
        assert result is not None
        assert result.raw_product == "მარჭვენა სარკე"
        assert result.quantity == 2

    def test_single_word_product(self):
        result = parse_order_message("ნათურა 3ც")
        assert result is not None
        assert result.raw_product == "ნათურა"
        assert result.quantity == 3

    def test_unrecognised_returns_none(self):
        assert parse_order_message("შეკვეთა") is None
        assert parse_order_message("") is None
        assert parse_order_message("სარკე") is None  # no quantity

    def test_whitespace_stripped(self):
        result = parse_order_message("  სარკე 1ც  ")
        assert result is not None
        assert result.raw_product == "სარკე"
