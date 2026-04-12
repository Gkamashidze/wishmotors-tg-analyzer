"""
Report formatters — all output is in Georgian, HTML parse mode.
"""

import html
from datetime import datetime, timedelta
from typing import Dict, List

import pytz

import config


def _tz() -> pytz.BaseTzInfo:
    return pytz.timezone(config.TIMEZONE)


def _now() -> datetime:
    return datetime.now(_tz())


def _e(text: object) -> str:
    """HTML-escape a value so product names never break Telegram markup."""
    return html.escape(str(text))


# ─── Weekly report ────────────────────────────────────────────────────────────

def format_weekly_report(
    sales: List[Dict],
    returns: List[Dict],
    expenses: List[Dict],
    products: List[Dict],
) -> str:
    now = _now()
    week_start = now - timedelta(days=7)

    total_revenue = sum(s["unit_price"] * s["quantity"] for s in sales)
    total_returns = sum(r["refund_amount"] for r in returns)
    total_expenses = sum(e["amount"] for e in expenses)
    net_income = total_revenue - total_returns - total_expenses

    cash_revenue = sum(
        s["unit_price"] * s["quantity"]
        for s in sales
        if s.get("payment_method") == "cash"
    )
    transfer_revenue = sum(
        s["unit_price"] * s["quantity"]
        for s in sales
        if s.get("payment_method") == "transfer"
    )

    by_product: Dict[str, Dict] = {}
    for s in sales:
        key = s.get("product_name") or s.get("notes") or "უცნობი"
        entry = by_product.setdefault(key, {"qty": 0, "revenue": 0.0})
        entry["qty"] += s["quantity"]
        entry["revenue"] += float(s["unit_price"]) * s["quantity"]

    low_stock = [p for p in products if p["current_stock"] <= p["min_stock"]]

    lines: List[str] = [
        "📊 <b>კვირის ანგარიში</b>",
        f"📅 {week_start.strftime('%d.%m.%Y')} — {now.strftime('%d.%m.%Y')}",
        "",
        "━━━━━━━━━━━━━━━━━━━━━",
        f"💰 მთლიანი შემოსავალი: <b>{total_revenue:.2f}₾</b>",
        f"   💵 ხელზე: {cash_revenue:.2f}₾",
        f"   🏦 გადარიცხვა: {transfer_revenue:.2f}₾",
        f"↩️ დაბრუნებები: {total_returns:.2f}₾",
        f"🧾 ხარჯები: {total_expenses:.2f}₾",
        f"💵 სუფთა შემოსავალი: <b>{net_income:.2f}₾</b>",
        "━━━━━━━━━━━━━━━━━━━━━",
    ]

    if by_product:
        lines += ["", "📦 <b>გაყიდული პროდუქტები:</b>"]
        for name, data in sorted(by_product.items(), key=lambda x: -x[1]["revenue"]):
            lines.append(
                f"🔹 <b>{_e(name)}</b>\n"
                f"   გაყიდული: {data['qty']}ც  |  შემოსავალი: {data['revenue']:.2f}₾"
            )
    else:
        lines += ["", "📦 ამ კვირაში გაყიდვა არ მომხდარა."]

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

    lines.append("\n━━━━━━━━━━━━━━━━━━━━━")

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

def format_stock_report(products: List[Dict]) -> str:
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

def format_orders_report(orders: List[Dict]) -> str:
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


# ─── Confirmation messages ────────────────────────────────────────────────────

def format_sale_confirmation(
    product_name: str,
    qty: int,
    price: float,
    payment: str,
    new_stock: int,
    low_stock: bool,
) -> str:
    payment_str = "ხელზე 💵" if payment == "cash" else "გადარიცხვა 🏦"
    total = qty * price
    lines = [
        "✅ <b>გაყიდვა დაფიქსირდა</b>",
        f"📦 პროდუქტი: {_e(product_name)}",
        f"🔢 რაოდენობა: {qty}ც",
        f"💰 ფასი: {price:.2f}₾ × {qty} = <b>{total:.2f}₾</b>",
        f"💳 გადახდა: {payment_str}",
        f"📊 დარჩა საწყობში: {new_stock}ც",
    ]
    if low_stock:
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
