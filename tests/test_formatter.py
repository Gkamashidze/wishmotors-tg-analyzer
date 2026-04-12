"""
Unit tests for bot/reports/formatter.py
No external dependencies — mocks config so no .env required.
"""

import os
from datetime import datetime

import pytz

# Provide minimal env so config.py loads without errors
os.environ.setdefault("BOT_TOKEN", "test")
os.environ.setdefault("GROUP_ID", "1")
os.environ.setdefault("SALES_TOPIC_ID", "2")
os.environ.setdefault("ORDERS_TOPIC_ID", "3")
os.environ.setdefault("EXPENSES_TOPIC_ID", "4")
os.environ.setdefault("CAPITAL_TOPIC_ID", "5")
os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost/test")
os.environ.setdefault("ADMIN_IDS", "12345")
os.environ.setdefault("TIMEZONE", "Asia/Tbilisi")

from bot.reports.formatter import (
    format_orders_report,
    format_period_report,
    format_return_confirmation,
    format_sale_confirmation,
    format_stock_report,
    format_weekly_report,
)


# ─── format_sale_confirmation ────────────────────────────────────────────────

class TestFormatSaleConfirmation:
    def test_cash_payment(self):
        text = format_sale_confirmation(
            product_name="მარჭვენა რეფლექტორი",
            qty=2,
            price=30.0,
            payment="cash",
            seller_type="individual",
            customer_name="",
            new_stock=8,
            low_stock=False,
            sale_id=1,
        )
        assert "გაყიდვა დაფიქსირდა" in text
        assert "60.00₾" in text          # total
        assert "ხელზე" in text
        assert "8ც" in text              # new stock
        assert "⚠️" not in text          # no warning

    def test_transfer_payment(self):
        text = format_sale_confirmation(
            product_name="სარკე",
            qty=1,
            price=45.0,
            payment="transfer",
            seller_type="individual",
            customer_name="",
            new_stock=3,
            low_stock=True,
            sale_id=2,
        )
        assert "დარიცხა" in text
        assert "⚠️" in text              # low-stock warning

    def test_html_special_chars_escaped(self):
        text = format_sale_confirmation(
            product_name="<script>alert(1)</script>",
            qty=1,
            price=10.0,
            payment="cash",
            seller_type="individual",
            customer_name="",
            new_stock=5,
            low_stock=False,
            sale_id=3,
        )
        assert "<script>" not in text
        assert "&lt;script&gt;" in text


# ─── format_return_confirmation ───────────────────────────────────────────────

class TestFormatReturnConfirmation:
    def test_basic_return(self):
        text = format_return_confirmation(
            product_name="ნათურა",
            qty=1,
            refund=15.0,
            new_stock=11,
        )
        assert "დაბრუნება დაფიქსირდა" in text
        assert "15.00₾" in text
        assert "11ც" in text


# ─── format_stock_report ─────────────────────────────────────────────────────

class TestFormatStockReport:
    def _make_product(self, name, stock, min_stock, oem=None, price=10.0):
        return {
            "name": name,
            "current_stock": stock,
            "min_stock": min_stock,
            "oem_code": oem,
            "unit_price": price,
        }

    def test_empty_warehouse(self):
        assert format_stock_report([]) == "📦 საწყობი ცარიელია."

    def test_ok_stock_shows_checkmark(self):
        product = self._make_product("სარკე", stock=50, min_stock=10)
        text = format_stock_report([product])
        assert "✅" in text
        assert "სარკე" in text

    def test_low_stock_shows_warning(self):
        product = self._make_product("ნათურა", stock=5, min_stock=10)
        text = format_stock_report([product])
        assert "⚠️" in text

    def test_exact_min_stock_is_low(self):
        """Stock equal to min_stock is treated as low."""
        product = self._make_product("ბოლტი", stock=20, min_stock=20)
        text = format_stock_report([product])
        assert "⚠️" in text

    def test_oem_displayed(self):
        product = self._make_product("ფარი", stock=30, min_stock=10, oem="OEM123")
        text = format_stock_report([product])
        assert "OEM123" in text

    def test_summary_warning_count(self):
        products = [
            self._make_product("A", stock=5, min_stock=20),
            self._make_product("B", stock=5, min_stock=20),
            self._make_product("C", stock=50, min_stock=20),
        ]
        text = format_stock_report(products)
        assert "2 პროდუქტს სჭირდება შეკვეთა" in text

    def test_html_escaped(self):
        product = self._make_product("<b>test</b>", stock=10, min_stock=5)
        text = format_stock_report([product])
        assert "<b>test</b>" not in text.replace("<b>", "").replace("</b>", "")


# ─── format_orders_report ─────────────────────────────────────────────────────

class TestFormatOrdersReport:
    def test_empty_orders(self):
        assert format_orders_report([]) == "📋 მომლოდინე შეკვეთა არ არის."

    def test_single_order(self):
        order = {
            "id": 7,
            "product_name": "სარკე",
            "oem_code": "OEM999",
            "quantity_needed": 3,
            "notes": "",
        }
        text = format_orders_report([order])
        assert "#7" in text
        assert "სარკე" in text
        assert "OEM999" in text
        assert "3ც" in text

    def test_order_without_product(self):
        order = {
            "id": 1,
            "product_name": None,
            "oem_code": None,
            "quantity_needed": 5,
            "notes": "უცნობი ნაწილი",
        }
        text = format_orders_report([order])
        assert "#1" in text
        assert "5ც" in text

    def test_completeorder_hint(self):
        order = {
            "id": 2,
            "product_name": "ნათურა",
            "oem_code": None,
            "quantity_needed": 1,
            "notes": "",
        }
        text = format_orders_report([order])
        assert "/completeorder" in text


