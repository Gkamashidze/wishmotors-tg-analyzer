import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import asyncpg
import pytz

from database.models import (
    CREATE_TABLES_SQL,
    MIGRATE_SQL,
    CashDepositRow,
    ExpenseRow,
    OrderRow,
    ParseFailureRow,
    ProductRow,
    ReturnRow,
    SaleRow,
)

logger = logging.getLogger(__name__)


class Database:
    def __init__(self, dsn: str, timezone: str = "Asia/Tbilisi") -> None:
        self.dsn = dsn
        self.tz = pytz.timezone(timezone)
        self._pool: Optional[asyncpg.Pool] = None  # type: ignore[type-arg]

    @property
    def pool(self) -> asyncpg.Pool:  # type: ignore[type-arg]
        """Return the connection pool, raising if init() was not called."""
        if self._pool is None:
            raise RuntimeError("Database.init() must be called before use.")
        return self._pool

    async def init(self) -> None:
        self._pool = await asyncpg.create_pool(
            self.dsn,
            min_size=2,
            max_size=10,
            command_timeout=30.0,
        )
        async with self.pool.acquire() as conn:
            await conn.execute(CREATE_TABLES_SQL)
            await conn.execute(MIGRATE_SQL)
        logger.info("Database pool initialised.")

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()

    # ─── Internal helpers ─────────────────────────────────────────────────────

    def _now(self) -> datetime:
        return datetime.now(self.tz)

    def _week_ago(self) -> datetime:
        return self._now() - timedelta(days=7)

    def _rows(self, records: list) -> List[Dict[str, Any]]:
        return [dict(r) for r in records]

    def _row(self, record: Any) -> Optional[Dict[str, Any]]:
        return dict(record) if record else None

    # ─── Products ─────────────────────────────────────────────────────────────

    async def get_product_by_id(self, product_id: int) -> Optional[ProductRow]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM products WHERE id = $1", product_id
            )
            return self._row(row)  # type: ignore[return-value]

    async def get_product_by_oem(self, oem_code: str) -> Optional[ProductRow]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM products WHERE oem_code = $1", oem_code.strip()
            )
            return self._row(row)  # type: ignore[return-value]

    async def get_product_by_partial_oem(self, partial: str) -> Optional[ProductRow]:
        """Find a product whose OEM code ends with the given digits (e.g. '8500')."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM products WHERE oem_code LIKE $1",
                f"%{partial.strip()}",
            )
            return self._row(row)  # type: ignore[return-value]

    async def get_product_by_name(self, name: str) -> Optional[ProductRow]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM products WHERE name ILIKE $1", f"%{name.strip()}%"
            )
            return self._row(row)  # type: ignore[return-value]

    async def search_products(self, query: str, limit: int = 6) -> List[ProductRow]:
        """Search by OEM (partial/suffix match) or name. Suffix matches ranked highest."""
        q = query.strip()
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT *,
                          CASE
                            WHEN oem_code ILIKE $2 THEN 0
                            WHEN oem_code ILIKE $3 THEN 1
                            WHEN oem_code ILIKE $1 THEN 2
                            ELSE 3
                          END AS _rank
                   FROM products
                   WHERE oem_code ILIKE $1 OR name ILIKE $1
                   ORDER BY _rank, name
                   LIMIT $4""",
                f"%{q}%",   # $1 contains
                q,          # $2 exact
                f"%{q}",    # $3 ends-with (suffix — last 4/6 digits)
                limit,
            )
            return self._rows(rows)  # type: ignore[return-value]

    async def get_all_products(self) -> List[ProductRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM products ORDER BY name")
            return self._rows(rows)  # type: ignore[return-value]

    async def get_low_stock_products(self) -> List[ProductRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM products WHERE current_stock <= min_stock ORDER BY current_stock"
            )
            return self._rows(rows)  # type: ignore[return-value]

    async def create_product(
        self,
        name: str,
        oem_code: Optional[str],
        stock: int,
        min_stock: int,
        price: float,
    ) -> int:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO products (name, oem_code, current_stock, min_stock, unit_price)
                   VALUES ($1, $2, $3, $4, $5)
                   RETURNING id""",
                name, oem_code or None, stock, min_stock, price,
            )
            return row["id"]

    async def upsert_product(
        self,
        name: str,
        oem_code: Optional[str],
        stock: int,
        min_stock: int,
        price: float,
    ) -> int:
        """Atomic upsert: update stock+price if OEM matches, otherwise insert."""
        async with self.pool.acquire() as conn:
            if oem_code:
                row = await conn.fetchrow(
                    """INSERT INTO products (name, oem_code, current_stock, min_stock, unit_price)
                       VALUES ($1, $2, $3, $4, $5)
                       ON CONFLICT (oem_code)
                       DO UPDATE SET current_stock = $3, unit_price = $5
                       RETURNING id""",
                    name, oem_code, stock, min_stock, price,
                )
                return row["id"]

            # No OEM — fall back to name search then insert
            existing = await conn.fetchrow(
                "SELECT id FROM products WHERE name ILIKE $1", f"%{name.strip()}%"
            )
            if existing:
                await conn.execute(
                    "UPDATE products SET current_stock = $1, unit_price = $2 WHERE id = $3",
                    stock, price, existing["id"],
                )
                return existing["id"]

            row = await conn.fetchrow(
                """INSERT INTO products (name, oem_code, current_stock, min_stock, unit_price)
                   VALUES ($1, $2, $3, $4, $5)
                   RETURNING id""",
                name, None, stock, min_stock, price,
            )
            return row["id"]

    async def upsert_products_bulk(
        self, rows: list[dict]
    ) -> tuple[int, int]:
        """Bulk upsert products from Excel import.

        Each dict must have: name, oem_code, current_stock, unit.
        Returns (added, updated) counts.
        """
        added = updated = 0
        async with self.pool.acquire() as conn:
            for row in rows:
                oem = row.get("oem_code") or None
                if oem:
                    result = await conn.fetchval(
                        """WITH upsert AS (
                             INSERT INTO products (name, oem_code, current_stock, unit)
                             VALUES ($1, $2, $3, $4)
                             ON CONFLICT (oem_code) DO UPDATE
                               SET name          = EXCLUDED.name,
                                   current_stock = EXCLUDED.current_stock,
                                   unit          = EXCLUDED.unit
                             RETURNING (xmax = 0) AS inserted
                           )
                           SELECT inserted FROM upsert""",
                        row["name"], oem, row["current_stock"], row["unit"],
                    )
                    if result:
                        added += 1
                    else:
                        updated += 1
                else:
                    await conn.execute(
                        """INSERT INTO products (name, current_stock, unit)
                           VALUES ($1, $2, $3)
                           ON CONFLICT DO NOTHING""",
                        row["name"], row["current_stock"], row["unit"],
                    )
                    added += 1
        return added, updated

    async def update_stock(self, product_id: int, delta: int) -> int:
        """Apply +/- delta to current_stock. Stock never goes below 0.
        Returns the new stock level."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """UPDATE products
                   SET current_stock = GREATEST(current_stock + $1, 0)
                   WHERE id = $2
                   RETURNING current_stock""",
                delta, product_id,
            )
            return row["current_stock"] if row else 0

    # ─── Sales (atomic: record sale + update stock in one transaction) ─────────

    async def create_sale(
        self,
        product_id: Optional[int],
        quantity: int,
        unit_price: float,
        payment_method: str,
        seller_type: str = "individual",
        customer_name: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> Tuple[int, int]:
        """Insert sale and decrement stock atomically.
        Returns (sale_id, new_stock_level)."""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """INSERT INTO sales
                           (product_id, quantity, unit_price, payment_method,
                            seller_type, customer_name, notes)
                       VALUES ($1, $2, $3, $4, $5, $6, $7)
                       RETURNING id""",
                    product_id, quantity, unit_price, payment_method,
                    seller_type, customer_name or None, notes,
                )
                sale_id = row["id"]

                if product_id is not None:
                    stock_row = await conn.fetchrow(
                        """UPDATE products
                           SET current_stock = current_stock - $1
                           WHERE id = $2
                           RETURNING current_stock""",
                        quantity, product_id,
                    )
                    new_stock = stock_row["current_stock"] if stock_row else 0
                else:
                    new_stock = 0

        return sale_id, new_stock

    async def delete_sale(self, sale_id: int) -> Optional[SaleRow]:
        """Delete a sale and restore stock if a product was linked.
        Returns the deleted sale record, or None if not found."""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                sale = await conn.fetchrow("SELECT * FROM sales WHERE id = $1", sale_id)
                if not sale:
                    return None
                sale_dict = dict(sale)
                if sale_dict.get("product_id"):
                    await conn.execute(
                        """UPDATE products
                           SET current_stock = current_stock + $1
                           WHERE id = $2""",
                        sale_dict["quantity"], sale_dict["product_id"],
                    )
                await conn.execute("DELETE FROM sales WHERE id = $1", sale_id)
                return sale_dict  # type: ignore[return-value]

    async def mark_sale_paid(self, sale_id: int, payment_method: str) -> bool:
        """Mark a credit (ნისია) sale as paid. Returns True if updated."""
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                """UPDATE sales
                   SET payment_method = $1
                   WHERE id = $2 AND payment_method = 'credit'""",
                payment_method, sale_id,
            )
            return result == "UPDATE 1"

    async def mark_customer_sales_paid(self, customer_name: str, payment_method: str) -> int:
        """Mark all credit sales for a customer as paid.
        Returns the number of sales updated."""
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                """UPDATE sales
                   SET payment_method = $1
                   WHERE payment_method = 'credit' AND customer_name = $2""",
                payment_method, customer_name,
            )
            return int(result.split()[-1])

    async def rename_customer(self, old_name: str, new_name: str) -> int:
        """Rename a customer across all their credit sales. Returns count of updated rows."""
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                """UPDATE sales SET customer_name = $1
                   WHERE customer_name = $2""",
                new_name, old_name,
            )
            return int(result.split()[-1])

    async def apply_partial_payment(self, customer_name: str, amount: float) -> float:
        """Apply a partial payment to a customer's credit sales (oldest-first).

        Marks whole sales as paid ('cash') until the amount is exhausted.
        If a sale is only partially covered, its unit_price is reduced to reflect
        the remaining balance.
        Returns the remaining debt for this customer after the payment.
        """
        if amount <= 0:
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow(
                    """SELECT COALESCE(SUM(unit_price * quantity), 0) AS total
                       FROM sales
                       WHERE payment_method = 'credit' AND customer_name = $1""",
                    customer_name,
                )
                return float(row["total"]) if row else 0.0

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                rows = await conn.fetch(
                    """SELECT id, unit_price, quantity
                       FROM sales
                       WHERE payment_method = 'credit' AND customer_name = $1
                       ORDER BY sold_at ASC""",
                    customer_name,
                )
                remaining_payment = amount
                for row in rows:
                    if remaining_payment <= 0:
                        break
                    sale_total = float(row["unit_price"]) * row["quantity"]
                    if remaining_payment >= sale_total:
                        # Fully covers this sale — mark as paid
                        await conn.execute(
                            "UPDATE sales SET payment_method = 'cash' WHERE id = $1",
                            row["id"],
                        )
                        remaining_payment -= sale_total
                    else:
                        # Partially covers this sale — reduce its unit_price
                        new_total = sale_total - remaining_payment
                        new_price = new_total / row["quantity"]
                        await conn.execute(
                            "UPDATE sales SET unit_price = $1 WHERE id = $2",
                            new_price, row["id"],
                        )
                        remaining_payment = 0.0
                        break

                # Return the remaining debt for this customer
                total_row = await conn.fetchrow(
                    """SELECT COALESCE(SUM(unit_price * quantity), 0.0) AS remaining
                       FROM sales
                       WHERE payment_method = 'credit' AND customer_name = $1""",
                    customer_name,
                )
                return float(total_row["remaining"]) if total_row else 0.0

    async def get_weekly_sales(self) -> List[SaleRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT s.*, p.name AS product_name, p.oem_code
                   FROM sales s
                   LEFT JOIN products p ON s.product_id = p.id
                   WHERE s.sold_at >= $1
                   ORDER BY s.sold_at DESC""",
                self._week_ago(),
            )
            return self._rows(rows)  # type: ignore[return-value]

    async def get_credit_sales(self) -> List[SaleRow]:
        """Return all unpaid (ნისია) sales, oldest first."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT s.*, p.name AS product_name, p.oem_code
                   FROM sales s
                   LEFT JOIN products p ON s.product_id = p.id
                   WHERE s.payment_method = 'credit'
                   ORDER BY s.sold_at ASC""",
            )
            return self._rows(rows)  # type: ignore[return-value]

    async def edit_product(
        self,
        product_id: int,
        name: Optional[str] = None,
        oem_code: Optional[str] = None,
        price: Optional[float] = None,
        min_stock: Optional[int] = None,
        unit: Optional[str] = None,
    ) -> Optional[ProductRow]:
        """Update one or more product fields. Only provided (non-None) fields change.
        Returns the updated product, or None if not found."""
        updates: List[str] = []
        values: List[Any] = []
        idx = 1
        if name is not None:
            updates.append(f"name = ${idx}")
            values.append(name)
            idx += 1
        if oem_code is not None:
            updates.append(f"oem_code = ${idx}")
            values.append(oem_code or None)
            idx += 1
        if price is not None:
            updates.append(f"unit_price = ${idx}")
            values.append(price)
            idx += 1
        if min_stock is not None:
            updates.append(f"min_stock = ${idx}")
            values.append(min_stock)
            idx += 1
        if unit is not None:
            updates.append(f"unit = ${idx}")
            values.append(unit)
            idx += 1
        if not updates:
            return await self.get_product_by_id(product_id)
        values.append(product_id)
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                f"UPDATE products SET {', '.join(updates)} WHERE id = ${idx} RETURNING *",
                *values,
            )
            return self._row(row)  # type: ignore[return-value]

    # ─── Returns (atomic: record return + restore stock) ──────────────────────

    async def create_return(
        self,
        product_id: int,
        quantity: int,
        refund_amount: float,
        sale_id: Optional[int] = None,
        exchange_product_id: Optional[int] = None,
        notes: Optional[str] = None,
    ) -> Tuple[int, int]:
        """Insert return and restore stock atomically.
        Returns (return_id, new_stock_level)."""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """INSERT INTO returns
                           (sale_id, product_id, quantity, refund_amount, exchange_product_id, notes)
                       VALUES ($1, $2, $3, $4, $5, $6)
                       RETURNING id""",
                    sale_id, product_id, quantity, refund_amount, exchange_product_id, notes,
                )
                return_id = row["id"]

                stock_row = await conn.fetchrow(
                    """UPDATE products
                       SET current_stock = current_stock + $1
                       WHERE id = $2
                       RETURNING current_stock""",
                    quantity, product_id,
                )
                new_stock = stock_row["current_stock"] if stock_row else 0

        return return_id, new_stock

    async def get_weekly_returns(self) -> List[ReturnRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT r.*, p.name AS product_name
                   FROM returns r
                   LEFT JOIN products p ON r.product_id = p.id
                   WHERE r.returned_at >= $1
                   ORDER BY r.returned_at DESC""",
                self._week_ago(),
            )
            return self._rows(rows)  # type: ignore[return-value]

    # ─── Orders ───────────────────────────────────────────────────────────────

    async def create_order(
        self,
        product_id: Optional[int],
        quantity_needed: int,
        priority: str = "normal",
        notes: Optional[str] = None,
    ) -> int:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO orders (product_id, quantity_needed, priority, notes)
                   VALUES ($1, $2, $3, $4)
                   RETURNING id""",
                product_id, quantity_needed, priority, notes,
            )
            return row["id"]

    async def get_pending_orders(self) -> List[OrderRow]:
        """Return pending orders sorted by priority (urgent first), then date."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT o.*, p.name AS product_name, p.oem_code
                   FROM orders o
                   LEFT JOIN products p ON o.product_id = p.id
                   WHERE o.status = 'pending'
                   ORDER BY
                     CASE o.priority
                       WHEN 'urgent' THEN 1
                       WHEN 'normal' THEN 2
                       WHEN 'low'    THEN 3
                       ELSE 2
                     END,
                     o.created_at DESC""",
            )
            return self._rows(rows)  # type: ignore[return-value]

    async def complete_order(self, order_id: int) -> bool:
        """Mark an order as completed. Returns True if the order was found."""
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE orders SET status = 'completed' WHERE id = $1 AND status = 'pending'",
                order_id,
            )
            return result == "UPDATE 1"

    # ─── Expenses ─────────────────────────────────────────────────────────────

    async def create_expense(
        self,
        amount: float,
        description: Optional[str] = None,
        category: Optional[str] = None,
        payment_method: str = "cash",
    ) -> int:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO expenses (amount, description, category, payment_method)
                   VALUES ($1, $2, $3, $4) RETURNING id""",
                amount, description, category, payment_method,
            )
            return row["id"]

    async def get_weekly_expenses(self) -> List[ExpenseRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM expenses
                   WHERE created_at >= $1
                   ORDER BY created_at DESC""",
                self._week_ago(),
            )
            return self._rows(rows)  # type: ignore[return-value]

    # ─── Cash on hand ────────────────────────────────────────────────────────

    async def create_cash_deposit(self, amount: float, note: Optional[str] = None) -> int:
        """Record cash being deposited to the bank. Reduces hand balance."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "INSERT INTO cash_deposits (amount, note) VALUES ($1, $2) RETURNING id",
                amount, note,
            )
            return row["id"]

    async def get_cash_on_hand(self) -> Dict[str, float]:
        """Return a breakdown: cash_sales, cash_expenses, deposits, and net balance."""
        async with self.pool.acquire() as conn:
            sales_row = await conn.fetchrow(
                """SELECT COALESCE(SUM(unit_price * quantity), 0) AS total
                   FROM sales WHERE payment_method = 'cash'"""
            )
            exp_row = await conn.fetchrow(
                """SELECT COALESCE(SUM(amount), 0) AS total
                   FROM expenses WHERE payment_method = 'cash'"""
            )
            dep_row = await conn.fetchrow(
                "SELECT COALESCE(SUM(amount), 0) AS total FROM cash_deposits"
            )
        cash_sales = float(sales_row["total"])
        cash_expenses = float(exp_row["total"])
        deposits = float(dep_row["total"])
        return {
            "cash_sales": cash_sales,
            "cash_expenses": cash_expenses,
            "deposits": deposits,
            "balance": cash_sales - cash_expenses - deposits,
        }

    async def get_cash_deposits_by_period(
        self, start: datetime, end: datetime
    ) -> List[CashDepositRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM cash_deposits
                   WHERE created_at >= $1 AND created_at < $2
                   ORDER BY created_at DESC""",
                start, end,
            )
            return self._rows(rows)  # type: ignore[return-value]

    # ─── Period queries ───────────────────────────────────────────────────────

    async def import_sale(
        self,
        product_id: Optional[int],
        quantity: int,
        unit_price: float,
        payment_method: str,
        sold_at: datetime,
        seller_type: str = "individual",
        customer_name: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> int:
        """Insert a historical sale with an explicit date. Does NOT touch current stock.
        Returns the new sale id."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO sales
                       (product_id, quantity, unit_price, payment_method,
                        seller_type, customer_name, sold_at, notes)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                   RETURNING id""",
                product_id, quantity, unit_price, payment_method,
                seller_type, customer_name or None, sold_at, notes,
            )
            return row["id"]

    async def get_sales_by_period(
        self, date_from: datetime, date_to: datetime
    ) -> List[SaleRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT s.*, p.name AS product_name, p.oem_code
                   FROM sales s
                   LEFT JOIN products p ON s.product_id = p.id
                   WHERE s.sold_at >= $1 AND s.sold_at <= $2
                   ORDER BY s.sold_at DESC""",
                date_from, date_to,
            )
            return self._rows(rows)  # type: ignore[return-value]

    async def get_returns_by_period(
        self, date_from: datetime, date_to: datetime
    ) -> List[ReturnRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT r.*, p.name AS product_name
                   FROM returns r
                   LEFT JOIN products p ON r.product_id = p.id
                   WHERE r.returned_at >= $1 AND r.returned_at <= $2
                   ORDER BY r.returned_at DESC""",
                date_from, date_to,
            )
            return self._rows(rows)  # type: ignore[return-value]

    async def get_expenses_by_period(
        self, date_from: datetime, date_to: datetime
    ) -> List[ExpenseRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM expenses
                   WHERE created_at >= $1 AND created_at <= $2
                   ORDER BY created_at DESC""",
                date_from, date_to,
            )
            return self._rows(rows)  # type: ignore[return-value]

    # ─── Parse failures (diagnostics) ─────────────────────────────────────────

    async def log_parse_failure(self, topic_id: int, message_text: str) -> None:
        """Record a message that arrived in a tracked topic but could not be parsed."""
        async with self.pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO parse_failures (topic_id, message_text) VALUES ($1, $2)",
                topic_id, message_text,
            )


    async def pay_sale(self, sale_id: int, amount: float, payment_method: str) -> float:
        """Pay a single nisia fully or partially.

        If amount >= sale total: marks sale as paid with payment_method.
        If amount < sale total: reduces unit_price to reflect remaining balance.
        Returns remaining debt on this sale after payment (0.0 if fully paid).
        """
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    "SELECT unit_price, quantity FROM sales WHERE id = $1 AND payment_method = 'credit'",
                    sale_id,
                )
                if not row:
                    return -1.0  # sale not found or already paid
                sale_total = float(row["unit_price"]) * row["quantity"]
                if amount >= sale_total:
                    await conn.execute(
                        "UPDATE sales SET payment_method = $1 WHERE id = $2",
                        payment_method, sale_id,
                    )
                    return 0.0
                else:
                    remaining = sale_total - amount
                    new_price = remaining / row["quantity"]
                    await conn.execute(
                        "UPDATE sales SET unit_price = $1 WHERE id = $2",
                        new_price, sale_id,
                    )
                    return remaining

    async def get_unreceipted_company_sales(self) -> list:
        """Return all company (შპს) sales that haven't been receipted yet."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT s.id, s.quantity, s.unit_price, s.payment_method,
                          s.seller_type, s.customer_name, s.sold_at, s.notes,
                          s.receipt_printed,
                          p.name AS product_name
                   FROM sales s
                   LEFT JOIN products p ON p.id = s.product_id
                   WHERE s.seller_type = 'company'
                     AND s.receipt_printed = FALSE
                   ORDER BY s.sold_at ASC""",
            )
            return self._rows(rows)

    async def mark_receipt_printed(self, sale_id: int) -> bool:
        """Mark a sale as receipted. Returns True if the row was updated."""
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE sales SET receipt_printed = TRUE WHERE id = $1",
                sale_id,
            )
            return result == "UPDATE 1"

    async def get_recent_parse_failures(self, limit: int = 20) -> list:
        """Return individual parse failure records, newest first."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT id, topic_id, message_text, created_at
                   FROM parse_failures
                   ORDER BY created_at DESC
                   LIMIT $1""",
                limit,
            )
            return self._rows(rows)

    async def get_parse_failure_stats(self, days: int = 30) -> List[ParseFailureRow]:
        """Return top unparsed messages grouped by text, for the last N days."""
        since = self._now() - timedelta(days=days)
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT message_text, COUNT(*) AS occurrences, MAX(created_at) AS last_seen
                   FROM parse_failures
                   WHERE created_at >= $1
                   GROUP BY message_text
                   ORDER BY occurrences DESC
                   LIMIT 20""",
                since,
            )
            return self._rows(rows)  # type: ignore[return-value]

    async def get_parse_failure_count(self, days: int = 7) -> int:
        """Return total number of parse failures in the last N days."""
        since = self._now() - timedelta(days=days)
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT COUNT(*) AS cnt FROM parse_failures WHERE created_at >= $1",
                since,
            )
            return row["cnt"] if row else 0

    async def purge_old_parse_failures(self, days: int = 90) -> int:
        """Delete parse_failures records older than `days` days.
        Returns the number of rows deleted."""
        cutoff = self._now() - timedelta(days=days)
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM parse_failures WHERE created_at < $1",
                cutoff,
            )
            # asyncpg returns "DELETE N" as a string
            return int(result.split()[-1])

    # ─── Sale / Expense lookup & editing ─────────────────────────────────────

    async def get_sale(self, sale_id: int) -> Optional[Dict[str, Any]]:
        """Fetch a single sale with joined product name."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT s.*, p.name AS product_name, p.oem_code
                   FROM sales s
                   LEFT JOIN products p ON s.product_id = p.id
                   WHERE s.id = $1""",
                sale_id,
            )
            return self._row(row)

    async def edit_sale(
        self,
        sale_id: int,
        quantity: Optional[int] = None,
        unit_price: Optional[float] = None,
        payment_method: Optional[str] = None,
        customer_name: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Update sale fields. Adjusts product stock when quantity changes.
        Returns the updated sale row, or None if not found."""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                sale = await conn.fetchrow("SELECT * FROM sales WHERE id=$1", sale_id)
                if not sale:
                    return None
                old = dict(sale)

                # Stock adjustment: only when quantity actually changes
                if (
                    quantity is not None
                    and quantity != old["quantity"]
                    and old.get("product_id")
                ):
                    delta = old["quantity"] - quantity  # >0 restores, <0 deducts
                    await conn.execute(
                        "UPDATE products SET current_stock = current_stock + $1 WHERE id = $2",
                        delta, old["product_id"],
                    )

                updates: List[str] = []
                values: List[Any] = []
                idx = 1
                if quantity is not None:
                    updates.append(f"quantity = ${idx}")
                    values.append(quantity)
                    idx += 1
                if unit_price is not None:
                    updates.append(f"unit_price = ${idx}")
                    values.append(unit_price)
                    idx += 1
                if payment_method is not None:
                    updates.append(f"payment_method = ${idx}")
                    values.append(payment_method)
                    idx += 1
                if customer_name is not None:
                    updates.append(f"customer_name = ${idx}")
                    values.append(customer_name or None)
                    idx += 1
                if notes is not None:
                    updates.append(f"notes = ${idx}")
                    values.append(notes or None)
                    idx += 1

                if not updates:
                    return self._row(sale)

                values.append(sale_id)
                row = await conn.fetchrow(
                    f"UPDATE sales SET {', '.join(updates)} WHERE id = ${idx} RETURNING *",
                    *values,
                )
                return self._row(row)

    async def get_expense(self, expense_id: int) -> Optional[Dict[str, Any]]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM expenses WHERE id = $1", expense_id)
            return self._row(row)

    async def edit_expense(
        self,
        expense_id: int,
        amount: Optional[float] = None,
        description: Optional[str] = None,
        category: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Update expense fields. Returns updated row or None if not found."""
        updates: List[str] = []
        values: List[Any] = []
        idx = 1
        if amount is not None:
            updates.append(f"amount = ${idx}")
            values.append(amount)
            idx += 1
        if description is not None:
            updates.append(f"description = ${idx}")
            values.append(description or None)
            idx += 1
        if category is not None:
            updates.append(f"category = ${idx}")
            values.append(category or None)
            idx += 1
        if not updates:
            return await self.get_expense(expense_id)
        values.append(expense_id)
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                f"UPDATE expenses SET {', '.join(updates)} WHERE id = ${idx} RETURNING *",
                *values,
            )
            return self._row(row)

    async def update_expense_topic_message(
        self, expense_id: int, topic_id: int, topic_message_id: int
    ) -> None:
        """Store the group-topic message ID for an expense so it can be updated later."""
        async with self.pool.acquire() as conn:
            await conn.execute(
                "UPDATE expenses SET topic_id=$1, topic_message_id=$2 WHERE id=$3",
                topic_id, topic_message_id, expense_id,
            )

    # ─── Topic message tracking ───────────────────────────────────────────────

    async def update_sale_topic_message(
        self, sale_id: int, topic_id: int, topic_message_id: int
    ) -> None:
        """Store the group-topic message ID so it can be deleted later."""
        async with self.pool.acquire() as conn:
            await conn.execute(
                "UPDATE sales SET topic_id=$1, topic_message_id=$2 WHERE id=$3",
                topic_id, topic_message_id, sale_id,
            )

    # ─── Soft-delete & restore ────────────────────────────────────────────────

    async def soft_delete_sale(self, sale_id: int) -> Optional[Dict[str, Any]]:
        """Move a sale to deleted_sales (24h restore window), restore stock.
        Returns the archived row (with topic_id / topic_message_id), or None."""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                sale = await conn.fetchrow("SELECT * FROM sales WHERE id=$1", sale_id)
                if not sale:
                    return None
                sale_dict = dict(sale)

                expires = self._now() + timedelta(hours=24)
                archived = await conn.fetchrow(
                    """INSERT INTO deleted_sales
                           (original_sale_id, product_id, quantity, unit_price,
                            payment_method, seller_type, customer_name,
                            sold_at, notes, topic_id, expires_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                       RETURNING id""",
                    sale_dict["id"],
                    sale_dict.get("product_id"),
                    sale_dict["quantity"],
                    sale_dict["unit_price"],
                    sale_dict["payment_method"],
                    sale_dict.get("seller_type", "individual"),
                    sale_dict.get("customer_name"),
                    sale_dict.get("sold_at"),
                    sale_dict.get("notes"),
                    sale_dict.get("topic_id"),
                    expires,
                )
                sale_dict["deleted_id"] = archived["id"]

                if sale_dict.get("product_id"):
                    await conn.execute(
                        "UPDATE products SET current_stock=current_stock+$1 WHERE id=$2",
                        sale_dict["quantity"], sale_dict["product_id"],
                    )
                await conn.execute("DELETE FROM sales WHERE id=$1", sale_id)

        return sale_dict

    async def get_deleted_sale(self, deleted_id: int) -> Optional[Dict[str, Any]]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM deleted_sales WHERE id=$1", deleted_id
            )
            return dict(row) if row else None

    async def restore_deleted_sale(self, deleted_id: int) -> Optional[int]:
        """Re-insert a deleted sale into sales, decrement stock.
        Returns the new sale_id, or None if not found / expired."""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                ds = await conn.fetchrow(
                    "SELECT * FROM deleted_sales WHERE id=$1 AND expires_at > NOW()",
                    deleted_id,
                )
                if not ds:
                    return None
                d = dict(ds)

                row = await conn.fetchrow(
                    """INSERT INTO sales
                           (product_id, quantity, unit_price, payment_method,
                            seller_type, customer_name, sold_at, notes)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                       RETURNING id""",
                    d.get("product_id"), d["quantity"], d["unit_price"],
                    d["payment_method"], d.get("seller_type", "individual"),
                    d.get("customer_name"), d.get("sold_at"), d.get("notes"),
                )
                new_sale_id = row["id"]

                if d.get("product_id"):
                    await conn.execute(
                        "UPDATE products SET current_stock=current_stock-$1 WHERE id=$2",
                        d["quantity"], d["product_id"],
                    )
                await conn.execute("DELETE FROM deleted_sales WHERE id=$1", deleted_id)

        return new_sale_id

    async def purge_expired_deleted_sales(self) -> int:
        """Delete expired restore records (>24h). Returns count removed."""
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM deleted_sales WHERE expires_at < NOW()"
            )
            return int(result.split()[-1])
