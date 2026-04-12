"""
Telegram JSON export auditor.

Usage:
    python tools/audit_export.py path/to/result.json [--topic sales|orders|expenses]

What it does:
    1. Reads a Telegram chat export (JSON format from "Export Chat History").
    2. Runs every text message through the parser.
    3. Prints a summary: how many parsed vs. missed.
    4. Shows the most common unparsed messages so you know what to fix.

How to export from Telegram:
    Settings → Advanced → Export Telegram Data → select your group → JSON format
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

# Allow running from project root without installing
sys.path.insert(0, str(Path(__file__).parent.parent))

from bot.parsers.message_parser import (
    parse_expense_message,
    parse_order_message,
    parse_sale_message,
)

PARSERS = {
    "sales": parse_sale_message,
    "orders": parse_order_message,
    "expenses": parse_expense_message,
}


def _load_messages(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    messages = data.get("messages", [])
    return [m for m in messages if m.get("type") == "message"]


def _extract_text(message: dict) -> str:
    text = message.get("text", "")
    if isinstance(text, list):
        # Telegram sometimes stores formatted text as a list of entities
        parts = []
        for part in text:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                parts.append(part.get("text", ""))
        return "".join(parts).strip()
    return str(text).strip()


def audit(json_path: Path, topic: str) -> None:
    parser = PARSERS[topic]
    messages = _load_messages(json_path)

    parsed_count = 0
    missed_count = 0
    missed_texts: list[str] = []
    skipped_empty = 0

    for msg in messages:
        text = _extract_text(msg)
        if not text:
            skipped_empty += 1
            continue

        result = parser(text)
        if result is not None:
            parsed_count += 1
        else:
            missed_count += 1
            missed_texts.append(text)

    total = parsed_count + missed_count
    pct = (parsed_count / total * 100) if total else 0

    print(f"\n{'=' * 60}")
    print(f"  Telegram Export Audit — topic: {topic}")
    print(f"{'=' * 60}")
    print(f"  სულ შეტყობინება : {total}")
    print(f"  ამოცნობილი       : {parsed_count}  ({pct:.1f}%)")
    print(f"  გამოტოვებული    : {missed_count}  ({100 - pct:.1f}%)")
    print(f"  ცარიელი/გამოტოვ : {skipped_empty}")
    print(f"{'=' * 60}\n")

    if not missed_texts:
        print("✅ ყველა შეტყობინება ამოცნობილია!")
        return

    counter = Counter(missed_texts)
    top = counter.most_common(25)

    print(f"🔝 ყველაზე ხშირი გამოტოვებული შეტყობინებები ({len(counter)} უნიკალური):\n")
    for i, (text, count) in enumerate(top, start=1):
        display = text[:80].replace("\n", " ")
        if len(text) > 80:
            display += "..."
        print(f"  {i:>2}. [{count:>3}x]  {display}")

    print(f"\n{'=' * 60}")
    print("შენიშვნა: ამ სიის მიხედვით შეგიძლია პარსერი გააუმჯობესო.")
    print(f"{'=' * 60}\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Audit a Telegram JSON export against the bot parser."
    )
    parser.add_argument("json_file", help="Path to Telegram export result.json")
    parser.add_argument(
        "--topic",
        choices=list(PARSERS.keys()),
        default="sales",
        help="Which parser to use (default: sales)",
    )
    args = parser.parse_args()

    path = Path(args.json_file)
    if not path.exists():
        print(f"❌ ფაილი ვერ მოიძებნა: {path}")
        sys.exit(1)

    audit(path, args.topic)


if __name__ == "__main__":
    main()
