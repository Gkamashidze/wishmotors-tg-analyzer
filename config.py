import os
from typing import Optional

from dotenv import load_dotenv

load_dotenv()


def _require(key: str) -> str:
    value = os.getenv(key)
    if not value:
        raise RuntimeError(f"Required environment variable '{key}' is not set.")
    return value


BOT_TOKEN: str = _require("BOT_TOKEN")
GROUP_ID: int = int(_require("GROUP_ID"))
SALES_TOPIC_ID: int = int(_require("SALES_TOPIC_ID"))
ORDERS_TOPIC_ID: int = int(_require("ORDERS_TOPIC_ID"))
EXPENSES_TOPIC_ID: int = int(_require("EXPENSES_TOPIC_ID"))
STOCK_TOPIC_ID: int = int(_require("STOCK_TOPIC_ID"))
NISIAS_TOPIC_ID: int = int(_require("NISIAS_TOPIC_ID"))

# Optional: topic where inventory batch receipts / WAC events are posted.
# Left optional so existing deployments keep running until the topic is created.
_inventory_raw = os.getenv("INVENTORY_TOPIC_ID")
INVENTORY_TOPIC_ID: Optional[int] = int(_inventory_raw) if _inventory_raw else None

DATABASE_URL: str = _require("DATABASE_URL")

# Comma-separated list of Telegram user IDs allowed to use bot commands.
# Example: ADMIN_IDS=123456789,987654321
_raw_admin_ids = _require("ADMIN_IDS")
ADMIN_IDS: set[int] = {int(x.strip()) for x in _raw_admin_ids.split(",") if x.strip()}

TIMEZONE: str = os.getenv("TIMEZONE", "Asia/Tbilisi")

# Optional: Redis URL for FSM state persistence across bot restarts.
# When set, calendar widget state survives restarts; otherwise MemoryStorage is used.
# Example: REDIS_URL=redis://localhost:6379/0
REDIS_URL: Optional[str] = os.getenv("REDIS_URL")
REPORT_WEEKDAY: str = os.getenv("REPORT_WEEKDAY", "sun")
REPORT_HOUR: int = int(os.getenv("REPORT_HOUR", "22"))
REPORT_MINUTE: int = int(os.getenv("REPORT_MINUTE", "0"))
MIN_STOCK_THRESHOLD: int = int(os.getenv("MIN_STOCK_THRESHOLD", "20"))
MAX_EXCEL_BYTES: int = int(os.getenv("MAX_EXCEL_BYTES", str(5 * 1024 * 1024)))  # 5 MB

# Optional: Anthropic API key for the AI Financial Manager.
# When set, weekly reports include an AI-generated business analysis block.
# When unset, reports go out exactly as before.
ANTHROPIC_API_KEY: Optional[str] = os.getenv("ANTHROPIC_API_KEY")

# When True, the bot is operating as LLC-only (ფ.პ seller option hidden in UI).
# Set FZ_ENTITY_ENABLED=false to disable ფ.პ mode entirely once migration is complete.
FZ_ENTITY_ENABLED: bool = os.getenv("FZ_ENTITY_ENABLED", "true").lower() not in (
    "false",
    "0",
    "no",
)

# Base URL of the dashboard (used to build personal order tracking links).
# Example: DASHBOARD_URL=https://dashboard.yoursite.railway.app
DASHBOARD_URL: str = os.getenv("DASHBOARD_URL", "").rstrip("/")

# Optional: Telegram channel/chat ID for real-time transaction audit forwarding.
# When set, every write operation (sale, expense, order, inventory) sends a
# structured JSON message to this channel as a secondary backup.
# Example: AUDIT_CHANNEL_ID=-1001234567890  (private channel, bot must be admin)
_audit_raw = os.getenv("AUDIT_CHANNEL_ID")
AUDIT_CHANNEL_ID: Optional[int] = int(_audit_raw) if _audit_raw else None
