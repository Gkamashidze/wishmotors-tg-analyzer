"""AI Financial Manager — read-only analytics over PostgreSQL.

Public surface:
    - FinancialDataReader: secure, typed, read-only access to ledger/sales/expenses/orders/inventory.
    - generate_weekly_advice: produces a short Georgian business advice block for /report.
"""

from bot.financial_ai.analyzer import generate_weekly_advice
from bot.financial_ai.data_access import FinancialDataReader

__all__ = ["FinancialDataReader", "generate_weekly_advice"]
