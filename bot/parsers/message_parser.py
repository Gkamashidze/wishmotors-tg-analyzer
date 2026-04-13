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
from typing import List, Optional, Tuple

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
    # Split-payment marker fields (set when "მომცა/ხელზე X დარჩა Y" is parsed)
    is_split_payment: bool = False
    split_paid: float = 0.0   # cash portion already received


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


# ─── Expense category detection ──────────────────────────────────────────────

_CATEGORY_RULES: List[tuple] = [
    (re.compile(r"ბენზინ|საწვავ|ნავთ|fuel|petrol|gas(?:oline)?", re.UNICODE | re.IGNORECASE), "fuel"),
    (re.compile(r"საბაჟ|customs?|tax(?:es)?|გადასახ|ბაჟ", re.UNICODE | re.IGNORECASE), "customs"),
    (re.compile(r"დელივ|კურიერ|გაგზავნ|მიტან|deliver|courier|shipping|postal|ფოსტ", re.UNICODE | re.IGNORECASE), "delivery"),
    (re.compile(r"სერვის|სარემონტ|შეკეთ|repair|service|მოვლ", re.UNICODE | re.IGNORECASE), "maintenance"),
    (re.compile(r"რეკლამ|advertis|marketing|მარკეტ|promotion", re.UNICODE | re.IGNORECASE), "marketing"),
    (re.compile(r"ოფის|office|კანცელარ|stationer", re.UNICODE | re.IGNORECASE), "office"),
    (re.compile(r"კომუნალ|utility|utilities|electric|წყალ|გაზ(?:ი)?$|ელ\.?ენ", re.UNICODE | re.IGNORECASE), "utilities"),
    (re.compile(r"ხელფას|salary|სახელფ|მუშა|employee|staff", re.UNICODE | re.IGNORECASE), "salary"),
    (re.compile(r"სადაზღვ|insurance|დაზღვ", re.UNICODE | re.IGNORECASE), "insurance"),
    (re.compile(r"ტრანსპ|transport|მანქან|car|auto|სატვ", re.UNICODE | re.IGNORECASE), "transport"),
]


def detect_expense_category(description: str) -> Optional[str]:
    """Return the first matching category key for the given expense description, or None."""
    for pattern, category in _CATEGORY_RULES:
        if pattern.search(description):
            return category
    return None


# ─── Keyword patterns ─────────────────────────────────────────────────────────

_CASH_RE = re.compile(r"ხელ[ზბ]?[ე-ს]?|ქეში|ნაღ|მომც|გადაიხად", re.UNICODE | re.IGNORECASE)
_TRANSFER_RE = re.compile(
    r"გადარ|დარიცხ|ტრანსფ|გადაქ|transfer|ბარათ|კარტ|დავურიცხ",
    re.UNICODE | re.IGNORECASE,
)
_LLC_RE = re.compile(r"შპს\s*-?\s*დან|შპსდან", re.UNICODE | re.IGNORECASE)
_RETURN_RE = re.compile(r"დაბრუნება|გაცვლა", re.UNICODE | re.IGNORECASE)
# "ნისია" / "ნისიები" used inline (e.g. "სარკე 1ც 30₾ ნისიები") → credit, not customer name
_CREDIT_KEYWORD_RE = re.compile(r"^ნისი", re.UNICODE | re.IGNORECASE)
# "დარჩა 100ლ" split-payment leftover — strip from customer name
_DARCHA_STRIP_RE = re.compile(r"\s*\bდარჩ\S*(?:\s+\d+[₾ლ]?)?\s*", re.UNICODE)

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

