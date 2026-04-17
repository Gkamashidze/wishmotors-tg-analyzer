"""System prompt + input formatter for the AI Financial Manager.

Design principles (senior-prompt-engineer):
    - Single, narrowly-scoped role.
    - Explicit, machine-checkable output contract (Telegram-safe HTML, length cap).
    - Few-shot example anchors style and brevity.
    - Structured JSON input — no ambiguity about which number is which.
    - Decisive, action-verb language; no hedging.
"""

from __future__ import annotations

import json
from typing import Any, Dict

# ─── System prompt ────────────────────────────────────────────────────────────
# Loaded once per process, reused across calls. Keep stable for prompt caching.

SYSTEM_PROMPT = """\
შენ ხარ "WishMotors"-ის ფინანსური მენეჯერი — ავტონაწილების მაღაზიის გამოცდილი ანალიტიკოსი.

შენი ამოცანაა JSON-ში მოწოდებული ფინანსური მონაცემების მიხედვით დაწერო კვირის \
მოკლე ბიზნეს-ანალიზი მფლობელისთვის. ეს ტექსტი ემატება Telegram ბოტის კვირის \
ანგარიშის ბოლოს.

წესები:
1. გამოიყენე მხოლოდ ქართული ენა.
2. ტექსტი არ უნდა აღემატებოდეს 500 სიმბოლოს.
3. დაწერე 3-დან 5 ბულეთამდე — თითო ხაზი = თითო კონკრეტული რჩევა ან დასკვნა.
4. ციფრები ყოველთვის ლარში (₾), დამრგვალებული 1 ციფრამდე ან მთლიანში.
5. იყავი მკვეთრი და კონკრეტული. გამოიყენე მოქმედებითი ზმნა: \
"შეუკვეთე", "გაზარდე", "შემოიტანე", "გადაიტანე", "შეამცირე", "დარეკე".
6. არასოდეს გაიმეორო ანგარიშის უკვე ნაჩვენები ციფრები — დაუმატე ღირებული მოსაზრება, \
არა შეჯამება.
7. გამოიყენე Telegram-ისთვის უსაფრთხო HTML მხოლოდ ამ ტეგებით: <b>, <i>.
8. დააფოკუსირე ამ განზომილებებზე (პრიორიტეტი ზევიდან ქვემოთ):
   • <b>WAC დრიფტი</b> — თუ `wac_top_products[*].cost_drift_pct` > +5%, \
მიმწოდებლის ფასი გაძვირდა: ურჩიე საცალო ფასის ზრდა იმავე %-ით, რომ მარჟა \
არ შემცირდეს. თუ < −5%, დრო ფასდაკლებისთვის და მოცულობის ზრდისთვის.
   • <b>მარჟის კომპრესია</b> — `top_products_by_profit[*].margin_pct` < 20% \
ნიშნავს ცუდ მარჟას; > 40% კარგი მარჟაა. დააკავშირე WAC დრიფტთან.
   • <b>შეკვეთების შეფერხება</b> — `orders_pipeline.oldest_pending_days` > 7 \
ნიშნავს, რომ მიმწოდებელი აყოვნებს; ურჩიე კონკრეტული მოქმედება. \
`urgent_pending` > 3 — სასწრაფოა.
   • <b>მარაგის რისკი</b> — `restock_alerts[*].days_of_cover` < 7 — სასწრაფო \
შეკვეთა; ხაზი გაუსვი ყველაზე მოკლე კოვერს.
   • <b>ქეშფლოუ</b> — `accounts_receivable_gel` > `cash_on_hand_gel` \
ნიშნავს ლიკვიდურობის რისკს — დარეკე კლიენტებზე.
9. თუ მონაცემი ცარიელია ან ნულოვანია — არ მოიგონო რიცხვები. ეს თქვი პირდაპირ.
10. არ დაამატო შესავალი ან დახურვა (არ თქვა "გამარჯობა", "იმედი მაქვს" და ა.შ.).
11. ყოველ ბულეთში იყოს: <b>რა</b> + ფაქტი (რიცხვი) + <b>რა უნდა გაკეთდეს</b>.

ფორმატი (ზუსტად ასე):
🤖 <b>ფინანსური მენეჯერი:</b>
• [რჩევა 1]
• [რჩევა 2]
• [რჩევა 3]
"""


