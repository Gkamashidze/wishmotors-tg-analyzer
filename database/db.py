import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import asyncpg
import pytz

from database.models import (
    CREATE_TABLES_SQL,
    MIGRATE_SQL,
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
        """Search by OEM (partial match) or name. OEM matches ranked first."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT *,
                          CASE WHEN oem_code ILIKE $1 THEN 0 ELSE 1 END AS _rank
                   FROM products
                   WHERE oem_code ILIKE $1 OR name ILIKE $1
                   ORDER BY _rank, name
                   LIMIT $2""",
                f"%{query.strip()}%", limit,
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
        notes: Optional[str] = None,
    ) -> int:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO orders (product_id, quantity_needed, notes)
                   VALUES ($1, $2, $3)
                   RETURNING id""",
                product_id, quantity_needed, notes,
            )
            return row["id"]

    async def get_pending_orders(self) -> List[OrderRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT o.*, p.name AS product_name, p.oem_code
                   FROM orders o
                   LEFT JOIN products p ON o.product_id = p.id
                   WHERE o.status = 'pending'
                   ORDER BY o.created_at DESC""",
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
    ) -> int:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "INSERT INTO expenses (amount, description, category) VALUES ($1, $2, $3) RETURNING id",
                amount, description, category,
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
