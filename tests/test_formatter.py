"""Tests for bot/reports/formatter.py — pure formatting functions."""
from __future__ import annotations

import os


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

from bot.reports.formatter import (  # noqa: E402
    _category_label,
    _e,
    _payment_label,
    _seller_label,
    _truncate,
    format_sale_confirmation,
    format_topic_expense,
    format_topic_nisia,
    format_topic_order,
    format_topic_sale,
)


# ─── _e (html escape) ─────────────────────────────────────────────────────────

class TestHtmlEscape:
    def test_plain_string_unchanged(self):
        assert _e("hello") == "hello"

    def test_escapes_angle_brackets(self):
        result = _e("<script>")
        assert "<" not in result
        assert ">" not in result
        assert "&lt;script&gt;" == result

    def test_escapes_ampersand(self):
        assert _e("A&B") == "A&amp;B"

    def test_escapes_quotes(self):
        assert '"' not in _e('"quoted"')

    def test_non_string_coerced(self):
        assert _e(42) == "42"
        assert _e(None) == "None"

    def test_georgian_unchanged(self):
        assert _e("სათადარიგო") == "სათადარიგო"


# ─── _payment_label ───────────────────────────────────────────────────────────

class TestPaymentLabel:
    def test_cash(self):
        assert _payment_label("cash") == "ხელზე 💵"

    def test_transfer(self):
        assert _payment_label("transfer") == "დარიცხა 🏦"

    def test_credit_fallback(self):
        label = _payment_label("credit")
        assert "ნისია" in label

    def test_unknown_fallback(self):
        label = _payment_label("unknown_method")
        assert "ნისია" in label


# ─── _seller_label ────────────────────────────────────────────────────────────

class TestSellerLabel:
    def test_llc(self):
        assert _seller_label("llc") == "შპს"

    def test_individual(self):
        assert _seller_label("individual") == "ფზ"

    def test_unknown_falls_back_to_individual(self):
        assert _seller_label("anything") == "ფზ"


# ─── _category_label ──────────────────────────────────────────────────────────

class TestCategoryLabel:
    def test_known_category(self):
        assert _category_label("fuel") == "⛽ საწვავი"

    def test_salary(self):
        assert _category_label("salary") == "👷 ხელფასი"

    def test_delivery(self):
        assert _category_label("delivery") == "🚚 მიტანა"

    def test_unknown_returns_empty(self):
        assert _category_label("nonexistent") == ""

    def test_none_returns_empty(self):
        assert _category_label(None) == ""

    def test_empty_string_returns_empty(self):
        assert _category_label("") == ""


# ─── _truncate ────────────────────────────────────────────────────────────────

class TestTruncate:
    def test_short_message_unchanged(self):
        msg = "მოკლე შეტყობინება"
        assert _truncate(msg) == msg

    def test_exactly_4096_chars_unchanged(self):
        msg = "x" * 4096
        assert _truncate(msg) == msg

    def test_long_message_truncated(self):
        msg = "x" * 5000
        result = _truncate(msg)
        assert len(result) <= 4096
        assert "შეკვეცილია" in result

    def test_truncation_tail_present(self):
        msg = "a" * 5000
        result = _truncate(msg)
        assert result.endswith("</i>")


# ─── format_topic_sale ────────────────────────────────────────────────────────

class TestFormatTopicSale:
    def _sale(self, **kwargs):
        defaults = dict(
            product_name="Oil Filter",
            qty=2,
            price=15.50,
            payment="cash",
            sale_id=101,
        )
        defaults.update(kwargs)
        return format_topic_sale(**defaults)

    def test_contains_product_name(self):
        assert "Oil Filter" in self._sale()

    def test_contains_total_price(self):
        assert "31.00" in self._sale()

    def test_contains_sale_id(self):
        assert "#101" in self._sale()

    def test_cash_payment_label(self):
        assert "ხელზე" in self._sale(payment="cash")

    def test_transfer_payment_label(self):
        assert "დარიცხა" in self._sale(payment="transfer")

    def test_customer_name_included(self):
        result = self._sale(customer_name="გიორგი")
        assert "გიორგი" in result

    def test_no_customer_name_no_customer_section(self):
        result = self._sale(customer_name=None)
        assert "👤" not in result

    def test_unknown_product_warning(self):
        result = self._sale(unknown_product=True)
        assert "ბაზაში არ არის" in result

    def test_oem_code_shown(self):
        result = self._sale(oem_code="45201-06290")
        assert "45201-06290" in result

    def test_html_escaping_in_product_name(self):
        result = self._sale(product_name="<Filter>")
        assert "<Filter>" not in result
        assert "&lt;Filter&gt;" in result


# ─── format_topic_nisia ───────────────────────────────────────────────────────

class TestFormatTopicNisia:
    def _nisia(self, **kwargs):
        defaults = dict(
            customer_name="ნინო",
            product_name="Brake Pad",
            qty=4,
            price=25.00,
            sale_id=202,
        )
        defaults.update(kwargs)
        return format_topic_nisia(**defaults)

    def test_contains_customer_name(self):
        assert "ნინო" in self._nisia()

    def test_contains_product_name(self):
        assert "Brake Pad" in self._nisia()

    def test_contains_total(self):
        assert "100.00" in self._nisia()

    def test_nisia_label_present(self):
        assert "ნისია" in self._nisia()

    def test_unknown_product_warning(self):
        result = self._nisia(unknown_product=True)
        assert "⚠️" in result

    def test_oem_code_shown(self):
        result = self._nisia(oem_code="ABC-123")
        assert "ABC-123" in result


