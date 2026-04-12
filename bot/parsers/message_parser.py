"""
Georgian sales message parser.

Supported sale formats:
  მარჭვენა რეფლექტორი 1ც 30₾ ხელზე
  8390132500 2ც 45₾ გადარიცხვა
  8390132500 2ც 45₾ დარიცხა
  კოდი: 8390132500, 1ც, 35₾
  სარკე 1ც 30₾                      ← გადახდა გამოტოვებულია = ნისია

Payment logic:
  ხელზე / ქეში / ნაღდი / ნაღ  → cash
  გადარიცხვა / დარიცხა / გადარ / ბარათი / კარტი  → transfer
  (nothing)                    → credit (ნისია)

Seller type:
  შპსდან / შპს-დან anywhere in message  → llc
  (nothing)                              → individual (ფზ)

Customer name:
  Any remaining text after payment keyword and seller type keyword is the customer name.
  Examples:
    სარკე 1ც 30₾ გიო              → credit, individual, customer="გიო"
    სარკე 1ც 30₾ ხელზე გიო        → cash,   individual, customer="გიო"
    სარკე 1ც 30₾ შპსდან            → credit, llc,        no customer
    სარკე 1ც 30₾ ხელზე შპსდან გიო  → cash,   llc,        customer="გიო"

Return detection: message contains  დაბრუნება  or  გაცვლა

Expense format:
  50₾ ბენზინი   |   ბენზინი 50₾

Order format:
  8390132500 5ც   |   მარჭვენა სარკე 2ც
"""

import re
from dataclasses import dataclass
from typing import Optional, Tuple

PAYMENT_CASH = "cash"
PAYMENT_TRANSFER = "transfer"
PAYMENT_CREDIT = "credit"   # ნისია — გადახდა გამოტოვებულია


# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class ParsedSale:
    raw_product: str       # product name or OEM exactly as written
    quantity: int
    price: float
    payment_method: str    # cash | transfer | credit
    is_return: bool = False
    seller_type: str = "individual"   # individual (ფზ) | llc (შპს)
    customer_name: str = ""
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


# ─── Keyword patterns ─────────────────────────────────────────────────────────

_CASH_RE = re.compile(r"ხელ[ზბ]?[ე-ს]?|ქეში|ნაღ|მომც|გადაიხად", re.UNICODE | re.IGNORECASE)
_TRANSFER_RE = re.compile(
    r"გადარ|დარიცხ|ტრანსფ|გადაქ|transfer|ბარათ|კარტ|დავურიცხ",
    re.UNICODE | re.IGNORECASE,
)
_LLC_RE = re.compile(r"შპს\s*-?\s*დან|შპსდან", re.UNICODE | re.IGNORECASE)
_RETURN_RE = re.compile(r"დაბრუნება|გაცვლა", re.UNICODE | re.IGNORECASE)

# Emoji strip
_EMOJI_RE = re.compile(
    "[\U00002300-\U0000275f"
    "\U00002702-\U000027b0"
    "\U0001f000-\U0001f9ff"
    "\U00002500-\U00002bef"
    "\U0000fe00-\U0000fe0f"
    "\U0001fa00-\U0001fa6f"
    "\U0001fa70-\U0001faff"
    "]+",
    re.UNICODE,
)

# Comma in price: 12,50₾ → 12.50₾
_COMMA_PRICE_RE = re.compile(r"(\d+),(\d+)\s*([₾ლ])")


# ─── Regex patterns ───────────────────────────────────────────────────────────

# Pattern A: "product Nც [/] PRICEლ/₾ [rest...]"
# Accepts slash separator between qty and price: 1ც/30₾
_SALE_A = re.compile(
    r"^(?P<product>.+?)\s+"
    r"(?P<qty>\d+(?:\.\d+)?)\s*ც\s*[/]?\s*"
    r"(?P<price>\d+(?:\.\d+)?)\s*[₾ლ]"
    r"(?:\s+(?P<rest>.+))?"
    r"\s*$",
    re.UNICODE,
)

# Pattern B: "კოდი: OEM, Nც, PRICEლ/₾ [, rest...]"
_SALE_B = re.compile(
    r"კოდი\s*:\s*(?P<product>[^\s,]+)\s*,\s*"
    r"(?P<qty>\d+(?:\.\d+)?)\s*ც\s*,\s*"
    r"(?P<price>\d+(?:\.\d+)?)\s*[₾ლ]"
    r"(?:\s*,\s*(?P<rest>.+))?",
    re.UNICODE | re.IGNORECASE,
)

# Pattern C: "PRICEლ/₾ [rest]"  ← 30ლ ხელზე / 30ლ დარიცხა
# No product or quantity — price-only shorthand.
# qty defaults to 1, product recorded as empty.
_SALE_C = re.compile(
    r"^(?P<price>\d+(?:[.,]\d+)?)\s*[₾ლ$](?:\s+(?P<rest>.+))?\s*$",
    re.UNICODE,
)

