"""DM product search handler — admin types any text, bot searches the catalog via AI."""
import json
import logging
from typing import Optional

from aiogram import F, Router
from aiogram.enums import ParseMode
from aiogram.filters import StateFilter
from aiogram.fsm.state import default_state
from aiogram.types import Message

from bot.handlers import IsAdmin
from bot.search_ai.catalog_search import search_catalog
from database.db import Database

logger = logging.getLogger(__name__)
search_router = Router(name="search")


def _fmt_price(val) -> str:
    try:
        return f"{float(val):.2f}₾"
    except (TypeError, ValueError):
        return "—"


def _fmt_compat(compat_entries, notes: Optional[str]) -> str:
    entries = compat_entries or []
    if isinstance(entries, str):
        try:
            entries = json.loads(entries)
        except Exception:
            entries = []

    lines = []
    for c in entries:
        parts = [c.get("model", "")]
        if c.get("drive"):
            parts.append(c["drive"])
        if c.get("engine"):
            parts.append(c["engine"])
        if c.get("fuel_type"):
            parts.append(c["fuel_type"])
        if c.get("year_from") or c.get("year_to"):
            parts.append(f"{c.get('year_from', '?')}–{c.get('year_to', '?')}")
        lines.append(" · ".join(p for p in parts if p))

    if lines:
        return "\n".join(f"   🚗 {line}" for line in lines)
    if notes:
        return f"   🚗 {notes}"
    return ""


def _format_results(matches: list[dict], query: str, total_checked: int) -> str:
    header = f"🔍 <b>{query}</b>\n"
    divider = "─" * 20

    if not matches:
        return (
            f"{header}\n"
            "ვერ მოიძებნა შესაბამისი პროდუქტი.\n\n"
            "სცადე სხვა სიტყვით ან უფრო მოკლედ."
        )

    parts = [header]
    for p in matches:
        stock = p["current_stock"]
        stock_str = f"{stock} {p['unit']}"
        if stock <= 0:
            stock_str += " ⚠️ ამოიწურა"

        block = (
            f"{divider}\n"
            f"📦 <b>{p['name']}</b>\n"
            f"   მარაგი: {stock_str}\n"
            f"   ფასი: {_fmt_price(p['unit_price'])}"
        )

        compat_str = _fmt_compat(p.get("compat_entries"), p.get("compatibility_notes"))
        if compat_str:
            block += f"\n{compat_str}"

        if p.get("oem_code"):
            block += f"\n   OEM: <code>{p['oem_code']}</code>"

        parts.append(block)

    parts.append(f"{divider}\n<i>შემოწმდა {total_checked} პროდუქტი</i>")
    return "\n".join(parts)


@search_router.message(
    IsAdmin(),
    StateFilter(default_state),
    F.chat.type == "private",
    F.text,
    ~F.text.startswith("/"),
)
async def handle_search(message: Message, db: Database) -> None:
    query = (message.text or "").strip()
    if not query:
        return

    wait_msg = await message.answer("🔍 ვეძებ...")

    try:
        products = await db.get_catalog_for_search()
        matched_ids = await search_catalog(query, products)

        id_to_product = {p["id"]: p for p in products}
        matches = [id_to_product[pid] for pid in matched_ids if pid in id_to_product]

        text = _format_results(matches, query, len(products))
        await wait_msg.edit_text(text, parse_mode=ParseMode.HTML)

    except Exception as exc:
        logger.exception("Search handler error: %s", exc)
        await wait_msg.edit_text("⚠️ ძებნა ვერ შესრულდა. სცადე თავიდან.")
