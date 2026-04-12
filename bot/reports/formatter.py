"""
Report formatters — all output is in Georgian, HTML parse mode.
"""

import html
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Sequence

import pytz

import config

PAYMENT_CASH = "cash"
PAYMENT_TRANSFER = "transfer"
PAYMENT_CREDIT = "credit"


def _tz() -> pytz.BaseTzInfo:
    return pytz.timezone(config.TIMEZONE)


def _now() -> datetime:
    return datetime.now(_tz())


def _e(text: object) -> str:
    """HTML-escape a value so product names never break Telegram markup."""
    return html.escape(str(text))


def _payment_label(payment: str) -> str:
    if payment == PAYMENT_CASH:
        return "ხელზე 💵"
    if payment == PAYMENT_TRANSFER:
        return "დარიცხა 🏦"
    return "ნისია 📋"


def _seller_label(seller_type: str) -> str:
    return "შპს" if seller_type == "llc" else "ფზ"


_CATEGORY_LABELS = {
    "fuel":        "⛽ საწვავი",
    "customs":     "🛃 საბაჟო",
    "delivery":    "🚚 მიტანა",
    "maintenance": "🔧 სერვისი",
    "marketing":   "📣 რეკლამა",
    "office":      "🖊 ოფისი",
    "utilities":   "💡 კომუნალი",
    "salary":      "👷 ხელფასი",
    "insurance":   "🛡 სადაზღვევო",
    "transport":   "🚗 ტრანსპორტი",
}


def _category_label(category: Optional[str]) -> str:
    return _CATEGORY_LABELS.get(category or "", "") if category else ""


# ─── Confirmation messages ────────────────────────────────────────────────────

def format_sale_confirmation(
    product_name: str,
    qty: int,
    price: float,
    payment: str,
    seller_type: str,
    customer_name: str,
    new_stock: Optional[int],
    low_stock: bool,
    sale_id: int,
    unknown_product: bool = False,
) -> str:
    total = qty * price
    lines = [
        "✅ <b>გაყიდვა დაფიქსირდა</b>",
        f"📦 პროდუქტი: {_e(product_name)}",
        f"🔢 რაოდენობა: {qty}ც",
        f"💰 ფასი: {price:.2f}₾ × {qty} = <b>{total:.2f}₾</b>",
        f"💳 გადახდა: {_payment_label(payment)}",
        f"🏢 გამყიდველი: {_seller_label(seller_type)}",
    ]
    if customer_name:
        lines.append(f"👤 მომხმარებელი: {_e(customer_name)}")
    if payment == PAYMENT_CREDIT:
        lines.append(f"📋 <b>ნისია #{ sale_id } — გახსოვდეს დარეკვა!</b>")
    if new_stock is not None:
        lines.append(f"📊 დარჩა საწყობში: {new_stock}ც")
    if unknown_product:
        lines.append("<i>⚠️ პროდუქტი ბაზაში არ არის — მარაგი არ განახლებულა</i>")
    if low_stock and new_stock is not None:
        lines.append(f"\n⚠️ <b>გაფრთხილება: მარაგი დაბალია! ({new_stock}ც)</b>")
    return "\n".join(lines)


def format_return_confirmation(
    product_name: str,
    qty: int,
    refund: float,
    new_stock: int,
) -> str:
    return (
        f"↩️ <b>დაბრუნება დაფიქსირდა</b>\n"
        f"📦 პროდუქტი: {_e(product_name)}\n"
        f"🔢 რაოდენობა: {qty}ც\n"
        f"💰 დაბრუნებული თანხა: {refund:.2f}₾\n"
        f"📊 საწყობში ახლა: {new_stock}ც"
    )


# ─── Credit (ნისია) report ────────────────────────────────────────────────────

def format_credit_sales_report(sales: Sequence[Any]) -> str:
    if not sales:
        return "✅ <b>ნისია არ არის!</b> ყველა გაყიდვა გადახდილია."

    total_owed = sum(float(s["unit_price"]) * s["quantity"] for s in sales)
    now = _now()

    lines: List[str] = [
        "📋 <b>ნისიები — გადაუხდელი გაყიდვები</b>",
        f"<i>{now.strftime('%d.%m.%Y %H:%M')}</i>",
        f"💰 სულ ვალი: <b>{total_owed:.2f}₾</b>",
        "",
    ]

    for s in sales:
        name = s.get("product_name") or s.get("notes") or "უცნობი"
        sold_at = s["sold_at"]
        if isinstance(sold_at, datetime):
            date_str = sold_at.strftime("%d.%m.%Y")
        else:
            date_str = str(sold_at)[:10]

        total = float(s["unit_price"]) * s["quantity"]
        seller = _seller_label(s.get("seller_type", "individual"))
        customer = s.get("customer_name") or "—"

        lines.append(
            f"🔸 <b>#{s['id']}</b> | {date_str} | {seller}\n"
            f"   📦 {_e(name)} — {s['quantity']}ც × {float(s['unit_price']):.2f}₾ = <b>{total:.2f}₾</b>\n"
            f"   👤 {_e(customer)}"
        )

    lines.append("")
    return "\n".join(lines)