# Pattern D: "Nც PRICEლ [rest]"  ← 1ც 40ლ დარიცხა / 2ც 80ლ ხელზე
# Quantity + price, no product name.
_SALE_D = re.compile(
    r"^(?P<qty>\d+)\s*ც\s+(?P<price>\d+(?:[.,]\d+)?)\s*[₾ლ$](?:\s+(?P<rest>.+))?\s*$",
    re.UNICODE,
)

# Pattern E: "PRODUCT PRICEლ PAYMENT"  ← ტროსი 150 ლ ხელზე
# Product name + price (no qty). Payment keyword is REQUIRED to distinguish from expenses.
# Space between price digits and ლ is allowed.
_SALE_E = re.compile(
    r"^(?P<product>.+?)\s+(?P<price>\d+(?:[.,]\d+)?)\s*[₾ლ$](?:\s+(?P<rest>.+))?\s*$",
    re.UNICODE,
)

# Expense: amount-first or description-first (positive). $ accepted too.
_EXPENSE_AMOUNT_FIRST = re.compile(
    r"^(?P<amount>\d+(?:[.,]\d+)?)\s*[₾ლ$]\s+(?P<desc>.+)$", re.UNICODE
)
_EXPENSE_DESC_FIRST = re.compile(
    r"^(?P<desc>.+?)\s+(?P<amount>\d+(?:[.,]\d+)?)\s*[₾ლ$]\s*$", re.UNICODE
)
# Expense: negative shorthand  "-11 დელივო"  "-20ლ საბაჟო"  "-10გაგზავნა"  "-22$ რეკლამა"
_EXPENSE_NEGATIVE = re.compile(
    r"^-\s*(?P<amount>\d+(?:[.,]\d+)?)\s*[₾ლ$]?\s*(?P<desc>\S.*)$", re.UNICODE
)

# Order: "product Nც" (no price)
_ORDER_RE = re.compile(
    r"^(?P<product>.+?)\s+(?P<qty>\d+)\s*ც\s*$", re.UNICODE
)
# Order: just "Nც" alone (reply to a product message)
_ORDER_QTY_ONLY = re.compile(r"^\d+\s*ც$", re.UNICODE)

