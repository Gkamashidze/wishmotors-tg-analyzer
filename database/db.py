import aiosqlite
from pathlib import Path
from typing import Any, Dict, List, Optional

from database.models import CREATE_TABLES_SQL


class Database:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    async def init(self) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            await db.executescript(CREATE_TABLES_SQL)
            await db.commit()

    # ─── Internal helpers ─────────────────────────────────────────────────────

    async def _fetchone(self, sql: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(sql, params) as cur:
                row = await cur.fetchone()
                return dict(row) if row else None

    async def _fetchall(self, sql: str, params: tuple = ()) -> List[Dict[str, Any]]:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(sql, params) as cur:
                rows = await cur.fetchall()
                return [dict(r) for r in rows]

    async def _execute(self, sql: str, params: tuple = ()) -> int:
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute(sql, params) as cur:
                await db.commit()
                return cur.lastrowid  # type: ignore[return-value]

    # ─── Products ─────────────────────────────────────────────────────────────

    async def get_product_by_id(self, product_id: int) -> Optional[Dict]:
        return await self._fetchone(
            "SELECT * FROM products WHERE id = ?", (product_id,)
        )

    async def get_product_by_oem(self, oem_code: str) -> Optional[Dict]:
        return await self._fetchone(
            "SELECT * FROM products WHERE oem_code = ?", (oem_code.strip(),)
        )

    async def get_product_by_name(self, name: str) -> Optional[Dict]:
        return await self._fetchone(
            "SELECT * FROM products WHERE name LIKE ?", (f"%{name.strip()}%",)
        )

    async def get_all_products(self) -> List[Dict]:
        return await self._fetchall(
            "SELECT * FROM products ORDER BY name"
        )

    async def get_low_stock_products(self) -> List[Dict]:
        return await self._fetchall(
            "SELECT * FROM products WHERE current_stock <= min_stock ORDER BY current_stock"
        )

    async def create_product(
        self,
        name: str,
        oem_code: Optional[str],
        stock: int,
        min_stock: int,
        price: float,
    ) -> int:
        return await self._execute(
            """INSERT INTO products (name, oem_code, current_stock, min_stock, unit_price)
               VALUES (?, ?, ?, ?, ?)""",
            (name, oem_code or None, stock, min_stock, price),
        )

    async def upsert_product(
        self,
        name: str,
        oem_code: Optional[str],
        stock: int,
        price: float,
    ) -> int:
        """Update stock and price if product exists; create it otherwise."""
        existing: Optional[Dict] = None
        if oem_code:
            existing = await self.get_product_by_oem(oem_code)
        if not existing:
            existing = await self.get_product_by_name(name)

        if existing:
            await self._execute(
                "UPDATE products SET current_stock = ?, unit_price = ? WHERE id = ?",
                (stock, price, existing["id"]),
            )
            return existing["id"]

        return await self.create_product(
            name=name, oem_code=oem_code, stock=stock, min_stock=20, price=price
        )

    async def update_stock(self, product_id: int, delta: int) -> int:
        """Apply +/- delta to current_stock. Returns the new stock level."""
        await self._execute(
            "UPDATE products SET current_stock = current_stock + ? WHERE id = ?",
            (delta, product_id),
        )
        product = await self.get_product_by_id(product_id)
        return product["current_stock"] if product else 0

    # ─── Sales ────────────────────────────────────────────────────────────────

    async def create_sale(
        self,
        product_id: Optional[int],
        quantity: int,
        sale_price: float,
        payment_method: str,
        notes: Optional[str] = None,
    ) -> int:
        return await self._execute(
            """INSERT INTO sales (product_id, quantity, sale_price, payment_method, notes)
               VALUES (?, ?, ?, ?, ?)""",
            (product_id, quantity, sale_price, payment_method, notes),
        )

    async def get_weekly_sales(self) -> List[Dict]:
        return await self._fetchall(
            """SELECT s.*, p.name AS product_name, p.oem_code
               FROM sales s
               LEFT JOIN products p ON s.product_id = p.id
               WHERE s.sold_at >= datetime('now', '-7 days')
               ORDER BY s.sold_at DESC"""
        )

    # ─── Returns ──────────────────────────────────────────────────────────────

    async def create_return(
        self,
        product_id: int,
        quantity: int,
        refund_amount: float,
        sale_id: Optional[int] = None,
        exchange_product_id: Optional[int] = None,
        notes: Optional[str] = None,
    ) -> int:
        return await self._execute(
            """INSERT INTO returns
                   (sale_id, product_id, quantity, refund_amount, exchange_product_id, notes)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (sale_id, product_id, quantity, refund_amount, exchange_product_id, notes),
        )

    async def get_weekly_returns(self) -> List[Dict]:
        return await self._fetchall(
            """SELECT r.*, p.name AS product_name
               FROM returns r
               LEFT JOIN products p ON r.product_id = p.id
               WHERE r.returned_at >= datetime('now', '-7 days')
               ORDER BY r.returned_at DESC"""
        )

    # ─── Orders ───────────────────────────────────────────────────────────────

    async def create_order(
        self,
        product_id: Optional[int],
        quantity_needed: int,
        notes: Optional[str] = None,
    ) -> int:
        return await self._execute(
            """INSERT INTO orders (product_id, quantity_needed, notes)
               VALUES (?, ?, ?)""",
            (product_id, quantity_needed, notes),
        )

    async def get_pending_orders(self) -> List[Dict]:
        return await self._fetchall(
            """SELECT o.*, p.name AS product_name, p.oem_code
               FROM orders o
               LEFT JOIN products p ON o.product_id = p.id
               WHERE o.status = 'pending'
               ORDER BY o.created_at DESC"""
        )

    # ─── Expenses ─────────────────────────────────────────────────────────────

    async def create_expense(
        self,
        amount: float,
        description: Optional[str] = None,
        category: Optional[str] = None,
    ) -> int:
        return await self._execute(
            "INSERT INTO expenses (amount, description, category) VALUES (?, ?, ?)",
            (amount, description, category),
        )

    async def get_weekly_expenses(self) -> List[Dict]:
        return await self._fetchall(
            """SELECT * FROM expenses
               WHERE created_at >= datetime('now', '-7 days')
               ORDER BY created_at DESC"""
        )
