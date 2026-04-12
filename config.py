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

DATABASE_PATH: str = os.getenv("DATABASE_PATH", "data/wishmotors.db")
TIMEZONE: str = os.getenv("TIMEZONE", "Asia/Tbilisi")
REPORT_WEEKDAY: str = os.getenv("REPORT_WEEKDAY", "sun")
REPORT_HOUR: int = int(os.getenv("REPORT_HOUR", "22"))
REPORT_MINUTE: int = int(os.getenv("REPORT_MINUTE", "0"))
MIN_STOCK_THRESHOLD: int = int(os.getenv("MIN_STOCK_THRESHOLD", "20"))