# Pattern A: "product Nც [/] [ჯამში] PRICEლ/₾ [rest...]"
# Accepts slash separator between qty and price: 1ც/30₾
# Accepts "ჯამში" before price to indicate total price (unit = total / qty)
_SALE_A = re.compile(
    r"^(?P<product>.+?)\s+"
    r"(?P<qty>\d+(?:\.\d+)?)\s*ც\s*[/]?\s*"
    r"(?P<total_flag>ჯამში\s+)?"
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

# Phone number — silently ignored in sales topic (contact info, not a sale).
# Covers: +995 592 15 90 52  |  592159052  |  555 12 34 56  |  032 2 XX XX XX
_PHONE_RE = re.compile(
    r"^\+[\d\s\-().]{8,}$"     # international: +995...
    r"|^5\d{8}$"               # Georgian mobile local: 5XXXXXXXX (9 digits)
    r"|^5\d{2}[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2}$"  # 5XX XX XX XX
    r"|^0\d{8,9}$",            # landline with leading 0
    re.UNICODE,
)

# Split payment: "ხელზე 300 დარჩა 100ლ" or "მომცა 300ლ დარჩა 100ლ" → paid cash + remaining credit.
_SALE_SPLIT_RE = re.compile(
    r"^(?:ხელ\S*|მომც\S*)\s+(?P<paid>\d+(?:[.,]\d+)?)\s*[₾ლ]?\s+დარჩ\S*\s+(?P<remaining>\d+(?:[.,]\d+)?)\s*[₾ლ]?\s*$",
    re.UNICODE | re.IGNORECASE,
)

# Nisias batch header: "ნისიები:" or "ნისია:" alone on a line — credit indicator, skip.
_NISIAS_HEADER_RE = re.compile(r"^ნისი\S*\s*:?\s*$", re.UNICODE | re.IGNORECASE)

# Pattern F: product + price (no currency symbol), qty=1, credit (ნისია).
# Covers "ხუნდები 50" style — product name starts with a non-digit/non-symbol char.
_SALE_F = re.compile(
    r"^(?P<product>[^\d₾ლ$\+\-].+?)\s+(?P<price>\d+(?:[.,]\d+)?)\s*$",
    re.UNICODE,
)

# Pattern G: payment keyword first, then price — "მომცა 300₾" / "ხელზე 500"
# Covers partial or full cash/transfer notes where no product name is given.
_SALE_G = re.compile(
    r"^(?P<kw>\S+)\s+(?P<price>\d+(?:[.,]\d+)?)\s*[₾ლ]?\s*$",
    re.UNICODE,
)

# Pattern DUAL: "product1 და product2 N1-N2ც [ჯამში] PRICE[ლ/₾]"
# Two products sharing a combined price. Price is always the total; split equally.
# product2 must be a single word (OEM code) to avoid ambiguity.
_SALE_DUAL = re.compile(
    r"^(?P<product1>.+?)\s+და\s+(?P<product2>\S+)\s+"
    r"(?P<qty1>\d+)-(?P<qty2>\d+)\s*ც\s*"
    r"(?:ჯამში\s+)?"
    r"(?P<price>\d+(?:[.,]\d+)?)\s*[₾ლ]?"
    r"(?:\s+(?P<rest>.+))?\s*$",
    re.UNICODE,
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
            if _CREDIT_KEYWORD_RE.match(token):
                payment = PAYMENT_CREDIT
                payment_found = True
                continue
        remaining.append(token)

    customer = _DARCHA_STRIP_RE.sub(" ", " ".join(remaining)).strip()
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

    # Phone numbers (e.g. "+995 592 15 90 52"): silently ignore — customer contact info.
    if _PHONE_RE.match(text):
        return None

    is_return = bool(_RETURN_RE.search(text))

    # Split payment: "ხელზე/მომცა 300 დარჩა 100ლ" → paid 300 cash, 100 credit remaining.
    m = _SALE_SPLIT_RE.match(text)
    if m:
        paid = _parse_price(m.group("paid"))
        remaining = _parse_price(m.group("remaining"))
        return ParsedSale(
            raw_product=f"ხელზე {paid:.0f}₾ + დარჩა {remaining:.0f}₾",
            quantity=1,
            price=paid + remaining,
            payment_method=PAYMENT_CASH,
            is_return=False,
            is_split_payment=True,
            split_paid=paid,
        )

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

    # Pattern A: full free-form "product Nც [ჯამში] PRICEლ [rest]"
    m = _SALE_A.match(text)
    if m:
        product_raw = m.group("product").strip()
        qty = int(float(m.group("qty")))
        raw_price = _parse_price(m.group("price"))
        # "ჯამში" means the price is the total; derive unit price
        unit_price = (raw_price / qty) if (m.group("total_flag") and qty > 0) else raw_price
        payment, seller, customer = _parse_rest(m.group("rest"))
        # LLC keyword may appear before the quantity (e.g., "სარკე შპსდან 1ც 30₾")
        if seller == "individual" and _LLC_RE.search(product_raw):
            seller = "llc"
            product_raw = _LLC_RE.sub("", product_raw).strip()
        return ParsedSale(
            raw_product=product_raw,
            quantity=qty,
            price=unit_price,
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

    # Pattern G: payment keyword first + price — "მომცა 300₾" / "ხელზე 500"
    # Must be checked before E/F so the keyword is not treated as a product name.
    m = _SALE_G.match(text)
    if m:
        kw = m.group("kw")
        if _CASH_RE.search(kw):
            return ParsedSale(
                raw_product="", quantity=1, price=_parse_price(m.group("price")),
                payment_method=PAYMENT_CASH, is_return=is_return,
            )
        if _TRANSFER_RE.search(kw):
            return ParsedSale(
                raw_product="", quantity=1, price=_parse_price(m.group("price")),
                payment_method=PAYMENT_TRANSFER, is_return=is_return,
            )
        # kw is not a payment keyword → fall through to Pattern E

    # Pattern E: product + price, payment optional (no keyword → credit/ნისია).
    # Since this runs only for messages in the sales topic, credit default is safe.
    m = _SALE_E.match(text)
    if m:
        product_raw = m.group("product").strip()
        payment, seller, customer = _parse_rest(m.group("rest"))
        # LLC keyword may appear in the product field before the price
        # e.g., "უპორნები შპსდან 350ლ" → product="უპორნები", seller=llc
        if seller == "individual" and _LLC_RE.search(product_raw):
            seller = "llc"
            product_raw = _LLC_RE.sub("", product_raw).strip()
        return ParsedSale(
            raw_product=product_raw,
            quantity=1,
            price=_parse_price(m.group("price")),
            payment_method=payment,
            is_return=is_return,
            seller_type=seller,
            customer_name=customer,
        )

    # Pattern F: product + price (no currency symbol), qty=1, credit.
    # Covers "ხუნდები 50" style where the ₾/ლ symbol is omitted.
    m = _SALE_F.match(text)
    if m:
        return ParsedSale(
            raw_product=m.group("product").strip(),
            quantity=1,
            price=_parse_price(m.group("price")),
            payment_method=PAYMENT_CREDIT,
            is_return=is_return,
            seller_type="individual",
            customer_name="",
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
        desc = m.group("desc").strip()
        return ParsedExpense(
            amount=_parse_price(m.group("amount")),
            description=desc,
            category=detect_expense_category(desc),
        )

    m = _EXPENSE_AMOUNT_FIRST.match(text)
    if m:
        desc = m.group("desc").strip()
        return ParsedExpense(
            amount=_parse_price(m.group("amount")),
            description=desc,
            category=detect_expense_category(desc),
        )

    m = _EXPENSE_DESC_FIRST.match(text)
    if m:
        desc = m.group("desc").strip()
        return ParsedExpense(
            amount=_parse_price(m.group("amount")),
            description=desc,
            category=detect_expense_category(desc),
        )

    return None


def parse_dual_sale_message(text: str) -> Optional[List[ParsedSale]]:
    """
    Parse 'product1 და product2 N1-N2ც [ჯამში] PRICEლ' into two ParsedSale objects.

    The price is always treated as the combined total and split equally between
    the two products.  Each unit price = (total / 2) / qty_per_product.

    Examples:
      "008b03 და 108000 1-1ც ჯამში 210"  → two sales, unit price 105 each
      "09003 და 09013 2-2ც ჯამში 280ლ"   → two sales, unit price 70 each
    """
    text = _normalize_text(text.strip())
    m = _SALE_DUAL.match(text)
    if not m:
        return None

    product1 = m.group("product1").strip()
    product2 = m.group("product2").strip()
    qty1 = int(m.group("qty1"))
    qty2 = int(m.group("qty2"))
    total = _parse_price(m.group("price"))
    payment, seller, customer = _parse_rest(m.group("rest"))

    # Split total equally; derive unit price per product
    half = total / 2
    unit1 = half / qty1 if qty1 > 0 else half
    unit2 = half / qty2 if qty2 > 0 else half

    return [
        ParsedSale(raw_product=product1, quantity=qty1, price=unit1,
                   payment_method=payment, seller_type=seller, customer_name=customer),
        ParsedSale(raw_product=product2, quantity=qty2, price=unit2,
                   payment_method=payment, seller_type=seller, customer_name=customer),
    ]


def parse_batch_sales(
    text: str,
) -> Tuple[Optional[str], List[Optional[List[ParsedSale]]]]:
    """
    Parse a multi-line sales message where all items share one customer.

    Supported formats:
      იმედა:                          ← customer name header (old format)
      პადვესნოი 1ც 150ლ               ← single sale

      ნისიები:                        ← credit indicator — skipped
      კოხტაშვილი:                     ← customer name on next line
      136001 2ც ჯამში 360ლ            ← sales...

      ნისიები:                        ← credit indicator — skipped
      595254272                        ← phone number as customer
      109000 ... 1ც 180ლ

      008b03 და 108000 1-1ც ჯამში 210  ← dual sale → two ParsedSale entries
      მომცა 300ლ დარჩა 100ლ           ← split payment line

    Returns (customer_name, items) where each item is:
      None              — line could not be parsed
      [ParsedSale]      — single sale (last may be a split-payment marker)
      [sale1, sale2]    — dual sale (X და Y format)
    """
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    if not lines:
        return None, []

    customer_name: Optional[str] = None

    # Skip standalone "ნისიები:" / "ნისია:" credit indicator
    if _NISIAS_HEADER_RE.match(lines[0]):
        lines = lines[1:]
        if not lines:
            return None, []

    # First non-sale line becomes the customer header
    first_clean = lines[0].rstrip(":")
    if not parse_sale_message(first_clean) and not parse_dual_sale_message(first_clean):
        customer_name = first_clean
        sale_lines = lines[1:]
    else:
        sale_lines = lines

    results: List[Optional[List[ParsedSale]]] = []
    for line in sale_lines:
        # Silently skip standalone phone numbers in sale lines (contact info, not a sale).
        # Note: phones on the customer-name line are already captured above.
        if _PHONE_RE.match(_normalize_text(line)):
            continue

        # Try dual format first ("X და Y N-Nც ...")
        dual = parse_dual_sale_message(line)
        if dual is not None:
            if customer_name:
                for s in dual:
                    if not s.customer_name:
                        s.customer_name = customer_name
            results.append(dual)
            continue

        # Try single sale
        parsed = parse_sale_message(line)
        if parsed is not None:
            if not parsed.customer_name and customer_name:
                parsed.customer_name = customer_name
            results.append([parsed])
        else:
            results.append(None)

    return customer_name, results


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
