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
class ProductWAC:
    """Current Weighted Average Cost for a product, computed from the
    remaining quantity across all active `inventory_batches` rows."""

    product_id: int
    name: str
    oem_code: Optional[str]
    on_hand_units: float
    wac_per_unit_gel: float
    inventory_value_gel: float
    last_purchase_cost_gel: Optional[float]
    cost_drift_pct: Optional[float]  # (last_purchase - WAC) / WAC * 100


@dataclass(frozen=True)
class OrdersPipeline:
    """Snapshot of the `orders` queue — pending restocks customers or staff
    have requested but not yet fulfilled."""

    total_pending: int
    urgent_pending: int
    normal_pending: int
    low_pending: int
    oldest_pending_days: Optional[int]
    top_pending_products: List[Dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class ProductMetrics:
    """Turnover and ROI per product for the given period."""

    product_id: int
    name: str
    oem_code: Optional[str]
    revenue_gel: float
    cogs_gel: float
    roi_pct: float            # (gross_profit / cogs) * 100
    inventory_value_gel: float
    turnover_ratio: float     # cogs / inventory_value; 0 when no inventory


@dataclass(frozen=True)
class AdvancedMetrics:
    """5 advanced financial KPIs for the given period."""

    # 1. Inventory Turnover — how many times inventory was sold
    inventory_turnover_ratio: float
    # 2. Average Order Value
    aov_gel: float
    # 3. ROI = (Net Profit / COGS) * 100
    roi_pct: float
    # 4. GMROI = Gross Margin / avg inventory value
    gmroi: float
    # 5. Real-time Cash Flow = all-time revenue − expenses − tied-up inventory capital
    realtime_cashflow_gel: float
    total_inventory_value_gel: float
    top_by_turnover: List[ProductMetrics] = field(default_factory=list)
    top_by_roi: List[ProductMetrics] = field(default_factory=list)


@dataclass(frozen=True)
class FinancialSnapshot:
    """Bundle: everything the AI needs in a single call."""

    overview: PeriodOverview
    cashflow: CashflowSnapshot
    top_products_by_profit: List[ProductProfit] = field(default_factory=list)
    top_products_by_velocity: List[ProductVelocity] = field(default_factory=list)
    restock_alerts: List[RestockAlert] = field(default_factory=list)
    ledger_top_accounts: List[LedgerAccountBalance] = field(default_factory=list)
    wac_top_products: List[ProductWAC] = field(default_factory=list)
    orders_pipeline: Optional[OrdersPipeline] = None
    advanced_metrics: Optional[AdvancedMetrics] = None

    def to_dict(self) -> Dict[str, Any]:
        """JSON-friendly representation handed to the LLM."""
        return {
            "overview": asdict(self.overview),
            "cashflow": asdict(self.cashflow),
            "advanced_metrics": (
                asdict(self.advanced_metrics) if self.advanced_metrics else None
            ),
            "top_products_by_profit": [asdict(p) for p in self.top_products_by_profit],
            "top_products_by_velocity": [asdict(p) for p in self.top_products_by_velocity],
            "restock_alerts": [asdict(p) for p in self.restock_alerts],
            "ledger_top_accounts": [asdict(p) for p in self.ledger_top_accounts],
            "wac_top_products": [asdict(p) for p in self.wac_top_products],
            "orders_pipeline": (
                asdict(self.orders_pipeline) if self.orders_pipeline else None
            ),
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

    # ─── Tool 7: WAC per product (from inventory_batches) ────────────────────

    _SQL_WAC_TOP = """
        WITH active AS (
            SELECT
                b.product_id,
                SUM(b.remaining_quantity)                         AS on_hand,
                SUM(b.remaining_quantity * b.unit_cost)           AS inv_value,
                MAX(b.received_at)                                AS last_received_at
            FROM inventory_batches b
            WHERE b.remaining_quantity > 0
            GROUP BY b.product_id
        ),
        latest AS (
            SELECT DISTINCT ON (b.product_id)
                b.product_id,
                b.unit_cost AS last_purchase_cost
            FROM inventory_batches b
            ORDER BY b.product_id, b.received_at DESC, b.id DESC
        )
        SELECT
            a.product_id                                          AS product_id,
            COALESCE(p.name, 'უცნობი')                            AS name,
            p.oem_code                                            AS oem_code,
            a.on_hand                                             AS on_hand_units,
            a.inv_value                                           AS inv_value,
            l.last_purchase_cost                                  AS last_purchase_cost
        FROM active a
        LEFT JOIN products p ON p.id = a.product_id
        LEFT JOIN latest l   ON l.product_id = a.product_id
        ORDER BY a.inv_value DESC
        LIMIT $1
    """

    async def get_wac_per_product(
        self, limit: int = _DEFAULT_TOP_N
    ) -> List[ProductWAC]:
        """Current WAC for the top-N products by inventory value.

        WAC = sum(remaining_quantity * unit_cost) / sum(remaining_quantity)
        computed over active batches (remaining_quantity > 0).

        Also reports drift between the most recent purchase cost and the
        blended WAC — a big positive drift means supplier prices are rising
        and margins will compress unless retail is raised.
        """
        limit = self._clamp_limit(limit)
        conn = await self._conn()
        try:
            rows = await conn.fetch(self._SQL_WAC_TOP, limit)
        finally:
            await self._pool.release(conn)

        result: List[ProductWAC] = []
        for r in rows:
            on_hand = float(r["on_hand_units"] or 0)
            inv_value = float(r["inv_value"] or 0)
            wac = (inv_value / on_hand) if on_hand > 0 else 0.0
            last_cost_raw = r["last_purchase_cost"]
            last_cost = float(last_cost_raw) if last_cost_raw is not None else None
            drift_pct: Optional[float]
            if last_cost is not None and wac > 0:
                drift_pct = round((last_cost - wac) / wac * 100.0, 2)
            else:
                drift_pct = None
            result.append(
                ProductWAC(
                    product_id=int(r["product_id"]),
                    name=str(r["name"]),
                    oem_code=r["oem_code"],
                    on_hand_units=round(on_hand, 3),
                    wac_per_unit_gel=round(wac, 4),
                    inventory_value_gel=round(inv_value, 2),
                    last_purchase_cost_gel=(
                        round(last_cost, 4) if last_cost is not None else None
                    ),
                    cost_drift_pct=drift_pct,
                )
            )
        return result

    # ─── Tool 8: pending orders pipeline ─────────────────────────────────────

    _SQL_ORDERS_PIPELINE = """
        SELECT
            COUNT(*) FILTER (WHERE status = 'pending')                       AS total_pending,
            COUNT(*) FILTER (WHERE status = 'pending' AND priority = 'urgent') AS urgent_pending,
            COUNT(*) FILTER (WHERE status = 'pending' AND priority = 'normal') AS normal_pending,
            COUNT(*) FILTER (WHERE status = 'pending' AND priority = 'low')    AS low_pending,
            MIN(created_at) FILTER (WHERE status = 'pending')                AS oldest_pending_at
        FROM orders
    """

    _SQL_ORDERS_TOP_PENDING = """
        SELECT
            COALESCE(p.name, o.notes, 'უცნობი')                              AS name,
            p.oem_code                                                        AS oem_code,
            SUM(o.quantity_needed)                                            AS qty_needed,
            COUNT(*)                                                          AS order_count,
            MAX(o.priority)                                                   AS max_priority
        FROM orders o
        LEFT JOIN products p ON p.id = o.product_id
        WHERE o.status = 'pending'
        GROUP BY COALESCE(p.name, o.notes, 'უცნობი'), p.oem_code
        ORDER BY
            CASE MAX(o.priority) WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
            SUM(o.quantity_needed) DESC
        LIMIT $1
    """

    async def get_orders_pipeline(
        self, limit: int = _DEFAULT_TOP_N
    ) -> OrdersPipeline:
        """Snapshot of the pending orders queue.

        Helps the AI recommend follow-up actions: "6 urgent orders pending
        average age 9 days — call supplier today."
        """
        limit = self._clamp_limit(limit)
        conn = await self._conn()
        try:
            summary = await conn.fetchrow(self._SQL_ORDERS_PIPELINE)
            top = await conn.fetch(self._SQL_ORDERS_TOP_PENDING, limit)
        finally:
            await self._pool.release(conn)

        oldest_at = summary["oldest_pending_at"]
        oldest_days: Optional[int]
        if oldest_at is not None:
            # asyncpg returns tz-aware datetime; use aware "now" to subtract
            now_aware = datetime.now(oldest_at.tzinfo) if oldest_at.tzinfo else datetime.now()
            oldest_days = max(0, (now_aware - oldest_at).days)
        else:
            oldest_days = None

        top_list: List[Dict[str, Any]] = [
            {
                "name": str(r["name"]),
                "oem_code": r["oem_code"],
                "qty_needed": int(r["qty_needed"]),
                "order_count": int(r["order_count"]),
                "max_priority": str(r["max_priority"]),
            }
            for r in top
        ]

        return OrdersPipeline(
            total_pending=int(summary["total_pending"] or 0),
            urgent_pending=int(summary["urgent_pending"] or 0),
            normal_pending=int(summary["normal_pending"] or 0),
            low_pending=int(summary["low_pending"] or 0),
            oldest_pending_days=oldest_days,
            top_pending_products=top_list,
        )

    # ─── Tool 9: advanced financial metrics (Turnover, AOV, ROI, GMROI, CF) ──

    _SQL_ADVANCED_GLOBAL = """
        WITH
          sales_agg AS (
            SELECT
              COALESCE(SUM(unit_price * quantity), 0) AS revenue,
              COALESCE(SUM(cost_amount), 0)            AS cogs,
              COUNT(*)                                 AS sales_count
            FROM sales
            WHERE sold_at >= $1 AND sold_at < $2
          ),
          exp_agg AS (
            SELECT COALESCE(SUM(amount), 0) AS expenses
            FROM expenses
            WHERE created_at >= $1 AND created_at < $2
          ),
          returns_agg AS (
            SELECT COALESCE(SUM(refund_amount), 0) AS returns_total
            FROM returns
            WHERE returned_at >= $1 AND returned_at < $2
          ),
          inv_val AS (
            SELECT COALESCE(SUM(remaining_quantity * unit_cost), 0) AS inv_value
            FROM inventory_batches
            WHERE remaining_quantity > 0
          ),
          alltime_sales AS (
            SELECT COALESCE(SUM(unit_price * quantity), 0) AS total_rev FROM sales
          ),
          alltime_exp AS (
            SELECT COALESCE(SUM(amount), 0) AS total_exp FROM expenses
          )
        SELECT
          s.revenue, s.cogs, s.sales_count,
          e.expenses, r.returns_total,
          i.inv_value,
          at.total_rev, ae.total_exp
        FROM sales_agg s, exp_agg e, returns_agg r, inv_val i,
             alltime_sales at, alltime_exp ae
    """

    _SQL_PRODUCT_METRICS = """
        WITH prod_sales AS (
            SELECT
                p.id                                              AS product_id,
                COALESCE(p.name, 'უცნობი')                        AS name,
                p.oem_code,
                COALESCE(SUM(s.unit_price * s.quantity), 0)       AS revenue,
                COALESCE(SUM(s.cost_amount), 0)                   AS cogs
            FROM products p
            JOIN sales s ON s.product_id = p.id
                AND s.sold_at >= $1 AND s.sold_at < $2
            GROUP BY p.id, p.name, p.oem_code
            HAVING COALESCE(SUM(s.cost_amount), 0) > 0
        ),
        prod_inv AS (
            SELECT
                product_id,
                COALESCE(SUM(remaining_quantity * unit_cost), 0)  AS inv_value
            FROM inventory_batches
            WHERE remaining_quantity > 0
            GROUP BY product_id
        )
        SELECT
            ps.product_id,
            ps.name,
            ps.oem_code,
            ps.revenue,
            ps.cogs,
            COALESCE(pi.inv_value, 0) AS inv_value
        FROM prod_sales ps
        LEFT JOIN prod_inv pi ON pi.product_id = ps.product_id
        ORDER BY ps.revenue DESC
        LIMIT $3
    """

    async def get_advanced_metrics(
        self,
        period_start: datetime,
        period_end: datetime,
        top_n: int = _DEFAULT_TOP_N,
    ) -> AdvancedMetrics:
        self._validate_period(period_start, period_end)
        top_n = self._clamp_limit(top_n)
        conn = await self._conn()
        try:
            global_row = await conn.fetchrow(
                self._SQL_ADVANCED_GLOBAL, period_start, period_end
            )
            prod_rows = await conn.fetch(
                self._SQL_PRODUCT_METRICS, period_start, period_end, top_n
            )
        finally:
            await self._pool.release(conn)

        revenue = float(global_row["revenue"])
        cogs = float(global_row["cogs"])
        sales_count = int(global_row["sales_count"])
        expenses = float(global_row["expenses"])
        returns_total = float(global_row["returns_total"])
        inv_value = float(global_row["inv_value"])
        total_rev = float(global_row["total_rev"])
        total_exp = float(global_row["total_exp"])

        gross_profit = revenue - cogs
        net_profit = gross_profit - expenses - returns_total

        turnover = round(cogs / inv_value, 4) if inv_value > 0 else 0.0
        aov = round(revenue / sales_count, 2) if sales_count > 0 else 0.0
        roi = round(net_profit / cogs * 100, 2) if cogs > 0 else 0.0
        gmroi = round(gross_profit / inv_value, 4) if inv_value > 0 else 0.0
        realtime_cf = round(total_rev - total_exp - inv_value, 2)

        product_metrics: List[ProductMetrics] = []
        for r in prod_rows:
            p_rev = float(r["revenue"])
            p_cogs = float(r["cogs"])
            p_inv = float(r["inv_value"])
            p_gross = p_rev - p_cogs
            p_roi = round(p_gross / p_cogs * 100, 2) if p_cogs > 0 else 0.0
            p_turn = round(p_cogs / p_inv, 4) if p_inv > 0 else 0.0
            product_metrics.append(
                ProductMetrics(
                    product_id=int(r["product_id"]),
                    name=str(r["name"]),
                    oem_code=r["oem_code"],
                    revenue_gel=round(p_rev, 2),
                    cogs_gel=round(p_cogs, 2),
                    roi_pct=p_roi,
                    inventory_value_gel=round(p_inv, 2),
                    turnover_ratio=p_turn,
                )
            )

        top_by_turnover = sorted(
            [p for p in product_metrics if p.turnover_ratio > 0],
            key=lambda x: x.turnover_ratio,
            reverse=True,
        )[:5]
        top_by_roi = sorted(
            product_metrics, key=lambda x: x.roi_pct, reverse=True
        )[:5]

        return AdvancedMetrics(
            inventory_turnover_ratio=turnover,
            aov_gel=aov,
            roi_pct=roi,
            gmroi=gmroi,
            realtime_cashflow_gel=realtime_cf,
            total_inventory_value_gel=round(inv_value, 2),
            top_by_turnover=top_by_turnover,
            top_by_roi=top_by_roi,
        )

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
        wac = await self.get_wac_per_product(limit=top_n)
        orders = await self.get_orders_pipeline(limit=top_n)
        advanced = await self.get_advanced_metrics(period_start, period_end, top_n=top_n)

        return FinancialSnapshot(
            overview=overview,
            cashflow=cashflow,
            advanced_metrics=advanced,
            top_products_by_profit=top_profit,
            top_products_by_velocity=top_velocity,
            restock_alerts=alerts,
            ledger_top_accounts=ledger,
            wac_top_products=wac,
            orders_pipeline=orders,
        )