# ─── Few-shot examples ────────────────────────────────────────────────────────
# Show the model the exact tone, length, and decisiveness expected.

_FEWSHOT_INPUT = {
    "overview": {
        "revenue_gel": 4820.0,
        "gross_profit_gel": 1410.0,
        "gross_margin_pct": 29.3,
        "net_profit_gel": 980.0,
        "sales_count": 47,
    },
    "cashflow": {
        "cash_on_hand_gel": 2150.0,
        "accounts_receivable_gel": 720.0,
        "period_net_cashflow_gel": 1180.0,
    },
    "top_products_by_profit": [
        {"name": "მარჯვენა რეფლექტორი", "profit_gel": 380.0, "margin_pct": 41.2},
        {"name": "სარკე VW Golf 6", "profit_gel": 295.0, "margin_pct": 17.5},
    ],
    "restock_alerts": [
        {
            "name": "უკანა სამუხრუჭე ხუნდი",
            "current_stock": 3,
            "days_of_cover": 4.5,
            "suggested_order_qty": 18,
        },
    ],
    "wac_top_products": [
        {
            "name": "სარკე VW Golf 6",
            "wac_per_unit_gel": 38.5,
            "last_purchase_cost_gel": 43.2,
            "cost_drift_pct": 12.2,
            "inventory_value_gel": 1155.0,
        },
        {
            "name": "მარჯვენა რეფლექტორი",
            "wac_per_unit_gel": 54.0,
            "last_purchase_cost_gel": 52.1,
            "cost_drift_pct": -3.5,
            "inventory_value_gel": 2160.0,
        },
    ],
    "orders_pipeline": {
        "total_pending": 5,
        "urgent_pending": 2,
        "normal_pending": 3,
        "low_pending": 0,
        "oldest_pending_days": 11,
        "top_pending_products": [
            {"name": "წინა ბამპერი Opel Astra", "qty_needed": 2, "max_priority": "urgent"},
        ],
    },
}

_FEWSHOT_OUTPUT = """\
🤖 <b>ფინანსური მენეჯერი:</b>
• <b>სარკე VW Golf 6</b>-ის შესყიდვა 12%-ით გაძვირდა (WAC 38.5₾→ 43.2₾), მარჟა 17%-მდე ჩავიდა — გაზარდე საცალო ფასი ~12%-ით, სანამ ზარალში გადახვა.
• <b>უკანა სამუხრუჭე ხუნდი</b> 4-5 დღეში გათავდება — სასწრაფოდ შეუკვეთე 18ც.
• 2 სასწრაფო შეკვეთა 11 დღე ელოდება — დარეკე მიმწოდებელს დღესვე, განსაკუთრებით <b>წინა ბამპერი Opel Astra</b>-ზე.
• ნისიის ნაშთი 720₾ ხელზე 2150₾-ს ფარავს — დარეკე კლიენტებს გადახდის შეხსენებაზე."""


def build_user_message(snapshot_dict: Dict[str, Any], period_label: str) -> str:
    """Wrap the financial snapshot in a single user message.

    period_label: e.g. "10.04.2026 — 17.04.2026"
    """
    return (
        f"პერიოდი: {period_label}\n"
        "ფინანსური მონაცემები (JSON):\n"
        f"{json.dumps(snapshot_dict, ensure_ascii=False, indent=2)}\n\n"
        "დაწერე ანალიზი ზემოთ მოცემული წესების მიხედვით."
    )


def build_messages(snapshot_dict: Dict[str, Any], period_label: str) -> list:
    """Return the messages array for the Anthropic Messages API.

    Few-shot example is included as an assistant turn so the style anchors
    transfer reliably even at low temperature.
    """
    return [
        {
            "role": "user",
            "content": build_user_message(_FEWSHOT_INPUT, "მაგალითი — წინა კვირა"),
        },
        {"role": "assistant", "content": _FEWSHOT_OUTPUT},
        {
            "role": "user",
            "content": build_user_message(snapshot_dict, period_label),
        },
    ]
