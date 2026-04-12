import os
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
CAPITAL_TOPIC_ID: int = int(_require("CAPITAL_TOPIC_ID"))

DATABASE_URL: str = _require("DATABASE_URL")

# Comma-separated list of Telegram user IDs allowed to use bot commands.
# Example: ADMIN_IDS=123456789,987654321
_raw_admin_ids = _require("ADMIN_IDS")
ADMIN_IDS: set[int] = {int(x.strip()) for x in _raw_admin_ids.split(",") if x.strip()}

TIMEZONE: str = os.getenv("TIMEZONE", "Asia/Tbilisi")
REPORT_WEEKDAY: str = os.getenv("REPORT_WEEKDAY", "sun")
REPORT_HOUR: int = int(os.getenv("REPORT_HOUR", "22"))
REPORT_MINUTE: int = int(os.getenv("REPORT_MINUTE", "0"))
MIN_STOCK_THRESHOLD: int = int(os.getenv("MIN_STOCK_THRESHOLD", "20"))
MAX_EXCEL_BYTES: int = int(os.getenv("MAX_EXCEL_BYTES", str(5 * 1024 * 1024)))  # 5 MB
