"""
Live Telegram group audit using Telethon (user account, not bot).

Usage:
    python3 tools/audit_live.py

What it does:
    1. Connects to Telegram with your own account (api_id + api_hash).
    2. Reads messages from the configured group topics (sales, orders, expenses).
    3. Runs every message through the parser.
    4. Prints a report: what parsed, what was missed, most common failures.

Setup (one time):
    1. Go to https://my.telegram.org
    2. Log in → "API development tools"
    3. Create app (name/description can be anything)
    4. Copy api_id and api_hash into .env:
           TELEGRAM_API_ID=1234567
           TELEGRAM_API_HASH=abcdef1234567890abcdef1234567890
    5. Run this script — first run asks for your phone number + SMS code.
       After that a session file is saved and no code is needed again.

Notes:
    - This reads messages as YOU (your user account), not as the bot.
    - The session file (audit_session.session) is saved locally only.
    - No messages are modified or sent.
"""

import asyncio
import os
import sys
from collections import Counter
from pathlib import Path

# Allow running from project root
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.tl.types import Message

load_dotenv()

from bot.parsers.message_parser import (  # noqa: E402
    parse_expense_message,
    parse_order_message,
    parse_sale_message,
)

# ─── Config ───────────────────────────────────────────────────────────────────

API_ID   = int(os.getenv("TELEGRAM_API_ID", "0"))
API_HASH = os.getenv("TELEGRAM_API_HASH", "")
PHONE    = os.getenv("TELEGRAM_PHONE", "")
GROUP_ID = int(os.getenv("GROUP_ID", "0"))

TOPICS = {
    "sales":    int(os.getenv("SALES_TOPIC_ID", "0")),
    "orders":   int(os.getenv("ORDERS_TOPIC_ID", "0")),
    "expenses": int(os.getenv("EXPENSES_TOPIC_ID", "0")),
}

PARSERS = {
    "sales":    parse_sale_message,
    "orders":   parse_order_message,
    "expenses": parse_expense_message,
}

LIMIT = 500   # messages per topic (increase if needed)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _validate_config() -> None:
    missing = []
    if not API_ID:
        missing.append("TELEGRAM_API_ID")
    if not API_HASH:
        missing.append("TELEGRAM_API_HASH")
    if not PHONE:
        missing.append("TELEGRAM_PHONE  (მაგ: +995599123456)")
    if not GROUP_ID:
        missing.append("GROUP_ID")
    for name, tid in TOPICS.items():
        if not tid:
            missing.append(f"{name.upper()}_TOPIC_ID")
    if missing:
        print("\n❌ .env ფაილში აკლია:")
        for m in missing:
            print(f"   {m}")
        print("\nნახე tools/audit_live.py-ის Setup განყოფილება.")
        sys.exit(1)


def _print_topic_report(topic: str, parsed: int, missed: int, counter: Counter) -> None:
    total = parsed + missed
    pct   = (parsed / total * 100) if total else 0

    print(f"\n{'━' * 60}")
    print(f"  📂 {topic.upper()} topic")
    print(f"{'━' * 60}")
    print(f"  სულ შეტყობინება : {total}")
    print(f"  ✅ ამოცნობილი    : {parsed}  ({pct:.1f}%)")
    print(f"  ❌ გამოტოვებული : {missed}  ({100 - pct:.1f}%)")

    if not counter:
        print("  🎉 ყველა შეტყობინება ამოცნობილია!")
        return

    top = counter.most_common(15)
    print(f"\n  🔝 ყველაზე ხშირი გამოტოვებული ({len(counter)} უნიკალური):\n")
    for i, (text, count) in enumerate(top, start=1):
        display = text[:70].replace("\n", " ")
        if len(text) > 70:
            display += "..."
        print(f"  {i:>2}. [{count:>3}x]  {display}")


# ─── Main ─────────────────────────────────────────────────────────────────────

async def audit(client: TelegramClient) -> None:
    print(f"\n🔍 ჯგუფის წაკითხვა (ID: {GROUP_ID}) ...")

    # Resolve entity once
    group = await client.get_entity(GROUP_ID)

    grand_parsed  = 0
    grand_missed  = 0
    grand_counter: Counter = Counter()

    for topic_name, thread_id in TOPICS.items():
        if not thread_id:
            continue

        parser    = PARSERS[topic_name]
        parsed    = 0
        missed    = 0
        missed_c: Counter = Counter()

        print(f"\n⏳ {topic_name} topic-ის წაკითხვა (ბოლო {LIMIT} შეტყობინება)...")

        async for msg in client.iter_messages(
            group,
            limit=LIMIT,
            reply_to=thread_id,
        ):
            if not isinstance(msg, Message):
                continue
            text = (msg.text or "").strip()
            if not text:
                continue

            result = parser(text)
            if result is not None:
                parsed += 1
            else:
                missed += 1
                missed_c[text] += 1

        _print_topic_report(topic_name, parsed, missed, missed_c)

        grand_parsed  += parsed
        grand_missed  += missed
        grand_counter += missed_c

    # Summary
    grand_total = grand_parsed + grand_missed
    grand_pct   = (grand_parsed / grand_total * 100) if grand_total else 0

    print(f"\n{'━' * 60}")
    print("  📊 ᲡᲣᲚ — ყველა topic")
    print(f"{'━' * 60}")
    print(f"  სულ შეტყობინება : {grand_total}")
    print(f"  ✅ ამოცნობილი    : {grand_parsed}  ({grand_pct:.1f}%)")
    print(f"  ❌ გამოტოვებული : {grand_missed}  ({100 - grand_pct:.1f}%)")
    print(f"{'━' * 60}\n")

    if grand_counter:
        print("💡 ამ შედეგების მიხედვით პარსერი შეიძლება გაუმჯობესდეს.")
        print("   გამოაგზავნე შედეგი და ახალი ვარიანტებს ჩავამატებ.\n")
    else:
        print("🎉 ყველა შეტყობინება სწორად ამოიცნო!\n")


async def main() -> None:
    _validate_config()

    session_path = Path(__file__).parent / "audit_session"

    client = TelegramClient(str(session_path), API_ID, API_HASH)

    print("🔗 Telegram-თან კავშირი...")
    await client.start(phone=PHONE)
    print("✅ შესულია!")

    try:
        await audit(client)
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