# ─── format_weekly_report ─────────────────────────────────────────────────────

class TestFormatWeeklyReport:
    def _sale(self, name, qty, price, method="cash"):
        return {
            "product_name": name,
            "quantity": qty,
            "unit_price": price,
            "payment_method": method,
            "notes": None,
        }

    def _return(self, name, qty, refund):
        return {"product_name": name, "quantity": qty, "refund_amount": refund}

    def _expense(self, desc, amount):
        return {"description": desc, "amount": amount}

    def _product(self, name, stock, min_stock):
        return {
            "name": name,
            "current_stock": stock,
            "min_stock": min_stock,
            "unit_price": 0,
            "oem_code": None,
        }

    def test_totals_calculated_correctly(self):
        sales = [self._sale("A", 2, 30.0), self._sale("B", 1, 50.0)]
        returns = [self._return("A", 1, 30.0)]
        expenses = [self._expense("ბენზინი", 20.0)]
        products = []

        text = format_weekly_report(sales, returns, expenses, products)

        # revenue = 2*30 + 1*50 = 110
        assert "110.00₾" in text
        # net = 110 - 30 - 20 = 60
        assert "60.00₾" in text

    def test_empty_report_no_crash(self):
        text = format_weekly_report([], [], [], [])
        assert "კვირის ანგარიში" in text
        assert "გაყიდვა არ მომხდარა" in text

    def test_low_stock_warning_in_report(self):
        products = [self._product("ნათურა", stock=2, min_stock=10)]
        text = format_weekly_report([], [], [], products)
        assert "დაბალი მარაგი" in text
        assert "ნათურა" in text

    def test_cash_transfer_split(self):
        sales = [
            self._sale("A", 1, 100.0, "cash"),
            self._sale("B", 1, 200.0, "transfer"),
        ]
        text = format_weekly_report(sales, [], [], [])
        assert "100.00₾" in text   # cash
        assert "200.00₾" in text   # transfer


# ─── format_period_report ────────────────────────────────────────────────────

class TestFormatPeriodReport:
    _TZ = pytz.timezone("Asia/Tbilisi")

    def _d(self, year: int, month: int, day: int, hour: int = 0) -> datetime:
        return self._TZ.localize(datetime(year, month, day, hour, 0, 0))

    def _sale(self, name: str, qty: int, price: float, method: str = "cash") -> dict:
        return {
            "product_name": name,
            "quantity": qty,
            "unit_price": price,
            "payment_method": method,
            "notes": None,
        }

    def _return(self, name: str, qty: int, refund: float) -> dict:
        return {"product_name": name, "quantity": qty, "refund_amount": refund}

    def _expense(self, desc: str, amount: float) -> dict:
        return {"description": desc, "amount": amount}

    def test_empty_period_returns_special_message(self):
        d = self._d(2026, 3, 1)
        text = format_period_report([], [], [], [], d, d)
        assert "📭" in text
        assert "არ დაფიქსირებულა" in text

    def test_shows_period_header(self):
        df = self._d(2026, 3, 1)
        dt = self._d(2026, 3, 31)
        sales = [self._sale("სარკე", 2, 30.0)]
        text = format_period_report(sales, [], [], [], df, dt)
        assert "01.03.2026" in text
        assert "31.03.2026" in text

    def test_revenue_calculation(self):
        df = self._d(2026, 3, 1)
        dt = self._d(2026, 3, 31)
        sales = [self._sale("A", 2, 50.0), self._sale("B", 1, 30.0)]
        text = format_period_report(sales, [], [], [], df, dt)
        assert "130.00₾" in text   # total revenue

    def test_net_income_with_returns_and_expenses(self):
        df = self._d(2026, 3, 1)
        dt = self._d(2026, 3, 31)
        sales = [self._sale("A", 1, 100.0)]
        returns = [self._return("A", 1, 20.0)]
        expenses = [self._expense("ბენზინი", 10.0)]
        text = format_period_report(sales, returns, expenses, [], df, dt)
        # net = 100 - 20 - 10 = 70
        assert "70.00₾" in text

    def test_cash_and_transfer_split(self):
        df = self._d(2026, 3, 1)
        dt = self._d(2026, 3, 31)
        sales = [
            self._sale("A", 1, 100.0, "cash"),
            self._sale("B", 1, 50.0, "transfer"),
        ]
        text = format_period_report(sales, [], [], [], df, dt)
        assert "100.00₾" in text
        assert "50.00₾" in text

    def test_html_escaped_product_name(self):
        df = self._d(2026, 3, 1)
        dt = self._d(2026, 3, 31)
        sales = [self._sale("<script>alert(1)</script>", 1, 10.0)]
        text = format_period_report(sales, [], [], [], df, dt)
        assert "<script>" not in text
        assert "&lt;script&gt;" in text

