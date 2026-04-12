import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import asyncpg
import pytz

from database.models import CREATE_TABLES_SQL

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
        self._pool = await asyncpg.create_pool(self.dsn, min_size=2, max_size=10)
        async with self.pool.acquire() as conn:
            await conn.execute(CREATE_TABLES_SQL)
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

    async def get_product_by_id(self, product_id: int) -> Optional[Dict]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM products WHERE id = $1", product_id
            )
            return self._row(row)

    async def get_product_by_oem(self, oem_code: str) -> Optional[Dict]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM products WHERE oem_code = $1", oem_code.strip()
            )
            return self._row(row)

    async def get_product_by_name(self, name: str) -> Optional[Dict]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM products WHERE name ILIKE $1", f"%{name.strip()}%"
            )
            return self._row(row)

    async def get_all_products(self) -> List[Dict]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM products ORDER BY name")
            return self._rows(rows)

    async def get_low_stock_products(self) -> List[Dict]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM products WHERE current_stock <= min_stock ORDER BY current_stock"
            )
            return self._rows(rows)

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
        notes: Optional[str] = None,
    ) -> Tuple[int, int]:
        """Insert sale and decrement stock atomically.
        Returns (sale_id, new_stock_level)."""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """INSERT INTO sales (product_id, quantity, unit_price, payment_method, notes)
                       VALUES ($1, $2, $3, $4, $5)
                       RETURNING id""",
                    product_id, quantity, unit_price, payment_method, notes,
                )
                sale_id = row["id"]

                if product_id is not None:
                    stock_row = await conn.fetchrow(
                        """UPDATE products
                           SET current_stock = GREATEST(current_stock - $1, 0)
                           WHERE id = $2
                           RETURNING current_stock""",
                        quantity, product_id,
                    )
                    new_stock = stock_row["current_stock"] if stock_row else 0
                else:
                    new_stock = 0

        return sale_id, new_stock

    async def get_weekly_sales(self) -> List[Dict]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT s.*, p.name AS product_name, p.oem_code
                   FROM sales s
                   LEFT JOIN products p ON s.product_id = p.id
                   WHERE s.sold_at >= $1
                   ORDER BY s.sold_at DESC""",
                self._week_ago(),
            )
            return self._rows(rows)

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

    async def get_weekly_returns(self) -> List[Dict]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT r.*, p.name AS product_name
                   FROM returns r
                   LEFT JOIN products p ON r.product_id = p.id
                   WHERE r.returned_at >= $1
                   ORDER BY r.returned_at DESC""",
                self._week_ago(),
            )
            return self._rows(rows)

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

    async def get_pending_orders(self) -> List[Dict]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT o.*, p.name AS product_name, p.oem_code
                   FROM orders o
                   LEFT JOIN products p ON o.product_id = p.id
                   WHERE o.status = 'pending'
                   ORDER BY o.created_at DESC""",
            )
            return self._rows(rows)

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

    async def get_weekly_expenses(self) -> List[Dict]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM expenses
                   WHERE created_at >= $1
                   ORDER BY created_at DESC""",
                self._week_ago(),
            )
            return self._rows(rows)

    # ─── Period queries ───────────────────────────────────────────────────────

    async def get_sales_by_period(
        self, date_from: datetime, date_to: datetime
    ) -> List[Dict]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT s.*, p.name AS product_name, p.oem_code
                   FROM sales s
                   LEFT JOIN products p ON s.product_id = p.id
                   WHERE s.sold_at >= $1 AND s.sold_at <= $2
                   ORDER BY s.sold_at DESC""",
                date_from, date_to,
            )
            return self._rows(rows)

    async def get_returns_by_period(
        self, date_from: datetime, date_to: datetime
    ) -> List[Dict]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT r.*, p.name AS product_name
                   FROM returns r
                   LEFT JOIN products p ON r.product_id = p.id
                   WHERE r.returned_at >= $1 AND r.returned_at <= $2
                   ORDER BY r.returned_at DESC""",
                date_from, date_to,
            )
            return self._rows(rows)

    async def get_expenses_by_period(
        self, date_from: datetime, date_to: datetime
    ) -> List[Dict]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM expenses
                   WHERE created_at >= $1 AND created_at <= $2
                   ORDER BY created_at DESC""",
                date_from, date_to,
            )
            return self._rows(rows)
