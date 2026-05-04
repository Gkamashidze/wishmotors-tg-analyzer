"""Unit tests for the AI Financial Manager — data access layer + prompt builder.

The Anthropic API call itself is not exercised here (network-dependent); the
data_access layer is fully tested with mocked asyncpg, and the prompt builder
is tested for stability of structure.
"""

import os
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

# Minimal env so config imports cleanly when transitively pulled in.
os.environ.setdefault("BOT_TOKEN", "test")
os.environ.setdefault("GROUP_ID", "1")
os.environ.setdefault("SALES_TOPIC_ID", "2")
os.environ.setdefault("ORDERS_TOPIC_ID", "3")
os.environ.setdefault("EXPENSES_TOPIC_ID", "4")
os.environ.setdefault("STOCK_TOPIC_ID", "5")
os.environ.setdefault("NISIAS_TOPIC_ID", "6")
os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost/test")
os.environ.setdefault("ADMIN_IDS", "12345")
os.environ.setdefault("RAILWAY_ENVIRONMENT", "test")

from bot.financial_ai.data_access import (  # noqa: E402
    FinancialDataReader,
    PeriodOverview,
)
from bot.financial_ai.prompt import SYSTEM_PROMPT, build_messages  # noqa: E402


# ─── Pool/conn mock helpers ───────────────────────────────────────────────────


def _make_pool_with_conn():
    conn = AsyncMock()
    conn.execute = AsyncMock(return_value=None)  # SET LOCAL statement_timeout
    pool = MagicMock()
    pool.acquire = AsyncMock(return_value=conn)
    pool.release = AsyncMock(return_value=None)
    return pool, conn


def _period():
    end = datetime(2026, 4, 17, tzinfo=timezone.utc)
    start = end - timedelta(days=7)
    return start, end


# ─── Validation ───────────────────────────────────────────────────────────────


class TestValidation:
    def test_rejects_inverted_period(self):
        pool, _ = _make_pool_with_conn()
        reader = FinancialDataReader(pool)
        end = datetime(2026, 4, 1, tzinfo=timezone.utc)
        start = end + timedelta(days=1)
        with pytest.raises(ValueError, match="period_start must be before"):
            reader._validate_period(start, end)

    def test_rejects_period_over_one_year(self):
        pool, _ = _make_pool_with_conn()
        reader = FinancialDataReader(pool)
        start = datetime(2024, 1, 1, tzinfo=timezone.utc)
        end = start + timedelta(days=400)
        with pytest.raises(ValueError, match="≤ 366 days"):
            reader._validate_period(start, end)

    def test_clamp_limit_floor(self):
        assert FinancialDataReader._clamp_limit(0) == 1
        assert FinancialDataReader._clamp_limit(-5) == 1

    def test_clamp_limit_ceiling(self):
        assert FinancialDataReader._clamp_limit(9999) == 25

    def test_clamp_limit_passthrough(self):
        assert FinancialDataReader._clamp_limit(7) == 7


# ─── Period overview ──────────────────────────────────────────────────────────


class TestPeriodOverview:
    @pytest.mark.asyncio
    async def test_computes_margin_and_net_profit(self):
        pool, conn = _make_pool_with_conn()
        conn.fetchrow = AsyncMock(
            return_value={
                "revenue": 1000.0,
                "cogs": 700.0,
                "sales_count": 10,
                "returns_total": 50.0,
                "expenses_total": 100.0,
            }
        )
        reader = FinancialDataReader(pool)
        start, end = _period()

        result = await reader.get_period_overview(start, end)

        assert isinstance(result, PeriodOverview)
        assert result.revenue_gel == 1000.0
        assert result.cogs_gel == 700.0
        assert result.gross_profit_gel == 300.0
        assert result.gross_margin_pct == 30.0
        assert result.net_profit_gel == 150.0  # 300 - 100 - 50
        assert result.avg_order_value_gel == 100.0
        assert result.sales_count == 10

    @pytest.mark.asyncio
    async def test_zero_revenue_does_not_divide_by_zero(self):
        pool, conn = _make_pool_with_conn()
        conn.fetchrow = AsyncMock(
            return_value={
                "revenue": 0.0,
                "cogs": 0.0,
                "sales_count": 0,
                "returns_total": 0.0,
                "expenses_total": 25.0,
            }
        )
        reader = FinancialDataReader(pool)
        start, end = _period()

        result = await reader.get_period_overview(start, end)

        assert result.gross_margin_pct == 0.0
        assert result.avg_order_value_gel == 0.0
        assert result.net_profit_gel == -25.0


# ─── Top products by profit ───────────────────────────────────────────────────


