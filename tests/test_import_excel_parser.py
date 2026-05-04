"""Tests for bot/parsers/import_excel_parser.py."""

from __future__ import annotations

import os
from datetime import date, datetime
from io import BytesIO

import openpyxl
import pytest

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

from bot.parsers.import_excel_parser import (  # noqa: E402
    _parse_date,
    _parse_float,
    parse_import_excel,
)


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _make_workbook(*data_rows) -> BytesIO:
    """Build a workbook with a header row + given data rows, return as BytesIO."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(
        [
            "თარიღი",
            "OEM კოდი",
            "დასახელება",
            "რაოდენობა",
            "ზომის ერთეული",
            "ერთეულის ფასი $",
            "კურსი",
            "ტრანსპორტირება ₾",
            "სხვა ₾",
            "მომწოდებელი",
            "ინვოისი №",
            "ინვ. თარიღი",
            "ინვ. კურსი",
        ]
    )
    for row in data_rows:
        ws.append(list(row))
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def _minimal_row(
    import_date="2024-01-15",
    oem="45201-06290",
    name="Control Arm",
    qty=2,
    unit="ც",
    price_usd=10.0,
    rate=2.70,
    transport=0,
    other=0,
    supplier=None,
    invoice_num=None,
    invoice_date=None,
    invoice_rate=None,
):
    return (
        import_date,
        oem,
        name,
        qty,
        unit,
        price_usd,
        rate,
        transport,
        other,
        supplier,
        invoice_num,
        invoice_date,
        invoice_rate,
    )


# ─── _parse_date ──────────────────────────────────────────────────────────────


class TestParseDate:
    def test_datetime_object(self):
        dt = datetime(2024, 3, 15, 10, 0)
        assert _parse_date(dt) == date(2024, 3, 15)

    def test_date_object(self):
        d = date(2024, 6, 1)
        assert _parse_date(d) == d

    def test_iso_string(self):
        assert _parse_date("2024-01-15") == date(2024, 1, 15)

    def test_dot_format_string(self):
        assert _parse_date("15.01.2024") == date(2024, 1, 15)

    def test_slash_format_dmy(self):
        assert _parse_date("15/01/2024") == date(2024, 1, 15)

    def test_none_returns_none(self):
        assert _parse_date(None) is None

    def test_invalid_string_returns_none(self):
        assert _parse_date("not-a-date") is None


# ─── _parse_float ─────────────────────────────────────────────────────────────


class TestParseFloat:
    def test_plain_number(self):
        assert _parse_float(2.70) == pytest.approx(2.70)

    def test_integer(self):
        assert _parse_float(10) == pytest.approx(10.0)

    def test_string_number(self):
        assert _parse_float("15.50") == pytest.approx(15.50)

    def test_comma_as_decimal(self):
        assert _parse_float("2,70") == pytest.approx(2.70)

    def test_none_returns_default(self):
        assert _parse_float(None) == pytest.approx(0.0)

    def test_none_custom_default(self):
        assert _parse_float(None, default=5.0) == pytest.approx(5.0)

    def test_empty_string_returns_default(self):
        assert _parse_float("") == pytest.approx(0.0)

    def test_non_numeric_string_returns_default(self):
        # "abc" strips to "" after re.sub, falls back to default
        assert _parse_float("abc") == pytest.approx(0.0)

    def test_double_dash_returns_none(self):
        # "--5" → float("--5") → ValueError → None
        assert _parse_float("--5") is None

    def test_currency_stripped(self):
        result = _parse_float("₾15.00")
        assert result == pytest.approx(15.0)


# ─── parse_import_excel ───────────────────────────────────────────────────────


class TestParseImportExcel:
    def test_happy_path_returns_one_row(self):
        buf = _make_workbook(_minimal_row())
        rows, errors = parse_import_excel(buf)
        assert len(rows) == 1
        assert errors == []

    def test_computed_total_cost(self):
        # total = (10 * 2.70) + 0 + 0 = 27.0
        buf = _make_workbook(_minimal_row(price_usd=10.0, rate=2.70))
        rows, _ = parse_import_excel(buf)
        assert rows[0].total_unit_cost_gel == pytest.approx(27.0)

    def test_computed_suggested_price_40_markup(self):
        # suggested = 27.0 * 1.4 = 37.8
        buf = _make_workbook(_minimal_row(price_usd=10.0, rate=2.70))
        rows, _ = parse_import_excel(buf)
        assert rows[0].suggested_retail_price_gel == pytest.approx(37.8)

    def test_transport_and_other_added_to_cost(self):
        # total = (10 * 2.70) + 1.5 + 0.5 = 29.0
        buf = _make_workbook(
            _minimal_row(price_usd=10.0, rate=2.70, transport=1.5, other=0.5)
        )
        rows, _ = parse_import_excel(buf)
        assert rows[0].total_unit_cost_gel == pytest.approx(29.0)

    def test_oem_uppercased(self):
        buf = _make_workbook(_minimal_row(oem="abc-123"))
        rows, _ = parse_import_excel(buf)
        assert rows[0].oem == "ABC-123"

    def test_oem_float_suffix_stripped(self):
        # sanitize_oem strips ".0" from purely-numeric oem codes returned by openpyxl
        buf = _make_workbook(_minimal_row(oem="2073035100.0"))
        rows, _ = parse_import_excel(buf)
        assert rows[0].oem == "2073035100"

    def test_unit_defaults_to_georgian_c_when_blank(self):
        buf = _make_workbook(_minimal_row(unit=None))
        rows, _ = parse_import_excel(buf)
        assert rows[0].unit == "ც"

    def test_multiple_rows_parsed(self):
        buf = _make_workbook(_minimal_row(oem="OEM001"), _minimal_row(oem="OEM002"))
        rows, errors = parse_import_excel(buf)
        assert len(rows) == 2
        assert errors == []

    def test_empty_row_skipped(self):
        buf = _make_workbook(
            _minimal_row(oem="OEM001"),
            (
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            ),
            _minimal_row(oem="OEM002"),
        )
        rows, _ = parse_import_excel(buf)
        assert len(rows) == 2

    def test_date_carry_forward(self):
        row1 = _minimal_row(import_date="2024-01-10", oem="OEM001")
        # Row 2 has no date (None in column 0) — should inherit row1's date
        row2 = list(_minimal_row(oem="OEM002"))
        row2[0] = None
        buf = _make_workbook(row1, row2)
        rows, _ = parse_import_excel(buf)
        assert rows[1].import_date == date(2024, 1, 10)

    def test_missing_oem_produces_error(self):
        buf = _make_workbook(_minimal_row(oem=None))
        rows, errors = parse_import_excel(buf)
        assert rows == []
        assert len(errors) == 1
        assert "OEM" in errors[0]

    def test_missing_name_produces_error(self):
        buf = _make_workbook(_minimal_row(name=None))
        rows, errors = parse_import_excel(buf)
        assert rows == []
        assert len(errors) == 1
        assert "დასახელება" in errors[0]

    def test_zero_quantity_produces_error(self):
        buf = _make_workbook(_minimal_row(qty=0))
        rows, errors = parse_import_excel(buf)
        assert rows == []
        assert any("რაოდენობა" in e for e in errors)

    def test_negative_quantity_produces_error(self):
        buf = _make_workbook(_minimal_row(qty=-1))
        rows, errors = parse_import_excel(buf)
        assert rows == []
        assert len(errors) == 1

    def test_negative_price_produces_error(self):
        buf = _make_workbook(_minimal_row(price_usd=-5.0))
        rows, errors = parse_import_excel(buf)
        assert rows == []
        assert len(errors) == 1

    def test_zero_exchange_rate_produces_error(self):
        buf = _make_workbook(_minimal_row(rate=0))
        rows, errors = parse_import_excel(buf)
        assert rows == []
        assert any("კურსი" in e for e in errors)

    def test_optional_supplier_captured(self):
        buf = _make_workbook(_minimal_row(supplier="Toyota Inc."))
        rows, _ = parse_import_excel(buf)
        assert rows[0].supplier == "Toyota Inc."

    def test_optional_supplier_none_when_blank(self):
        buf = _make_workbook(_minimal_row(supplier=None))
        rows, _ = parse_import_excel(buf)
        assert rows[0].supplier is None

    def test_optional_invoice_number_captured(self):
        buf = _make_workbook(_minimal_row(invoice_num="INV-2024-001"))
        rows, _ = parse_import_excel(buf)
        assert rows[0].invoice_number == "INV-2024-001"

    def test_optional_invoice_date_parsed(self):
        buf = _make_workbook(_minimal_row(invoice_date="2024-01-05"))
        rows, _ = parse_import_excel(buf)
        assert rows[0].invoice_date == date(2024, 1, 5)

    def test_optional_invoice_rate_captured(self):
        buf = _make_workbook(_minimal_row(invoice_rate=2.65))
        rows, _ = parse_import_excel(buf)
        assert rows[0].invoice_exchange_rate == pytest.approx(2.65)

    def test_optional_invoice_rate_zero_ignored(self):
        buf = _make_workbook(_minimal_row(invoice_rate=0))
        rows, _ = parse_import_excel(buf)
        assert rows[0].invoice_exchange_rate is None

    def test_partial_errors_dont_stop_other_rows(self):
        good = _minimal_row(oem="OEM_GOOD")
        bad = _minimal_row(oem=None)
        buf = _make_workbook(good, bad)
        rows, errors = parse_import_excel(buf)
        assert len(rows) == 1
        assert len(errors) == 1
        assert rows[0].oem == "OEM_GOOD"

    def test_to_dict_has_all_keys(self):
        buf = _make_workbook(_minimal_row())
        rows, _ = parse_import_excel(buf)
        d = rows[0].to_dict()
        for key in (
            "import_date",
            "oem",
            "name",
            "quantity",
            "unit",
            "unit_price_usd",
            "exchange_rate",
            "transport_cost_gel",
            "other_cost_gel",
            "total_unit_cost_gel",
            "suggested_retail_price_gel",
            "supplier",
            "invoice_number",
            "invoice_date",
            "invoice_exchange_rate",
        ):
            assert key in d

    def test_9_column_file_without_optional_columns(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(
            ["თარიღი", "OEM", "სახელი", "რაოდ", "ც", "ფასი$", "კურსი", "ტრანსპ", "სხვა"]
        )
        ws.append(["2024-03-01", "OEM999", "Bearing", 5, "ც", 8.0, 2.75, 0, 0])
        buf = BytesIO()
        wb.save(buf)
        buf.seek(0)
        rows, errors = parse_import_excel(buf)
        assert len(rows) == 1
        assert errors == []
        assert rows[0].supplier is None
