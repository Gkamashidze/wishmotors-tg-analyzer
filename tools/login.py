"""
One-time Telegram login. Run this ONCE in your terminal.
After this, audit_live.py works automatically without any codes.

Usage:
    python3 tools/login.py
"""

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from telethon import TelegramClient

load_dotenv()

API_ID = int(os.getenv("TELEGRAM_API_ID", "0"))
API_HASH = os.getenv("TELEGRAM_API_HASH", "")
PHONE = os.getenv("TELEGRAM_PHONE", "")

session_path = Path(__file__).parent / "audit_session"


async def main() -> None:
    print("🔗 Telegram-თან კავშირი...")
    async with TelegramClient(str(session_path), API_ID, API_HASH) as client:
        await client.start(phone=PHONE)
        me = await client.get_me()
        print(f"✅ შესულია! სახელი: {me.first_name}")
        print("📁 Session შენახულია. ახლა გაუშვი: python3 tools/audit_live.py")


if __name__ == "__main__":
    asyncio.run(main())