class TestTopProductsByProfit:
    @pytest.mark.asyncio
    async def test_orders_and_computes_margin(self):
        pool, conn = _make_pool_with_conn()
        conn.fetch = AsyncMock(
            return_value=[
                {
                    "product_id": 1,
                    "name": "A",
                    "oem_code": "111",
                    "units_sold": 5,
                    "revenue": 500.0,
                    "cogs": 300.0,
                },
                {
                    "product_id": 2,
                    "name": "B",
                    "oem_code": None,
                    "units_sold": 2,
                    "revenue": 200.0,
                    "cogs": 100.0,
                },
            ]
        )
        reader = FinancialDataReader(pool)
        start, end = _period()

        result = await reader.get_top_products_by_profit(start, end, limit=10)

        assert len(result) == 2
        assert result[0].name == "A"
        assert result[0].profit_gel == 200.0
        assert result[0].margin_pct == 40.0
        assert result[1].margin_pct == 50.0


# ─── Sales velocity & restock alerts ──────────────────────────────────────────


class TestSalesVelocity:
    @pytest.mark.asyncio
    async def test_units_per_day_and_days_of_cover(self):
        pool, conn = _make_pool_with_conn()
        conn.fetch = AsyncMock(
            return_value=[
                {
                    "product_id": 1,
                    "name": "X",
                    "oem_code": "777",
                    "current_stock": 14,
                    "units_sold": 7,
                },  # 1/day, 14 days cover
                {
                    "product_id": 2,
                    "name": "Y",
                    "oem_code": None,
                    "current_stock": 100,
                    "units_sold": 0,
                },  # no velocity
            ]
        )
        reader = FinancialDataReader(pool)
        start, end = _period()

        result = await reader.get_sales_velocity(start, end, limit=10)

        assert result[0].units_per_day == 1.0
        assert result[0].days_of_cover == 14.0
        assert result[1].days_of_cover is None  # zero velocity → None


class TestRestockAlerts:
    @pytest.mark.asyncio
    async def test_filters_by_threshold(self):
        pool, conn = _make_pool_with_conn()
        # First product is low cover; second is well-stocked.
        conn.fetch = AsyncMock(
            return_value=[
                {
                    "product_id": 1,
                    "name": "Urgent",
                    "oem_code": "111",
                    "current_stock": 2,
                    "units_sold": 14,
                },  # 2/day, 1 day cover
                {
                    "product_id": 2,
                    "name": "Healthy",
                    "oem_code": "222",
                    "current_stock": 200,
                    "units_sold": 7,
                },  # 1/day, 200 days cover
            ]
        )
        reader = FinancialDataReader(pool)
        start, end = _period()

        alerts = await reader.get_restock_alerts(start, end, days_of_cover_threshold=14)

        assert len(alerts) == 1
        assert alerts[0].name == "Urgent"
        assert alerts[0].suggested_order_qty > 0


# ─── Cashflow ─────────────────────────────────────────────────────────────────


class TestCashflow:
    @pytest.mark.asyncio
    async def test_combines_totals_and_period(self):
        pool, conn = _make_pool_with_conn()
        # First call returns totals, second returns period figures.
        conn.fetchrow = AsyncMock(
            side_effect=[
                {
                    "cash_sales_total": 5000.0,
                    "cash_expenses_total": 800.0,
                    "deposits_total": 2000.0,
                    "ar_total": 600.0,
                },
                {"cash_in": 1200.0, "cash_out": 400.0},
            ]
        )
        reader = FinancialDataReader(pool)
        start, end = _period()

        cf = await reader.get_cashflow_snapshot(start, end)

        assert cf.cash_on_hand_gel == 5000.0 - 800.0 - 2000.0
        assert cf.accounts_receivable_gel == 600.0
        assert cf.period_net_cashflow_gel == 800.0


# ─── Prompt builder ───────────────────────────────────────────────────────────


class TestPromptBuilder:
    def test_system_prompt_is_georgian_and_capped(self):
        # System prompt must be in Georgian and reference Telegram + 500-char rule.
        assert "ფინანსური მენეჯერი" in SYSTEM_PROMPT
        assert "500 სიმბოლო" in SYSTEM_PROMPT

    def test_build_messages_includes_fewshot_then_real(self):
        messages = build_messages(
            {"overview": {"revenue_gel": 0}},
            "10.04.2026 — 17.04.2026",
        )
        # 3-turn structure: fewshot user → fewshot assistant → real user.
        assert len(messages) == 3
        assert messages[0]["role"] == "user"
        assert messages[1]["role"] == "assistant"
        assert messages[2]["role"] == "user"
        assert "10.04.2026 — 17.04.2026" in messages[2]["content"]