# ─── Shared report helpers ────────────────────────────────────────────────────

def _calculate_report_metrics(
    sales: Sequence[Any],
    returns: Sequence[Any],
    expenses: Sequence[Any],
) -> Dict[str, Any]:
    """Calculate financial totals and per-product aggregates for any report period."""
    total_revenue = sum(float(s["unit_price"]) * s["quantity"] for s in sales)
    total_returns = sum(float(r["refund_amount"]) for r in returns)
    total_expenses = sum(float(e["amount"]) for e in expenses)

    by_product: Dict[str, Dict[str, Any]] = {}
    for s in sales:
        key = s.get("product_name") or s.get("notes") or "უცნობი"
        entry = by_product.setdefault(key, {"qty": 0, "revenue": 0.0})
        entry["qty"] += s["quantity"]
        entry["revenue"] += float(s["unit_price"]) * s["quantity"]

    return {
        "total_revenue": total_revenue,
        "total_returns": total_returns,
        "total_expenses": total_expenses,
        "net_income": total_revenue - total_returns - total_expenses,
        "cash_revenue": sum(
            float(s["unit_price"]) * s["quantity"]
            for s in sales if s.get("payment_method") == PAYMENT_CASH
        ),
        "transfer_revenue": sum(
            float(s["unit_price"]) * s["quantity"]
            for s in sales if s.get("payment_method") == PAYMENT_TRANSFER
        ),
        "credit_revenue": sum(
            float(s["unit_price"]) * s["quantity"]
            for s in sales if s.get("payment_method") == PAYMENT_CREDIT
        ),
        "llc_revenue": sum(
            float(s["unit_price"]) * s["quantity"]
            for s in sales if s.get("seller_type") == "llc"
        ),
        "by_product": by_product,
    }


def _build_report_body(
    m: Dict[str, Any],
    sales: Sequence[Any],
    returns: Sequence[Any],
    expenses: Sequence[Any],
    no_sales_label: str,
) -> List[str]:
    """Build the common body lines (metrics + products + returns + expenses)."""
    individual_revenue = m["total_revenue"] - m["llc_revenue"]
    lines: List[str] = [
        "━━━━━━━━━━━━━━━━━━━━━",
        f"💰 მთლიანი შემოსავალი: <b>{m['total_revenue']:.2f}₾</b>",
        f"   💵 ხელზე: {m['cash_revenue']:.2f}₾",
        f"   🏦 დარიცხა: {m['transfer_revenue']:.2f}₾",
        f"   📋 ნისია: {m['credit_revenue']:.2f}₾",
        f"   🏢 შპს: {m['llc_revenue']:.2f}₾  |  ფზ: {individual_revenue:.2f}₾",
        f"↩️ დაბრუნებები: {m['total_returns']:.2f}₾",
        f"🧾 ხარჯები: {m['total_expenses']:.2f}₾",
        f"💵 სუფთა შემოსავალი: <b>{m['net_income']:.2f}₾</b>",
        "━━━━━━━━━━━━━━━━━━━━━",
    ]

    if m["by_product"]:
        lines += ["", "📦 <b>გაყიდული პროდუქტები:</b>"]
        for name, data in sorted(m["by_product"].items(), key=lambda x: -x[1]["revenue"]):
            lines.append(
                f"🔹 <b>{_e(name)}</b>\n"
                f"   გაყიდული: {data['qty']}ც  |  შემოსავალი: {data['revenue']:.2f}₾"
            )
    else:
        lines += ["", no_sales_label]

    if returns:
        lines += ["", "↩️ <b>დაბრუნებები:</b>"]
        for r in returns:
            name = r.get("product_name") or "უცნობი"
            lines.append(
                f"• {_e(name)}: {r['quantity']}ც — {float(r['refund_amount']):.2f}₾"
            )

    if expenses:
        lines += ["", "🧾 <b>ხარჯები:</b>"]
        for e in expenses:
            desc = e.get("description") or "—"
            lines.append(f"• {_e(desc)}: {float(e['amount']):.2f}₾")

    return lines


# ─── Weekly report ────────────────────────────────────────────────────────────

def format_weekly_report(
    sales: Sequence[Any],
    returns: Sequence[Any],
    expenses: Sequence[Any],
    products: Sequence[Any],
) -> str:
    now = _now()
    week_start = now - timedelta(days=7)
    m = _calculate_report_metrics(sales, returns, expenses)
    low_stock = [p for p in products if p["current_stock"] <= p["min_stock"]]

    lines: List[str] = [
        "📊 <b>კვირის ანგარიში</b>",
        f"📅 {week_start.strftime('%d.%m.%Y')} — {now.strftime('%d.%m.%Y')}",
        "",
    ]
    lines += _build_report_body(m, sales, returns, expenses, "📦 ამ კვირაში გაყიდვა არ მომხდარა.")
    lines.append("")

    if low_stock:
        lines += ["", "⚠️ <b>დაბალი მარაგი:</b>"]
        for p in low_stock:
            lines.append(
                f"• {_e(p['name'])}: {p['current_stock']}ც "
                f"(მინ: {p['min_stock']}ც)"
            )

    lines += ["", f"<i>ანგარიში შექმნილია: {now.strftime('%d.%m.%Y %H:%M')}</i>"]
    return "\n".join(lines)