# Order: product name only, no quantity (qty stored as 0)
# Must have at least 2 Georgian characters to avoid false positives.
# Must NOT contain a price indicator (₾ ლ $).
_ORDER_PRODUCT_ONLY = re.compile(
    r"^[^\d₾ლ$\-].{3,}$", re.UNICODE
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _normalize_text(text: str) -> str:
    """Strip emoji, normalize whitespace, convert comma-price to dot-price."""
    text = _EMOJI_RE.sub(" ", text)
    text = _COMMA_PRICE_RE.sub(lambda m: f"{m.group(1)}.{m.group(2)}{m.group(3)}", text)
    return " ".join(text.split())


def _parse_rest(rest: Optional[str]) -> Tuple[str, str, str]:
    """
    Parse the 'rest' text that follows the price in a sale message.

    Returns (payment_method, seller_type, customer_name).

    Processing order:
      1. Remove LLC keyword if present → seller_type = 'llc'
      2. Find first payment keyword → payment_method
      3. Remaining tokens → customer_name
    """
    if not rest:
        return PAYMENT_CREDIT, "individual", ""

    rest = rest.strip()
    seller = "individual"

    # Detect and remove LLC keyword first
    llc_match = _LLC_RE.search(rest)
    if llc_match:
        seller = "llc"
        rest = (rest[: llc_match.start()] + rest[llc_match.end():]).strip()

    # Walk tokens to find first payment keyword
    tokens = rest.split()
    payment = PAYMENT_CREDIT
    payment_found = False
    remaining: list = []

    for token in tokens:
        if not payment_found:
            if _CASH_RE.search(token):
                payment = PAYMENT_CASH
                payment_found = True
                continue
            if _TRANSFER_RE.search(token):
                payment = PAYMENT_TRANSFER
                payment_found = True
                continue
        remaining.append(token)

    customer = " ".join(remaining).strip()
    return payment, seller, customer


def _parse_price(raw: str) -> float:
    return float(raw.replace(",", "."))


# ─── Public API ───────────────────────────────────────────────────────────────

def parse_sale_message(text: str) -> Optional[ParsedSale]:
    """
    Try to parse a Georgian sales (or return) message.
    Returns ParsedSale on success, None if the message doesn't match any pattern.

    Supported patterns:
      A: "product Nც PRICEლ [rest]"   — full format
      B: "კოდი: OEM, Nც, PRICEლ"      — OEM prefix format
      C: "PRICEლ [rest]"               — price-only shorthand (qty=1, product unknown)

    Payment rules:
      explicit cash keyword   → PAYMENT_CASH
      explicit transfer kw    → PAYMENT_TRANSFER
      no payment text         → PAYMENT_CREDIT (ნისია)
    """
    text = _normalize_text(text.strip())
    is_return = bool(_RETURN_RE.search(text))

    # Pattern B: explicit კოდი: prefix
    m = _SALE_B.search(text)
    if m:
        payment, seller, customer = _parse_rest(m.group("rest"))
        return ParsedSale(
            raw_product=m.group("product").strip(),
            quantity=int(float(m.group("qty"))),
            price=_parse_price(m.group("price")),
            payment_method=payment,
            is_return=is_return,
            seller_type=seller,
            customer_name=customer,
        )

    # Pattern A: full free-form "product Nც PRICEლ [rest]"
    m = _SALE_A.match(text)
    if m:
        payment, seller, customer = _parse_rest(m.group("rest"))
        return ParsedSale(
            raw_product=m.group("product").strip(),
            quantity=int(float(m.group("qty"))),
            price=_parse_price(m.group("price")),
            payment_method=payment,
            is_return=is_return,
            seller_type=seller,
            customer_name=customer,
        )

    # Pattern D: qty+price shorthand "1ც 40ლ დარიცხა"
    m = _SALE_D.match(text)
    if m:
        payment, seller, customer = _parse_rest(m.group("rest"))
        return ParsedSale(
            raw_product="",
            quantity=int(m.group("qty")),
            price=_parse_price(m.group("price")),
            payment_method=payment,
            is_return=is_return,
            seller_type=seller,
            customer_name=customer,
        )

    # Pattern C: price-only shorthand "30ლ ხელზე" or "30ლ"
    m = _SALE_C.match(text)
    if m:
        payment, seller, customer = _parse_rest(m.group("rest"))
        return ParsedSale(
            raw_product="",
            quantity=1,
            price=_parse_price(m.group("price")),
            payment_method=payment,
            is_return=is_return,
            seller_type=seller,
            customer_name=customer,
        )

    # Pattern E: product+price with explicit payment keyword "ტროსი 150 ლ ხელზე"
    # Payment keyword is REQUIRED to distinguish sales from expenses.
    m = _SALE_E.match(text)
    if m:
        payment, seller, customer = _parse_rest(m.group("rest"))
        if payment in (PAYMENT_CASH, PAYMENT_TRANSFER):
            return ParsedSale(
                raw_product=m.group("product").strip(),
                quantity=1,
                price=_parse_price(m.group("price")),
                payment_method=payment,
                is_return=is_return,
                seller_type=seller,
                customer_name=customer,
            )

    return None


def parse_expense_message(text: str) -> Optional[ParsedExpense]:
    """
    Parse an expense message.

    Supported formats:
      '50₾ ბენზინი'    — amount first
      'ბენზინი 50₾'    — description first
      '-11 დელივო'     — negative shorthand (minus prefix, no ₾ required)
      '-20ლ საბაჟო'    — negative shorthand with ლ
    """
    text = _normalize_text(text.strip())

    # Negative shorthand: "-11 დელივო" or "-20ლ საბაჟო"
    m = _EXPENSE_NEGATIVE.match(text)
    if m:
        return ParsedExpense(
            amount=_parse_price(m.group("amount")),
            description=m.group("desc").strip(),
        )

    m = _EXPENSE_AMOUNT_FIRST.match(text)
    if m:
        return ParsedExpense(
            amount=_parse_price(m.group("amount")),
            description=m.group("desc").strip(),
        )

    m = _EXPENSE_DESC_FIRST.match(text)
    if m:
        return ParsedExpense(
            amount=_parse_price(m.group("amount")),
            description=m.group("desc").strip(),
        )

    return None


def parse_order_message(text: str) -> Optional[ParsedOrder]:
    """
    Parse a re-order note.

    Supported formats:
      '8390132500 5ც'     — OEM + quantity
      'მარჭვენა სარკე 2ც' — product name + quantity
      '20ც'               — quantity only (reply to a product message)
    """
    text = _normalize_text(text.strip())

    # Quantity-only: "20ც" (reply context — product unknown)
    if _ORDER_QTY_ONLY.match(text):
        qty = int(text.replace("ც", "").strip())
        return ParsedOrder(raw_product="", quantity=qty, notes=text)

    # Product + quantity
    m = _ORDER_RE.match(text)
    if m:
        return ParsedOrder(
            raw_product=m.group("product").strip(),
            quantity=int(m.group("qty")),
            notes=text,
        )

    # Product name only (no quantity — qty=0 means "need some amount")
    # Requires at least 4 chars, no price symbol, starts with letter.
    if _ORDER_PRODUCT_ONLY.match(text) and "₾" not in text and "$" not in text:
        return ParsedOrder(raw_product=text, quantity=0, notes=text)

    return None
