"""AI-powered product search using the full catalog + Claude."""
import json
import logging
from typing import List

import config

logger = logging.getLogger(__name__)

_MODEL = "claude-haiku-4-5-20251001"
_MAX_TOKENS = 512
_TIMEOUT = 15.0

_SYSTEM = """\
შენ ხარ ავტო სათადარიგო ნაწილების მაღაზიის ძიების ასისტენტი (SsangYong).
მომხმარებელი გეძლევა სათადარიგო ნაწილების კატალოგი და კლიენტის მოთხოვნა.
შენი ამოცანაა: იპოვე კატალოგში ყველა შესაბამისი პროდუქტი.

წესები:
- გაითვალისწინე ქართული ბარბარიზმები (რუსული წარმოშობის სიტყვები):
  შარნილი = სახსარი (шарнир), ვტულკა = მილი/втулка, ნაბეჟნიკი = საკისარი (подшипник),
  ამორტი = ამორტიზატორი, ბალანსირი = სტაბილიზატორი, ბრეკი = მუხრუჭი,
  ბოლტი = ჭანჭიკი, გაიკა = კაკალი, სტოიკა = ასპარეზი, შლანგი = მილი, და სხვ.
- გაითვალისწინე კლიენტის მანქანის მოდელი და წელი, თუ მითითებულია
- დააბრუნე მხოლოდ JSON მასივი პროდუქტების ID-ებით (მაგ: [12, 47, 103])
- თუ შესაბამისი პროდუქტი ვერ მოიძებნა — დააბრუნე: []
- არ გამოიყენო სხვა ფორმატი, მხოლოდ JSON
"""


def _build_catalog_text(products: List[dict]) -> str:
    lines = []
    for p in products:
        parts = [f"[ID:{p['id']}] {p['name']}"]
        if p.get("oem_code"):
            parts.append(f"OEM:{p['oem_code']}")
        if p.get("category"):
            parts.append(f"კატ:{p['category']}")

        compat_entries = p.get("compat_entries") or []
        if isinstance(compat_entries, str):
            try:
                compat_entries = json.loads(compat_entries)
            except Exception:
                compat_entries = []

        compat_parts = []
        for c in compat_entries:
            c_str = c.get("model", "")
            if c.get("drive"):
                c_str += f" {c['drive']}"
            if c.get("engine"):
                c_str += f" {c['engine']}"
            if c.get("fuel_type"):
                c_str += f" {c['fuel_type']}"
            if c.get("year_from") or c.get("year_to"):
                c_str += f" {c.get('year_from', '?')}–{c.get('year_to', '?')}"
            compat_parts.append(c_str)

        if compat_parts:
            parts.append("→ " + "; ".join(compat_parts))
        elif p.get("compatibility_notes"):
            parts.append("→ " + p["compatibility_notes"])

        lines.append("  ".join(parts))
    return "\n".join(lines)


async def search_catalog(query: str, products: List[dict]) -> List[int]:
    """Ask Claude to match `query` against the product catalog.

    Returns a list of matching product IDs (may be empty).
    """
    if not products:
        return []

    api_key = getattr(config, "ANTHROPIC_API_KEY", None)
    if not api_key:
        logger.warning("ANTHROPIC_API_KEY not set — catalog search unavailable.")
        return []

    try:
        from anthropic import AsyncAnthropic
    except ImportError:
        logger.warning("`anthropic` package not installed — catalog search unavailable.")
        return []

    catalog_text = _build_catalog_text(products)
    user_message = f"კატალოგი:\n{catalog_text}\n\nკლიენტის მოთხოვნა: {query}"

    client = AsyncAnthropic(api_key=api_key, timeout=_TIMEOUT)
    try:
        response = await client.messages.create(
            model=_MODEL,
            max_tokens=_MAX_TOKENS,
            system=_SYSTEM,
            messages=[{"role": "user", "content": user_message}],
        )
    except Exception as exc:
        logger.warning("Catalog search API call failed: %s", exc)
        return []

    first = response.content[0]
    raw = first.text.strip() if hasattr(first, "text") else ""

    # Strip markdown code fences if Claude wrapped the response
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        ids = json.loads(raw)
        if isinstance(ids, list):
            return [int(i) for i in ids if str(i).lstrip("-").isdigit()]
    except Exception:
        logger.warning("Could not parse Claude response as JSON: %r", raw)
    return []
