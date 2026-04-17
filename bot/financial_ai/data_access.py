"""Secure, read-only data access layer for the AI Financial Manager.

Design (MCP-style):
    - Every public method is a typed "tool" with a strict input contract.
    - All queries are static SQL constants — no string interpolation of caller data.
    - Every query is time-bounded; no unbounded scans.
    - Outputs are aggregated dataclasses (not raw row dumps) to keep AI context tight.
    - The shared asyncpg pool is acquired with statement_timeout=5s as defense-in-depth.

This module NEVER mutates the database. The only allowed verb is SELECT.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import asyncpg

logger = logging.getLogger(__name__)

# ─── Hard limits ──────────────────────────────────────────────────────────────
# These bound query cost AND output tokens given to the LLM.
_MAX_TOP_N = 25
_DEFAULT_TOP_N = 10
_STATEMENT_TIMEOUT_MS = 5000

# Velocity / restock heuristics
_RESTOCK_DAYS_OF_COVER = 14  # flag SKU if current stock < N days of avg daily sales


# ─── Output schemas (typed, JSON-serialisable) ────────────────────────────────


@dataclass(frozen=True)
class PeriodOverview:
    period_start: str
    period_end: str
    revenue_gel: float
    cogs_gel: float
    gross_profit_gel: float
    gross_margin_pct: float
    expenses_gel: float
    net_profit_gel: float
    sales_count: int
    returns_gel: float
    avg_order_value_gel: float


@dataclass(frozen=True)
class ProductProfit:
    product_id: int
    name: str
    oem_code: Optional[str]
    units_sold: int
    revenue_gel: float
    cogs_gel: float
    profit_gel: float
    margin_pct: float


@dataclass(frozen=True)
class ProductVelocity:
    product_id: int
    name: str
    oem_code: Optional[str]
    units_sold: int
    days_in_period: int
    units_per_day: float
    current_stock: int
    days_of_cover: Optional[float]  # None if velocity is 0


@dataclass(frozen=True)
class RestockAlert:
    product_id: int
    name: str
    oem_code: Optional[str]
    current_stock: int
    units_per_day: float
    days_of_cover: float
    suggested_order_qty: int


@dataclass(frozen=True)
class CashflowSnapshot:
    cash_on_hand_gel: float
    cash_sales_total_gel: float
    cash_expenses_total_gel: float
    cash_deposited_to_bank_gel: float
    accounts_receivable_gel: float  # outstanding nisia
    period_cash_in_gel: float
    period_cash_out_gel: float
    period_net_cashflow_gel: float


@dataclass(frozen=True)
class LedgerAccountBalance:
    account_code: str
    debit_total_gel: float
    credit_total_gel: float
    net_balance_gel: float


@dataclass(frozen=True)
class FinancialSnapshot:
    """Bundle: everything the AI needs in a single call."""

    overview: PeriodOverview
    cashflow: CashflowSnapshot
    top_products_by_profit: List[ProductProfit] = field(default_factory=list)
    top_products_by_velocity: List[ProductVelocity] = field(default_factory=list)
    restock_alerts: List[RestockAlert] = field(default_factory=list)
    ledger_top_accounts: List[LedgerAccountBalance] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """JSON-friendly representation handed to the LLM."""
        return {
            "overview": asdict(self.overview),
            "cashflow": asdict(self.cashflow),
            "top_products_by_profit": [asdict(p) for p in self.top_products_by_profit],
            "top_products_by_velocity": [asdict(p) for p in self.top_products_by_velocity],
            "restock_alerts": [asdict(p) for p in self.restock_alerts],
            "ledger_top_accounts": [asdict(p) for p in self.ledger_top_accounts],
        }


# ─── Reader ───────────────────────────────────────────────────────────────────


class FinancialDataReader:
    """Read-only access to financial tables.

    Accepts a shared asyncpg pool. Each method opens a connection, sets a
    short statement_timeout, and runs a single static query.
    """

    def __init__(self, pool: asyncpg.Pool) -> None:  # type: ignore[type-arg]
        self._pool = pool

    # ─── Validation helpers ───────────────────────────────────────────────────

    @staticmethod
    def _validate_period(start: datetime, end: datetime) -> None:
        if start >= end:
            raise ValueError("period_start must be before period_end")
        # Cap at 1 year to bound query cost.
        if (end - start) > timedelta(days=366):
            raise ValueError("period must be ≤ 366 days")

    @staticmethod
    def _clamp_limit(limit: int) -> int:
        if limit < 1:
            return 1
        if limit > _MAX_TOP_N:
            return _MAX_TOP_N
        return limit

    @staticmethod
    def _days_in(start: datetime, end: datetime) -> int:
        return max(1, (end - start).days)

    async def _conn(self) -> Any:
        """Acquire a connection with a short statement timeout."""
        conn = await self._pool.acquire()
        await conn.execute(f"SET LOCAL statement_timeout = {_STATEMENT_TIMEOUT_MS}")
        return conn

    # ─── Tool 1: period overview (revenue, COGS, profit, margin) ─────────────

    _SQL_OVERVIEW = """
        WITH s AS (
            SELECT
                COALESCE(SUM(unit_price * quantity), 0) AS revenue,
                COALESCE(SUM(cost_amount), 0)            AS cogs,
                COUNT(*)                                  AS sales_count
            FROM sales
            WHERE sold_at >= $1 AND sold_at < $2
        ),
        r AS (
            SELECT COALESCE(SUM(refund_amount), 0) AS returns_total
            FROM returns
            WHERE returned_at >= $1 AND returned_at < $2
        ),
        e AS (
            SELECT COALESCE(SUM(amount), 0) AS expenses_total
            FROM expenses
            WHERE created_at >= $1 AND created_at < $2
        )
        SELECT
            s.revenue, s.cogs, s.sales_count,
            r.returns_total, e.expenses_total
        FROM s, r, e
    """

    async def get_period_overview(
        self, period_start: datetime, period_end: datetime
    ) -> PeriodOverview:
        self._validate_period(period_start, period_end)
        conn = await self._conn()
        try:
            row = await conn.fetchrow(self._SQL_OVERVIEW, period_start, period_end)
        finally:
            await self._pool.release(conn)

        revenue = float(row["revenue"])
        cogs = float(row["cogs"])
        returns_total = float(row["returns_total"])
        expenses_total = float(row["expenses_total"])
        sales_count = int(row["sales_count"])

        gross_profit = revenue - cogs
        gross_margin_pct = (gross_profit / revenue * 100.0) if revenue > 0 else 0.0
        net_profit = gross_profit - expenses_total - returns_total
        avg_order_value = (revenue / sales_count) if sales_count > 0 else 0.0

        return PeriodOverview(
            period_start=period_start.isoformat(),
            period_end=period_end.isoformat(),
            revenue_gel=round(revenue, 2),
            cogs_gel=round(cogs, 2),
            gross_profit_gel=round(gross_profit, 2),
            gross_margin_pct=round(gross_margin_pct, 2),
            expenses_gel=round(expenses_total, 2),
            net_profit_gel=round(net_profit, 2),
            sales_count=sales_count,
            returns_gel=round(returns_total, 2),
            avg_order_value_gel=round(avg_order_value, 2),
        )

    # ─── Tool 2: top products by profit ──────────────────────────────────────

    _SQL_TOP_PROFIT = """
        SELECT
            p.id                                              AS product_id,
            COALESCE(p.name, 'უცნობი')                        AS name,
            p.oem_code                                        AS oem_code,
            SUM(s.quantity)                                   AS units_sold,
            SUM(s.unit_price * s.quantity)                    AS revenue,
            SUM(s.cost_amount)                                AS cogs
        FROM sales s
        LEFT JOIN products p ON p.id = s.product_id
        WHERE s.sold_at >= $1 AND s.sold_at < $2
          AND s.product_id IS NOT NULL
        GROUP BY p.id, p.name, p.oem_code
        HAVING SUM(s.unit_price * s.quantity) > 0
        ORDER BY (SUM(s.unit_price * s.quantity) - SUM(s.cost_amount)) DESC
        LIMIT $3
    """

    async def get_top_products_by_profit(
        self,
        period_start: datetime,
        period_end: datetime,
        limit: int = _DEFAULT_TOP_N,
    ) -> List[ProductProfit]:
        self._validate_period(period_start, period_end)
        limit = self._clamp_limit(limit)
        conn = await self._conn()
        try:
            rows = await conn.fetch(
                self._SQL_TOP_PROFIT, period_start, period_end, limit
            )
        finally:
            await self._pool.release(conn)

        result: List[ProductProfit] = []
        for r in rows:
            revenue = float(r["revenue"])
            cogs = float(r["cogs"])
            profit = revenue - cogs
            margin = (profit / revenue * 100.0) if revenue > 0 else 0.0
            result.append(
                ProductProfit(
                    product_id=int(r["product_id"]),
                    name=str(r["name"]),
                    oem_code=r["oem_code"],
                    units_sold=int(r["units_sold"]),
                    revenue_gel=round(revenue, 2),
                    cogs_gel=round(cogs, 2),
                    profit_gel=round(profit, 2),
                    margin_pct=round(margin, 2),
                )
            )
        return result

    # ─── Tool 3: sales velocity (units/day) per product ──────────────────────

    _SQL_TOP_VELOCITY = """
        SELECT
            p.id                                              AS product_id,
            COALESCE(p.name, 'უცნობი')                        AS name,
            p.oem_code                                        AS oem_code,
            COALESCE(p.current_stock, 0)                      AS current_stock,
            SUM(s.quantity)                                   AS units_sold
        FROM sales s
        LEFT JOIN products p ON p.id = s.product_id
        WHERE s.sold_at >= $1 AND s.sold_at < $2
          AND s.product_id IS NOT NULL
        GROUP BY p.id, p.name, p.oem_code, p.current_stock
        ORDER BY SUM(s.quantity) DESC
        LIMIT $3
    """

    async def get_sales_velocity(
        self,
        period_start: datetime,
        period_end: datetime,
        limit: int = _DEFAULT_TOP_N,
    ) -> List[ProductVelocity]:
        self._validate_period(period_start, period_end)
        limit = self._clamp_limit(limit)
        days = self._days_in(period_start, period_end)
        conn = await self._conn()
        try:
            rows = await conn.fetch(
                self._SQL_TOP_VELOCITY, period_start, period_end, limit
            )
        finally:
            await self._pool.release(conn)

        result: List[ProductVelocity] = []
        for r in rows:
            units = int(r["units_sold"])
            stock = int(r["current_stock"])
            per_day = units / days
            days_cover: Optional[float]
            if per_day > 0:
                days_cover = round(stock / per_day, 1) if stock >= 0 else 0.0
            else:
                days_cover = None
            result.append(
                ProductVelocity(
                    product_id=int(r["product_id"]),
                    name=str(r["name"]),
                    oem_code=r["oem_code"],
                    units_sold=units,
                    days_in_period=days,
                    units_per_day=round(per_day, 3),
                    current_stock=stock,
                    days_of_cover=days_cover,
                )
            )
        return result

    # ─── Tool 4: restock alerts (low cover relative to velocity) ─────────────

    async def get_restock_alerts(
        self,
        period_start: datetime,
        period_end: datetime,
        days_of_cover_threshold: int = _RESTOCK_DAYS_OF_COVER,
        limit: int = _DEFAULT_TOP_N,
    ) -> List[RestockAlert]:
        """Products whose stock will run out within `days_of_cover_threshold` days."""
        velocities = await self.get_sales_velocity(
            period_start, period_end, limit=_MAX_TOP_N
        )
        days_of_cover_threshold = max(1, min(days_of_cover_threshold, 90))
        alerts: List[RestockAlert] = []
        for v in velocities:
            if v.days_of_cover is None:
                continue
            if v.days_of_cover >= days_of_cover_threshold:
                continue
            # Suggest enough to cover (threshold * 2) days as a safety buffer.
            target_qty = int(v.units_per_day * (days_of_cover_threshold * 2))
            suggested = max(1, target_qty - v.current_stock)
            alerts.append(
                RestockAlert(
                    product_id=v.product_id,
                    name=v.name,
                    oem_code=v.oem_code,
                    current_stock=v.current_stock,
                    units_per_day=v.units_per_day,
                    days_of_cover=v.days_of_cover,
                    suggested_order_qty=suggested,
                )
            )
        # Sort: lowest cover first (most urgent), then take top N
        alerts.sort(key=lambda a: a.days_of_cover)
        return alerts[: self._clamp_limit(limit)]

    # ─── Tool 5: cashflow snapshot ───────────────────────────────────────────

    _SQL_CASH_TOTALS = """
        SELECT
            (SELECT COALESCE(SUM(unit_price * quantity), 0)
                 FROM sales WHERE payment_method = 'cash')        AS cash_sales_total,
            (SELECT COALESCE(SUM(amount), 0)
                 FROM expenses WHERE payment_method = 'cash')     AS cash_expenses_total,
            (SELECT COALESCE(SUM(amount), 0)
                 FROM cash_deposits)                              AS deposits_total,
            (SELECT COALESCE(SUM(unit_price * quantity), 0)
                 FROM sales WHERE payment_method = 'credit')      AS ar_total
    """

    _SQL_PERIOD_CASHFLOW = """
        SELECT
            (SELECT COALESCE(SUM(unit_price * quantity), 0)
                 FROM sales
                 WHERE payment_method IN ('cash', 'transfer')
                   AND sold_at >= $1 AND sold_at < $2)            AS cash_in,
            (SELECT COALESCE(SUM(amount), 0)
                 FROM expenses
                 WHERE created_at >= $1 AND created_at < $2)      AS cash_out
    """

    async def get_cashflow_snapshot(
        self, period_start: datetime, period_end: datetime
    ) -> CashflowSnapshot:
        self._validate_period(period_start, period_end)
        conn = await self._conn()
        try:
            totals = await conn.fetchrow(self._SQL_CASH_TOTALS)
            period = await conn.fetchrow(
                self._SQL_PERIOD_CASHFLOW, period_start, period_end
            )
        finally:
            await self._pool.release(conn)

        cash_sales = float(totals["cash_sales_total"])
        cash_expenses = float(totals["cash_expenses_total"])
        deposits = float(totals["deposits_total"])
        ar = float(totals["ar_total"])
        cash_in = float(period["cash_in"])
        cash_out = float(period["cash_out"])

        return CashflowSnapshot(
            cash_on_hand_gel=round(cash_sales - cash_expenses - deposits, 2),
            cash_sales_total_gel=round(cash_sales, 2),
            cash_expenses_total_gel=round(cash_expenses, 2),
            cash_deposited_to_bank_gel=round(deposits, 2),
            accounts_receivable_gel=round(ar, 2),
            period_cash_in_gel=round(cash_in, 2),
            period_cash_out_gel=round(cash_out, 2),
            period_net_cashflow_gel=round(cash_in - cash_out, 2),
        )

    # ─── Tool 6: ledger account balances (top N by absolute net) ─────────────

    _SQL_LEDGER_TOP = """
        SELECT
            account_code,
            COALESCE(SUM(debit_amount), 0)  AS debit_total,
            COALESCE(SUM(credit_amount), 0) AS credit_total
        FROM ledger
        WHERE transaction_date >= $1 AND transaction_date < $2
        GROUP BY account_code
        ORDER BY ABS(COALESCE(SUM(debit_amount), 0)
                   - COALESCE(SUM(credit_amount), 0)) DESC
        LIMIT $3
    """

    async def get_ledger_top_accounts(
        self,
        period_start: datetime,
        period_end: datetime,
        limit: int = _DEFAULT_TOP_N,
    ) -> List[LedgerAccountBalance]:
        self._validate_period(period_start, period_end)
        limit = self._clamp_limit(limit)
        conn = await self._conn()
        try:
            rows = await conn.fetch(
                self._SQL_LEDGER_TOP, period_start, period_end, limit
            )
        finally:
            await self._pool.release(conn)

        return [
            LedgerAccountBalance(
                account_code=str(r["account_code"]),
                debit_total_gel=round(float(r["debit_total"]), 2),
                credit_total_gel=round(float(r["credit_total"]), 2),
                net_balance_gel=round(
                    float(r["debit_total"]) - float(r["credit_total"]), 2
                ),
            )
            for r in rows
        ]

    # ─── Composite: full snapshot for the AI ─────────────────────────────────

    async def get_financial_snapshot(
        self,
        period_start: datetime,
        period_end: datetime,
        top_n: int = _DEFAULT_TOP_N,
    ) -> FinancialSnapshot:
        """One-shot bundle. The AI never needs to call individual tools — it
        receives this entire snapshot in its prompt input."""
        self._validate_period(period_start, period_end)
        top_n = self._clamp_limit(top_n)

        overview = await self.get_period_overview(period_start, period_end)
        cashflow = await self.get_cashflow_snapshot(period_start, period_end)
        top_profit = await self.get_top_products_by_profit(
            period_start, period_end, limit=top_n
        )
        top_velocity = await self.get_sales_velocity(
            period_start, period_end, limit=top_n
        )
        alerts = await self.get_restock_alerts(period_start, period_end, limit=top_n)
        ledger = await self.get_ledger_top_accounts(
            period_start, period_end, limit=top_n
        )

        return FinancialSnapshot(
            overview=overview,
            cashflow=cashflow,
            top_products_by_profit=top_profit,
            top_products_by_velocity=top_velocity,
            restock_alerts=alerts,
            ledger_top_accounts=ledger,
        )
