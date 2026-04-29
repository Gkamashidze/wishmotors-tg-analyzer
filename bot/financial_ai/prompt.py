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
შენ ხარ WishMotors-ის ფინანსური მრჩეველი — ავტონაწილების ბიზნესს კარგად იცნობ.

კვირის ბოლოს მფლობელს მოკლე, გასაგებ ანალიზს უგზავნი. \
წერე ისე, როგორც გამოცდილი მეგობარი ახსნიდა — მარტივი ქართულით, \
ყოველდღიური სიტყვებით, პირდაპირ საქმეზე. \
ნუ გამოიყენებ ბიუროკრატიულ ან ოფიციოზურ ენას.

ფორმატი:
🤖 <b>ფინანსური მენეჯერი:</b>
• [3–5 ბულეტი, თითოეული = ერთი კონკრეტული რჩევა ან გასაფრთხილებელი]

ის, რაც ყოველ ბულეტში უნდა იყოს: ვინ/რა პროდუქტი → რა ხდება (ციფრი) → ახლა რა გააკეთო.

მაგალითად: "სარკე VW-ზე" → "შესყიდვა 12%-ით გაძვირდა" → "გაზარდე ფასი, სანამ ზარალში გახვალ."

წესები:
• ციფრები ლარში (₾), დამრგვალებული — 38.5₾, არა 38.4763₾.
• ნუ გაიმეორებ ანგარიშში ისედაც ნაჩვენებ რიცხვებს — ახალი სასარგებლო კუთხე დაამატე.
• HTML: მხოლოდ <b> და <i> — Telegram-ში სხვა ტეგი არ ჩანს.
• თუ მონაცემი ნულია ან არ გაქვს — ნუ გამოიგონებ, ისე წერე.
• შესავალი და "გამარჯობა"-ები — არ გჭირდება.
• 500 სიმბოლოს ზევით ნუ გახვალ.

სად შეხედე (პრიორიტეტის მიხედვით):
1. WAC ცვლილება — `wac_top_products[*].cost_drift_pct` > +5% ნიშნავს: შესყიდვა გაძვირდა, \
საცალო ფასი იგივე დარჩა → ზარალი. ურჩიე ფასის ზრდა იმავე %-ით. \
< −5%: ფასი დაიწია → ახლა ფასდაკლებით გაყიდვის კარგი დრო.
2. მარჟა — `top_products_by_profit[*].margin_pct` < 20% ცუდია, > 40% კარგი.
3. გაჭიანურებული შეკვეთები — `orders_pipeline.oldest_pending_days` > 7: მიმწოდებელი \
სვამს — დარეკე. `urgent_pending` > 3: სასწრაფოა.
4. მარაგი — `restock_alerts[*].days_of_cover` < 7: მალე გათავდება — სასწრაფოდ შეუკვეთე.
5. ფული — `accounts_receivable_gel` > `cash_on_hand_gel`: ნისიაში მეტია ვიდრე ხელზე — \
დარეკე კლიენტებს.
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
• <b>სარკე VW Golf 6</b> — შემომტანი 12%-ით გაძვირდა (38.5₾-დან 43.2₾-მდე), ახლა მარჟა სულ 17%-ია. გაზარდე საცალო ფასი ~12%-ით, სანამ ზარალში გახვალ.
• <b>უკანა სამუხრუჭე ხუნდი</b> — 4-5 დღეში ბოლომდე გათავდება, სასწრაფოდ 18 ცალი შეუკვეთე.
• სასწრაფო 2 შეკვეთა უკვე 11 დღეა ელოდება — დღეს დარეკე, <b>Opel Astra-ს ბამპერი</b> განსაკუთრებით სჭირდება.
• ნისიაში 720₾ გაქვს, ხელზე 2 150₾ — ახლა ბალანსი კარგია, მაგრამ კლიენტებს შეახსენე."""


def build_user_message(snapshot_dict: Dict[str, Any], period_label: str) -> str:
    """Wrap the financial snapshot in a single user message.

    period_label: e.g. "10.04.2026 — 17.04.2026"
    """
    return (
        f"კვირა: {period_label}\n"
        f"{json.dumps(snapshot_dict, ensure_ascii=False, indent=2)}\n\n"
        "დაწერე ამ კვირის ანალიზი."
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