# ─── format_topic_expense ─────────────────────────────────────────────────────

class TestFormatTopicExpense:
    def test_known_category_label_shown(self):
        result = format_topic_expense(50.0, "fuel", "diesel", 1)
        assert "საწვავი" in result

    def test_unknown_category_shows_other(self):
        result = format_topic_expense(30.0, "unknown_cat", "misc", 2)
        assert "სხვა" in result

    def test_none_category_shows_other(self):
        result = format_topic_expense(10.0, None, "office supplies", 3)
        assert "სხვა" in result

    def test_amount_formatted(self):
        result = format_topic_expense(123.45, "salary", "John", 4)
        assert "123.45" in result

    def test_expense_id_shown(self):
        result = format_topic_expense(20.0, "delivery", "DHL", 99)
        assert "#99" in result

    def test_description_included(self):
        result = format_topic_expense(15.0, "office", "printer paper", 5)
        assert "printer paper" in result

    def test_no_description_no_dash(self):
        result = format_topic_expense(15.0, "office", None, 6)
        assert " — " not in result

    def test_html_escaped_description(self):
        result = format_topic_expense(10.0, "fuel", "<diesel>", 7)
        assert "<diesel>" not in result


# ─── format_topic_order ───────────────────────────────────────────────────────

class TestFormatTopicOrder:
    def _order(self, **kwargs):
        defaults = dict(
            product_name="Spark Plug",
            qty=10,
            status="new",
            priority="urgent",
            order_id=55,
        )
        defaults.update(kwargs)
        return format_topic_order(**defaults)

    def test_product_name_present(self):
        assert "Spark Plug" in self._order()

    def test_order_id_present(self):
        assert "#55" in self._order()

    def test_urgent_priority_label(self):
        assert "სასწრაფო" in self._order(priority="urgent")

    def test_low_priority_label(self):
        assert "არც ისე" in self._order(priority="low")

    def test_new_status_label(self):
        assert "ახალია" in self._order(status="new")

    def test_ordered_status_label(self):
        assert "შეკვეთილია" in self._order(status="ordered")

    def test_notes_included_when_provided(self):
        result = self._order(notes="check supplier")
        assert "check supplier" in result

    def test_no_notes_when_absent(self):
        result = self._order(notes=None)
        assert "📝" not in result

    def test_qty_ordered_shows_remaining(self):
        result = self._order(qty=10, qty_ordered=4)
        assert "6" in result  # remaining = 10 - 4 = 6

    def test_qty_ordered_zero_shows_plain_qty(self):
        result = self._order(qty=5, qty_ordered=0)
        assert "5ც" in result
        assert "შეკვ" not in result


# ─── format_sale_confirmation ─────────────────────────────────────────────────

class TestFormatSaleConfirmation:
    def _confirm(self, **kwargs):
        defaults = dict(
            product_name="Front Arm",
            qty=1,
            price=80.0,
            payment="cash",
            seller_type="individual",
            customer_name="",
            new_stock=5,
            low_stock=False,
            sale_id=1,
        )
        defaults.update(kwargs)
        return format_sale_confirmation(**defaults)

    def test_success_header_present(self):
        assert "გაყიდვა დაფიქსირდა" in self._confirm()

    def test_product_name_present(self):
        assert "Front Arm" in self._confirm()

    def test_total_price_computed(self):
        result = self._confirm(qty=3, price=20.0)
        assert "60.00" in result

    def test_cash_payment_shown(self):
        assert "ხელზე" in self._confirm(payment="cash")

    def test_llc_seller_shown(self):
        assert "შპს" in self._confirm(seller_type="llc")

    def test_customer_name_shown(self):
        result = self._confirm(customer_name="მარიამი")
        assert "მარიამი" in result

    def test_no_customer_line_when_empty(self):
        result = self._confirm(customer_name="")
        assert "👤" not in result

    def test_credit_reminder_shown(self):
        result = self._confirm(payment="credit", sale_id=77)
        assert "ნისია" in result
        assert "77" in result

    def test_stock_level_shown(self):
        result = self._confirm(new_stock=3)
        assert "3ც" in result

    def test_no_stock_line_when_none(self):
        result = self._confirm(new_stock=None)
        assert "საწყობში" not in result

    def test_unknown_product_warning(self):
        result = self._confirm(unknown_product=True)
        assert "ბაზაში არ არის" in result

    def test_low_stock_warning_shown(self):
        result = self._confirm(new_stock=1, low_stock=True)
        assert "მარაგი დაბალია" in result

    def test_low_stock_not_shown_when_false(self):
        result = self._confirm(new_stock=10, low_stock=False)
        assert "მარაგი დაბალია" not in result

    def test_html_escaping_product_name(self):
        result = self._confirm(product_name="<Arm>")
        assert "<Arm>" not in result

    def test_result_fits_telegram_limit(self):
        result = self._confirm(product_name="x" * 4000)
        assert len(result) <= 4096
