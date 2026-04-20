"""Import Excel parser — 9-column cost-tracking format.

Expected columns (row 2 onward, row 1 is header):
  1. თარიღი          — import date (date, datetime, or YYYY-MM-DD string)
  2. OEM კოდი        — OEM code (string)
  3. დასახელება      — product name (string)
  4. რაოდენობა       — quantity (numeric, > 0)
  5. ზომის ერთეული   — unit (string, default "ც")
  6. ერთეულის ფასი $ — unit price in USD (numeric, >= 0)
  7. კურსი           — USD→GEL exchange rate (numeric, > 0)
  8. ტრანსპორტირება ₾ — transport cost per unit in GEL (numeric, default 0)
  9. სხვა ₾          — other cost per unit in GEL (numeric, default 0)

Computed per row:
  total_unit_cost_gel        = (unit_price_usd * exchange_rate) + transport_cost_gel + other_cost_gel
  suggested_retail_price_gel = total_unit_cost_gel * 1.4  (40% margin)
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from io import BytesIO
from typing import Optional

import openpyxl

from bot.parsers.message_parser import sanitize_oem

_DATE_PATTERNS = [
    "%Y-%m-%d",
    "%d.%m.%Y",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%d-%m-%Y",
]

RETAIL_MARKUP = 1.4  # 40% over cost


@dataclass
class ImportRow:
    import_date: date
    oem: str
    name: str
    quantity: float
    unit: str
    unit_price_usd: float
    exchange_rate: float
    transport_cost_gel: float
    other_cost_gel: float
    total_unit_cost_gel: float
    suggested_retail_price_gel: float

    def to_dict(self) -> dict:
        return {
            "import_date": self.import_date,
            "oem": self.oem,
            "name": self.name,
            "quantity": self.quantity,
            "unit": self.unit,
            "unit_price_usd": self.unit_price_usd,
            "exchange_rate": self.exchange_rate,
            "transport_cost_gel": self.transport_cost_gel,
            "other_cost_gel": self.other_cost_gel,
            "total_unit_cost_gel": self.total_unit_cost_gel,
            "suggested_retail_price_gel": self.suggested_retail_price_gel,
        }


def _parse_date(raw) -> Optional[date]:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    s = str(raw).strip()
    for fmt in _DATE_PATTERNS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _parse_float(raw, default: float = 0.0) -> Optional[float]:
    if raw is None:
        return default
    try:
        s = re.sub(r"[^\d.,\-]", "", str(raw)).replace(",", ".")
        return float(s) if s else default
    except (ValueError, TypeError):
        return None


def parse_import_excel(buf: BytesIO) -> tuple[list[ImportRow], list[str]]:
    """Parse 9-column import Excel file.

    Returns:
        (rows, errors) — rows is a list of ImportRow dataclasses;
        errors is a list of human-readable error strings for rows that failed.
    """
    rows: list[ImportRow] = []
    errors: list[str] = []

    wb = openpyxl.load_workbook(buf, read_only=True, data_only=True)
    ws = wb.active

    fallback_date = date.today()
    last_valid_date: date = fallback_date

    for row_num, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        # Skip completely empty rows
        if not any(c is not None and str(c).strip() != "" for c in row):
            continue

        # Pad to at least 9 cells
        cells = list(row) + [None] * max(0, 9 - len(row))

        raw_date, raw_oem, raw_name, raw_qty, raw_unit, raw_price_usd, raw_rate, raw_transport, raw_other = cells[:9]

        # ── Date — carry forward last valid date if missing ──────────────────
        parsed_date = _parse_date(raw_date)
        if parsed_date is not None:
            last_valid_date = parsed_date
        import_date = last_valid_date

        # ── OEM ──────────────────────────────────────────────────────────────
        oem = sanitize_oem(raw_oem) or ""
        if not oem:
            errors.append(f"სტრიქონი {row_num}: OEM კოდი ცარიელია — გამოტოვებულია")
            continue

        # ── Name ─────────────────────────────────────────────────────────────
        name = str(raw_name).strip() if raw_name else ""
        if not name:
            errors.append(f"სტრიქონი {row_num}: დასახელება ცარიელია — გამოტოვებულია")
            continue

        # ── Quantity ─────────────────────────────────────────────────────────
        qty = _parse_float(raw_qty)
        if qty is None or qty <= 0:
            errors.append(f"სტრიქონი {row_num} ({oem}): არასწორი რაოდენობა '{raw_qty}' — გამოტოვებულია")
            continue

        # ── Unit ─────────────────────────────────────────────────────────────
        unit = str(raw_unit).strip() if raw_unit else "ც"
        if not unit:
            unit = "ც"

        # ── Unit price USD ────────────────────────────────────────────────────
        unit_price_usd = _parse_float(raw_price_usd)
        if unit_price_usd is None or unit_price_usd < 0:
            errors.append(f"სტრიქონი {row_num} ({oem}): არასწორი ფასი '{raw_price_usd}' — გამოტოვებულია")
            continue

        # ── Exchange rate ─────────────────────────────────────────────────────
        exchange_rate = _parse_float(raw_rate)
        if exchange_rate is None or exchange_rate <= 0:
            errors.append(f"სტრიქონი {row_num} ({oem}): არასწორი კურსი '{raw_rate}' — გამოტოვებულია")
            continue

        # ── Transport & other costs (empty = 0) ──────────────────────────────
        transport = _parse_float(raw_transport, default=0.0)
        if transport is None or transport < 0:
            transport = 0.0

        other = _parse_float(raw_other, default=0.0)
        if other is None or other < 0:
            other = 0.0

        # ── Computed fields ───────────────────────────────────────────────────
        total_cost = round((unit_price_usd * exchange_rate) + transport + other, 4)
        suggested = round(total_cost * RETAIL_MARKUP, 4)

        rows.append(ImportRow(
            import_date=import_date,
            oem=oem,
            name=name,
            quantity=qty,
            unit=unit,
            unit_price_usd=unit_price_usd,
            exchange_rate=exchange_rate,
            transport_cost_gel=transport,
            other_cost_gel=other,
            total_unit_cost_gel=total_cost,
            suggested_retail_price_gel=suggested,
        ))

    wb.close()
    return rows, errors
