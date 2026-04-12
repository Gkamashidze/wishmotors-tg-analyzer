"""
Georgian sales message parser.

Supported sale formats:
  მარჭვენა რეფლექტორი 1ც 30₾ ხელზე
  8390132500 2ც 45₾ გადარიცხვა
  კოდი: 8390132500, 1ც, 35₾

Return detection: message contains  დაბრუნება  or  გაცვლა

Expense format:
  50₾ ბენზინი   |   ბენზინი 50₾

Order format:
  8390132500 5ც   |   მარჭვენა სარკე 2ც
"""

import re
from dataclasses import dataclass
from typing import Optional

PAYMENT_CASH = "cash"
PAYMENT_TRANSFER = "transfer"
PAYMENT_UNKNOWN = "unknown"


# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class ParsedSale:
    raw_product: str       # product name or OEM exactly as written
    quantity: int
    price: float
    payment_method: str
    is_return: bool = False
    notes: str = ""


@dataclass
class ParsedExpense:
    amount: float
    description: str
    category: Optional[str] = None


@dataclass
class ParsedOrder:
    raw_product: str
    quantity: int
    notes: str = ""


# ─── Regex patterns ───────────────────────────────────────────────────────────

# Pattern A: "product Nც PRICEლ/₾ [payment]"
# e.g. "მარჭვენა რეფლექტორი 1ც 30₾ ხელზე"
_SALE_A = re.compile(
    r"^(?P<product>.+?)\s+"
    r"(?P<qty>\d+(?:\.\d+)?)\s*ც\s+"
    r"(?P<price>\d+(?:\.\d+)?)\s*[₾ლ]"
    r"(?:\s+(?P<payment>\S+))?"
    r"\s*$",
    re.UNICODE,
)

# Pattern B: "კოდი: OEM, Nც, PRICEლ/₾ [, payment]"
# e.g. "კოდი: 8390132500, 1ც, 35₾"
_SALE_B = re.compile(
    r"კოდი\s*:\s*(?P<product>[^\s,]+)\s*,\s*"
    r"(?P<qty>\d+(?:\.\d+)?)\s*ც\s*,\s*"
    r"(?P<price>\d+(?:\.\d+)?)\s*[₾ლ]"
    r"(?:\s*,\s*(?P<payment>\S+))?",
    re.UNICODE | re.IGNORECASE,
)

# Return keywords
_RETURN_RE = re.compile(r"დაბრუნება|გაცვლა", re.UNICODE | re.IGNORECASE)

# Expense: amount-first or description-first
_EXPENSE_AMOUNT_FIRST = re.compile(
    r"^(?P<amount>\d+(?:\.\d+)?)\s*[₾ლ]\s+(?P<desc>.+)$", re.UNICODE
)
_EXPENSE_DESC_FIRST = re.compile(
    r"^(?P<desc>.+?)\s+(?P<amount>\d+(?:\.\d+)?)\s*[₾ლ]\s*$", re.UNICODE
)

# Order: "product Nც"
_ORDER_RE = re.compile(
    r"^(?P<product>.+?)\s+(?P<qty>\d+)\s*ც\s*$", re.UNICODE
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _parse_payment(raw: Optional[str]) -> str:
    if not raw:
        return PAYMENT_CASH  # default to cash when omitted
    t = raw.strip().lower()
    if re.search(r"ხელ[ზბ]?[ე]?|ქეში|ნაღ", t):
        return PAYMENT_CASH
    if re.search(r"გადარ|ტრანსფ|გადაქ|transfer", t):
        return PAYMENT_TRANSFER
    return PAYMENT_UNKNOWN


# ─── Public API ───────────────────────────────────────────────────────────────

def parse_sale_message(text: str) -> Optional[ParsedSale]:
    """
    Try to parse a Georgian sales (or return) message.
    Returns ParsedSale on success, None if the message doesn't match any pattern.
    """
    text = text.strip()
    is_return = bool(_RETURN_RE.search(text))

    # Try explicit კოდი: prefix first
    m = _SALE_B.search(text)
    if m:
        return ParsedSale(
            raw_product=m.group("product").strip(),
            quantity=int(float(m.group("qty"))),
            price=float(m.group("price")),
            payment_method=_parse_payment(m.group("payment")),
            is_return=is_return,
        )

    # Try free-form pattern
    m = _SALE_A.match(text)
    if m:
        return ParsedSale(
            raw_product=m.group("product").strip(),
            quantity=int(float(m.group("qty"))),
            price=float(m.group("price")),
            payment_method=_parse_payment(m.group("payment")),
            is_return=is_return,
        )

    return None


def parse_expense_message(text: str) -> Optional[ParsedExpense]:
    """Parse an expense message like '50₾ ბენზინი' or 'ბენზინი 50₾'."""
    text = text.strip()

    m = _EXPENSE_AMOUNT_FIRST.match(text)
    if m:
        return ParsedExpense(
            amount=float(m.group("amount")),
            description=m.group("desc").strip(),
        )

    m = _EXPENSE_DESC_FIRST.match(text)
    if m:
        return ParsedExpense(
            amount=float(m.group("amount")),
            description=m.group("desc").strip(),
        )

    return None


def parse_order_message(text: str) -> Optional[ParsedOrder]:
    """Parse a re-order note like '8390132500 5ც' or 'მარჭვენა სარკე 2ც'."""
    text = text.strip()
    m = _ORDER_RE.match(text)
    if not m:
        return None
    return ParsedOrder(
        raw_product=m.group("product").strip(),
        quantity=int(m.group("qty")),
        notes=text,
    )