# ─── Stock report ─────────────────────────────────────────────────────────────

def format_stock_report(products: Sequence[Any]) -> str:
    if not products:
        return "📦 საწყობი ცარიელია."

    now = _now()
    lines: List[str] = [
        "🏪 <b>საწყობის მდგომარეობა</b>",
        f"<i>განახლებულია: {now.strftime('%d.%m.%Y %H:%M')}</i>",
        "",
    ]

    for p in products:
        is_low = p["current_stock"] <= p["min_stock"]
        icon = "⚠️" if is_low else "✅"
        oem_part = f" <code>{_e(p['oem_code'])}</code>" if p.get("oem_code") else ""
        warn_part = " ⚠️" if is_low else ""

        lines.append(f"{icon} <b>{_e(p['name'])}</b>{oem_part}")
        lines.append(
            f"   მარაგი: {p['current_stock']}ც  |  ფასი: {float(p['unit_price']):.2f}₾{warn_part}"
        )

    low = [p for p in products if p["current_stock"] <= p["min_stock"]]
    if low:
        lines += ["", f"⚠️ <b>{len(low)} პროდუქტს სჭირდება შეკვეთა!</b>"]

    return "\n".join(lines)


# ─── Orders report ────────────────────────────────────────────────────────────

def format_orders_report(orders: Sequence[Any]) -> str:
    if not orders:
        return "📋 მომლოდინე შეკვეთა არ არის."

    now = _now()
    lines: List[str] = [
        "📋 <b>მომლოდინე შეკვეთები</b>",
        f"<i>{now.strftime('%d.%m.%Y %H:%M')}</i>",
        "",
    ]

    for o in orders:
        name = o.get("product_name") or o.get("notes") or "უცნობი"
        oem = f" <code>{_e(o['oem_code'])}</code>" if o.get("oem_code") else ""
        lines.append(
            f"🔹 <b>#{o['id']}</b> — {_e(name)}{oem}\n"
            f"   საჭირო: {o['quantity_needed']}ც"
        )

    lines += [
        "",
        "<i>დახურვა: <code>/completeorder ID</code></i>",
    ]
    return "\n".join(lines)


# ─── Diagnostics report ───────────────────────────────────────────────────────

def format_diagnostics_report(failures: Sequence[Any], total_7d: int, total_30d: int) -> str:
    now = _now()
    lines: List[str] = [
        "🔍 <b>დიაგნოსტიკა — ვერ ამოცნობილი შეტყობინებები</b>",
        f"<i>{now.strftime('%d.%m.%Y %H:%M')}</i>",
        "",
        f"📅 ბოლო 7 დღე: <b>{total_7d}</b> შეტყობინება გამოტოვდა",
        f"📅 ბოლო 30 დღე: <b>{total_30d}</b> შეტყობინება გამოტოვდა",
        "",
        "━━━━━━━━━━━━━━━━━━━━━",
    ]

    if not failures:
        lines.append("✅ გამოტოვებული შეტყობინება არ არის!")
        return "\n".join(lines)

    lines.append("🔝 <b>ყველაზე ხშირი გამოტოვებული ფრაზები:</b>")
    for f in failures[:15]:
        txt = str(f["message_text"])[:60]
        if len(str(f["message_text"])) > 60:
            txt += "..."
        lines.append(
            f"• <code>{_e(txt)}</code> — {f['occurrences']}-ჯერ"
        )

    lines += [
        "",
        "<i>ამ ფრაზების საფუძველზე ბოტი გაუმჯობესდება.</i>",
    ]
    return "\n".join(lines)


# ─── Period report ────────────────────────────────────────────────────────────

def format_period_report(
    sales: Sequence[Any],
    returns: Sequence[Any],
    expenses: Sequence[Any],
    products: Sequence[Any],
    date_from: datetime,
    date_to: datetime,
) -> str:
    if not sales and not returns and not expenses:
        return "📭 არჩეულ პერიოდში გაყიდვები არ დაფიქსირებულა"

    m = _calculate_report_metrics(sales, returns, expenses)
    now = _now()

    lines: List[str] = [
        "📊 <b>პერიოდის ანგარიში</b>",
        f"📅 {date_from.strftime('%d.%m.%Y')} — {date_to.strftime('%d.%m.%Y')}",
        "",
    ]
    lines += _build_report_body(m, sales, returns, expenses, "📦 ამ პერიოდში გაყიდვა არ მომხდარა.")
    lines += ["", "━━━━━━━━━━━━━━━━━━━━━", f"<i>ანგარიში შექმნილია: {now.strftime('%d.%m.%Y %H:%M')}</i>"]
    return "\n".join(lines)
