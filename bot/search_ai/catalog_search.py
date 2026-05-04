"""AI-powered product search using the full catalog + Claude."""

import asyncio
import json
import logging
from typing import Any, List, Optional

import config

logger = logging.getLogger(__name__)

_MODEL = "claude-haiku-4-5-20251001"
_MAX_TOKENS = 512
_TIMEOUT = 15.0

# Strong references prevent GC from collecting log tasks before completion.
_log_tasks: set = set()

# Module-level singleton — avoids creating a new HTTP connection pool per call.
_client: Optional[Any] = None


def _get_client() -> Optional[Any]:
    global _client
    api_key = getattr(config, "ANTHROPIC_API_KEY", None)
    if not api_key:
        return None
    if _client is None:
        try:
            from anthropic import AsyncAnthropic

            _client = AsyncAnthropic(api_key=api_key, timeout=_TIMEOUT)
        except ImportError:
            logger.warning(
                "`anthropic` package not installed — catalog search unavailable."
            )
    return _client


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
            if c.get("model") == "__ALL__":
                compat_parts.append("ყველა მოდელი")
                continue
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

        lines.append("  ".join(parts))
    return "\n".join(lines)


def _fire_and_forget_log(db: Any, query: str) -> None:
    """Schedule a lost-search log write without blocking the caller."""
    try:
        task = asyncio.get_running_loop().create_task(
            db.log_lost_search(query.strip(), "bot_search")
        )
        _log_tasks.add(task)
        task.add_done_callback(_log_tasks.discard)
    except Exception:
        pass


async def search_catalog(
    query: str, products: List[dict], db: Optional[Any] = None
) -> List[int]:
    """Ask Claude to match `query` against the product catalog.

    Returns a list of matching product IDs (may be empty).
    Logs zero-result searches to lost_searches if `db` is provided.
    """
    if not products:
        return []

    client = _get_client()
    if client is None:
        logger.warning("ANTHROPIC_API_KEY not set — catalog search unavailable.")
        return []

    catalog_text = _build_catalog_text(products)
    user_message = f"კატალოგი:\n{catalog_text}\n\nკლიენტის მოთხოვნა: {query}"

    try:
        from anthropic import APIConnectionError, APITimeoutError, RateLimitError

        response = await client.messages.create(
            model=_MODEL,
            max_tokens=_MAX_TOKENS,
            system=[
                {
                    "type": "text",
                    "text": _SYSTEM,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_message}],
        )
        usage = response.usage
        logger.info(
            "catalog_search tokens: in=%d out=%d cache_read=%d",
            usage.input_tokens,
            usage.output_tokens,
            getattr(usage, "cache_read_input_tokens", 0),
        )
    except RateLimitError as exc:
        logger.warning("Catalog search rate-limited: %s", exc)
        return []
    except APITimeoutError as exc:
        logger.warning("Catalog search API timeout: %s", exc)
        return []
    except APIConnectionError as exc:
        logger.warning("Catalog search API connection error: %s", exc)
        return []
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
            result = [int(i) for i in ids if str(i).lstrip("-").isdigit()]
            if not result and db is not None and query.strip():
                _fire_and_forget_log(db, query)
            return result
    except Exception:
        logger.warning("Could not parse Claude response as JSON: %r", raw)
    return []
