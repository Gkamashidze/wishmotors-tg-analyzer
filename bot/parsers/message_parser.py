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

_CASH_RE = re.compile(r"ხელ[ზბ]?[ე]?|ქეში|ნაღ", re.UNICODE | re.IGNORECASE)
_TRANSFER_RE = re.compile(
    r"გადარ|დარიცხ|ტრანსფ|გადაქ|transfer|ბარათ|კარტ",
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

# Expense: amount-first or description-first
_EXPENSE_AMOUNT_FIRST = re.compile(
    r"^(?P<amount>\d+(?:[.,]\d+)?)\s*[₾ლ]\s+(?P<desc>.+)$", re.UNICODE
)
_EXPENSE_DESC_FIRST = re.compile(
    r"^(?P<desc>.+?)\s+(?P<amount>\d+(?:[.,]\d+)?)\s*[₾ლ]\s*$", re.UNICODE
)

# Order: "product Nც" (no price)
_ORDER_RE = re.compile(
    r"^(?P<product>.+?)\s+(?P<qty>\d+)\s*ც\s*$", re.UNICODE
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

    Payment rules:
      explicit cash keyword   → PAYMENT_CASH
      explicit transfer kw    → PAYMENT_TRANSFER
      no payment text         → PAYMENT_CREDIT (ნისია)
    """
    text = _normalize_text(text.strip())
    is_return = bool(_RETURN_RE.search(text))

    # Try explicit კოდი: prefix first
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

    # Try free-form pattern
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

    return None


def parse_expense_message(text: str) -> Optional[ParsedExpense]:
    """Parse an expense message like '50₾ ბენზინი' or 'ბენზინი 50₾'."""
    text = _normalize_text(text.strip())

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
    """Parse a re-order note like '8390132500 5ც' or 'მარჭვენა სარკე 2ც'."""
    text = _normalize_text(text.strip())
    m = _ORDER_RE.match(text)
    if not m:
        return None
    return ParsedOrder(
        raw_product=m.group("product").strip(),
        quantity=int(m.group("qty")),
        notes=text,
    )
