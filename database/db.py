import asyncio
import logging
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

import asyncpg
import pytz

from database.audit_log import AuditLogger
from database.models import (
    CREATE_TABLES_SQL,
    MIGRATE_SQL,
    CashDepositRow,
    ExpenseRow,
    OrderRow,
    ParseFailureRow,
    PersonalOrderRow,
    ProductRow,
    ReturnRow,
    SaleRow,
    TransferRow,
)

logger = logging.getLogger(__name__)


class Database:
    def __init__(self, dsn: str, timezone: str = "Asia/Tbilisi") -> None:
        self.dsn = dsn
        self.tz = pytz.timezone(timezone)
        self._pool: Optional[asyncpg.Pool] = None  # type: ignore[type-arg]
        self.audit: Optional[AuditLogger] = None

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
            # Log the orders table schema on every startup so Railway logs
            # show exactly which columns exist — critical for diagnosing
            # "column does not exist" INSERT failures.
            cols = await conn.fetch(
                """SELECT column_name, data_type
                   FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'orders'
                   ORDER BY ordinal_position""",
            )
            col_names = [c["column_name"] for c in cols]
            logger.info("orders table columns after migrations: %s", col_names)
            required = {"product_id", "quantity_needed", "priority", "notes", "oem_code", "part_name"}
            missing = required - set(col_names)
            if missing:
                logger.error(
                    "CRITICAL: orders table is missing required columns: %s "
                    "— INSERT will fail until these are added via migration.",
                    sorted(missing),
                )
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

    def _audit(
        self,
        event_type: str,
        payload: Dict[str, Any],
        reference_id: Optional[str] = None,
    ) -> None:
        """Fire-and-forget: schedule an audit log write without blocking the caller."""
        if self.audit is None:
            return
        try:
            asyncio.get_running_loop().create_task(
                self.audit.log_safe(event_type, payload, reference_id)
            )
        except RuntimeError:
            pass

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
                "SELECT * FROM products WHERE UPPER(oem_code) = $1", oem_code.strip().upper()
            )
            return self._row(row)  # type: ignore[return-value]

    async def get_product_by_partial_oem(self, partial: str) -> Optional[ProductRow]:
        """Find a product whose OEM code ends with the given digits (e.g. '8500')."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM products WHERE oem_code ILIKE $1",
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

    async def get_catalog_for_search(self) -> List[dict]:
        """Return all products with structured compatibility entries for AI search."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    p.id, p.name, p.oem_code, p.current_stock, p.unit_price,
                    p.unit, p.category, p.compatibility_notes,
                    (
                        SELECT ROUND(
                            SUM(ib.remaining_quantity * ib.unit_cost)::numeric
                            / NULLIF(SUM(ib.remaining_quantity), 0),
                            2
                        )
                        FROM inventory_batches ib
                        WHERE ib.product_id = p.id AND ib.remaining_quantity > 0
                    ) AS unit_cost,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'model',     pc.model,
                                'drive',     pc.drive,
                                'engine',    pc.engine,
                                'fuel_type', pc.fuel_type,
                                'year_from', pc.year_from,
                                'year_to',   pc.year_to
                            ) ORDER BY pc.model
                        ) FILTER (WHERE pc.id IS NOT NULL),
                        '[]'::json
                    ) AS compat_entries
                FROM products p
                LEFT JOIN product_compatibility pc ON pc.product_id = p.id
                GROUP BY p.id
                ORDER BY p.name
                """
            )
            return [dict(r) for r in rows]

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
        stock: int = 0,
        min_stock: int = 0,
        price: float = 0.0,
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
                oem_code = oem_code.strip().upper()
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
                    oem = oem.strip().upper()
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

    # ─── Chart of accounts (simple double-entry bookkeeping) ──────────────────
    # Every business transaction is written to `ledger` as at least two rows
    # that balance: SUM(debit) == SUM(credit). The reference_id ties all rows
    # of one transaction together so reversals can cancel them precisely.
    #
    #   1100 — Cash on hand (საკასო ნაღდი)              — asset
    #   1200 — Bank / transfers (დარიცხვა, ბანკი)        — asset
    #   1400 — Accounts receivable / nisia (დებიტორული)   — asset
    #   1600 — Inventory (მარაგი)                        — asset
    #   2100 — Accounts payable (მომწოდებლები)           — liability
    #   6100 — Sales revenue (შემოსავალი გაყიდვებიდან)    — revenue
    #   7100 — Cost of goods sold (თვითღირებულება)        — expense
    #   7400 — Operating expenses (საოპერაციო ხარჯი)     — expense
    #   7500 — Inventory write-off / shortage (საწყობის ნაკლი) — expense

    ACCOUNT_CASH              = "1100"
    ACCOUNT_BANK              = "1200"
    ACCOUNT_AR                = "1400"   # legacy ფ.პ ნისია — kept for migration compat
    ACCOUNT_RETAIL_AR         = "1410 1" # LLC retail ნისია (საცალო მოთხოვნები)
    ACCOUNT_INVENTORY         = "1610"
    ACCOUNT_ACCOUNTS_PAYABLE  = "3110"
    ACCOUNT_VAT_PAYABLE       = "3330"
    ACCOUNT_REVENUE           = "6100"
    ACCOUNT_COGS              = "7100"
    ACCOUNT_OPERATING_EXPENSE = "7400"
    ACCOUNT_INVENTORY_WRITEOFF = "7500"

    @classmethod
    def _payment_account(
        cls,
        payment_method: str,
        buyer_type: str = "retail",
        business_account: Optional[str] = None,
    ) -> str:
        """Return the debit-side account for a sale or AR-side for settlement.

        cash/transfer → direct to 1100/1200 (no AR intermediary).
        credit + retail → 1410 1 (retail AR sub-account).
        credit + business → 1410 N (specific business customer sub-account).
        """
        if payment_method == "cash":
            return cls.ACCOUNT_CASH
        if payment_method == "transfer":
            return cls.ACCOUNT_BANK
        if buyer_type == "business" and business_account:
            return business_account
        return cls.ACCOUNT_RETAIL_AR

    @staticmethod
    async def _get_or_create_business_customer(conn: Any, name: str) -> str:
        """Return account code for a business customer (e.g. '1410 2'), creating if new."""
        row = await conn.fetchrow(
            "SELECT account_number FROM business_customers WHERE name = $1", name
        )
        if row:
            return f"1410 {row['account_number']}"
        new = await conn.fetchrow(
            "INSERT INTO business_customers (name) VALUES ($1) RETURNING account_number",
            name,
        )
        acct_num = new["account_number"]
        code = f"1410 {acct_num}"
        parent = await conn.fetchrow(
            "SELECT id FROM chart_of_accounts WHERE code = '1410'"
        )
        await conn.execute(
            """INSERT INTO chart_of_accounts (code, name, type, description, parent_id)
               VALUES ($1, $2, 'asset', $3, $4)
               ON CONFLICT (code) DO NOTHING""",
            code, name,
            f"მოთხოვნები მყიდველ-მეწარმეზე: {name}",
            parent["id"] if parent else None,
        )
        return code

    @staticmethod
    async def _get_ar_account_for_sale(conn: Any, sale: dict) -> str:
        """Return the correct AR account for a sale: 1410 1 (retail) or 1410 N (business)."""
        if sale.get("buyer_type") == "business":
            name = sale.get("client_name") or sale.get("customer_name")
            if name:
                row = await conn.fetchrow(
                    "SELECT account_number FROM business_customers WHERE name = $1", name
                )
                if row:
                    return f"1410 {row['account_number']}"
        return "1410 1"

    @staticmethod
    async def _post_ledger_pair(
        conn: Any,
        *,
        debit_account: str,
        credit_account: str,
        amount: float,
        description: str,
        reference_id: str,
    ) -> None:
        """Write one balanced transaction (2 rows: debit + credit) to the ledger.

        Zero / negative amounts are skipped silently so callers can pass
        per-leg totals without guarding. Balances are preserved because the
        same amount is booked to both sides.
        """
        if amount is None:
            return
        amt = round(float(amount), 2)
        if amt <= 0:
            return
        await conn.execute(
            """INSERT INTO ledger (account_code, debit_amount, credit_amount,
                                   description, reference_id)
               VALUES ($1, $2, 0, $3, $4)""",
            debit_account, amt, description, reference_id,
        )
        await conn.execute(
            """INSERT INTO ledger (account_code, debit_amount, credit_amount,
                                   description, reference_id)
               VALUES ($1, 0, $2, $3, $4)""",
            credit_account, amt, description, reference_id,
        )

    @staticmethod
    async def _consume_inventory_fifo(
        conn: Any, product_id: int, qty: int
    ) -> float:
        """Reduce remaining_quantity on active batches (oldest first, FIFO).

        Returns the total cost consumed (qty × WAC at time of call), which is
        what gets posted as COGS. Uses SELECT ... FOR UPDATE to serialise
        concurrent sales on the same product.

        If stock is partially (or fully) unavailable, only the portion covered
        by active batches incurs cost — the excess is a "negative-stock" sale
        with no cost basis. This keeps WAC meaningful instead of inventing
        phantom costs. The caller decides what to do about negative stock.
        """
        if qty is None or float(qty) <= 0:
            return 0.0

        batches = await conn.fetch(
            """SELECT id, remaining_quantity, unit_cost
               FROM inventory_batches
               WHERE product_id = $1 AND remaining_quantity > 0
               ORDER BY received_at ASC, id ASC
               FOR UPDATE""",
            product_id,
        )
        if not batches:
            return 0.0

        total_qty  = sum(float(b["remaining_quantity"]) for b in batches)
        total_cost = sum(
            float(b["remaining_quantity"]) * float(b["unit_cost"])
            for b in batches
        )
        if total_qty <= 0:
            return 0.0

        wac     = total_cost / total_qty
        consume = min(float(qty), total_qty)
        cost    = round(consume * wac, 2)

        remaining_to_take = consume
        for batch in batches:
            if remaining_to_take <= 0:
                break
            have = float(batch["remaining_quantity"])
            take = min(have, remaining_to_take)
            new_remaining = have - take
            await conn.execute(
                "UPDATE inventory_batches SET remaining_quantity = $1 WHERE id = $2",
                new_remaining, batch["id"],
            )
            remaining_to_take -= take

        return cost

    @staticmethod
    async def _restore_inventory_batch(
        conn: Any, product_id: int, qty: int, cost_amount: float,
        note: str,
    ) -> None:
        """Add stock back as a new batch — used when a sale is reversed.

        Creates a batch whose unit_cost equals the original COGS per unit so
        future WAC calculations stay consistent with what the sale consumed.
        Skips when there's no product or no cost basis to restore.
        """
        if product_id is None or qty is None or float(qty) <= 0:
            return
        if cost_amount is None or float(cost_amount) <= 0:
            # Nothing was costed (freeform / negative-stock sale). No-op.
            return
        unit_cost = round(float(cost_amount) / float(qty), 4)
        await conn.execute(
            """INSERT INTO inventory_batches
                   (product_id, quantity, remaining_quantity, unit_cost, notes)
               VALUES ($1, $2, $2, $3, $4)""",
            product_id, qty, unit_cost, note,
        )

    @classmethod
    async def _post_sale_ledger(
        cls,
        conn: Any,
        *,
        sale_id: int,
        payment_method: str,
        revenue: float,
        cost_amount: float,
        description: str,
        seller_type: str = "individual",
        output_vat: float = 0.0,
        buyer_type: str = "retail",
        business_account: Optional[str] = None,
    ) -> None:
        """Post revenue + COGS for one sale.

        ფ.პ (individual) sales: skip entirely — management reports only.
        LLC retail: DR 1410 1 / CR 6100 (+ COGS pair).
        LLC business cash/transfer: DR 1100/1200 / CR 6100 (+ COGS pair).
        LLC business consignment: DR 1410 N / CR 6100 (+ COGS pair).
        LLC sales with VAT: revenue split between 6100 (net) and 3330 (VAT).
        """
        if seller_type == "individual":
            return  # ფ.პ sales do not enter formal accounting

        reference = f"sale:{sale_id}"
        debit_account = cls._payment_account(payment_method, buyer_type, business_account)

        if output_vat > 0:
            net_revenue = round(revenue - output_vat, 2)
            await cls._post_ledger_pair(
                conn,
                debit_account=debit_account,
                credit_account=cls.ACCOUNT_REVENUE,
                amount=net_revenue,
                description=description,
                reference_id=reference,
            )
            await cls._post_ledger_pair(
                conn,
                debit_account=debit_account,
                credit_account=cls.ACCOUNT_VAT_PAYABLE,
                amount=output_vat,
                description=f"დღგ — {description}",
                reference_id=reference,
            )
        else:
            await cls._post_ledger_pair(
                conn,
                debit_account=debit_account,
                credit_account=cls.ACCOUNT_REVENUE,
                amount=revenue,
                description=description,
                reference_id=reference,
            )

        await cls._post_ledger_pair(
            conn,
            debit_account=cls.ACCOUNT_COGS,
            credit_account=cls.ACCOUNT_INVENTORY,
            amount=cost_amount,
            description=f"COGS — {description}",
            reference_id=reference,
        )

    @classmethod
    async def _reverse_sale_ledger(
        cls,
        conn: Any,
        *,
        sale_id: int,
        payment_method: str,
        revenue: float,
        cost_amount: float,
        description: str,
        seller_type: str = "individual",
        output_vat: float = 0.0,
        buyer_type: str = "retail",
        business_account: Optional[str] = None,
    ) -> None:
        """Reverse revenue + COGS for one sale (contra-entries, audit trail preserved).

        ფ.პ (individual) sales: skip — nothing was posted.
        """
        if seller_type == "individual":
            return  # nothing was posted originally

        reference = f"sale:{sale_id}"
        credit_account = cls._payment_account(payment_method, buyer_type, business_account)

        if output_vat > 0:
            net_revenue = round(revenue - output_vat, 2)
            await cls._post_ledger_pair(
                conn,
                debit_account=cls.ACCOUNT_REVENUE,
                credit_account=credit_account,
                amount=net_revenue,
                description=f"REVERSAL — {description}",
                reference_id=reference,
            )
            await cls._post_ledger_pair(
                conn,
                debit_account=cls.ACCOUNT_VAT_PAYABLE,
                credit_account=credit_account,
                amount=output_vat,
                description=f"REVERSAL დღგ — {description}",
                reference_id=reference,
            )
        else:
            await cls._post_ledger_pair(
                conn,
                debit_account=cls.ACCOUNT_REVENUE,
                credit_account=credit_account,
                amount=revenue,
                description=f"REVERSAL — {description}",
                reference_id=reference,
            )

        await cls._post_ledger_pair(
            conn,
            debit_account=cls.ACCOUNT_INVENTORY,
            credit_account=cls.ACCOUNT_COGS,
            amount=cost_amount,
            description=f"REVERSAL COGS — {description}",
            reference_id=reference,
        )

    @classmethod
    async def _post_settlement_ledger(
        cls,
        conn: Any,
        *,
        reference_id: str,
        payment_method: str,
        amount: float,
        description: str,
        ar_account: Optional[str] = None,
    ) -> None:
        """Post an AR settlement: DR cash/bank, CR ar_account.

        ar_account defaults to 1410 1 (LLC retail). Pass 1410 N for business customers.
        ფ.პ settlements should not call this — they have no ledger entry to settle.
        """
        if payment_method not in ("cash", "transfer"):
            return
        debit_account = cls._payment_account(payment_method)
        credit_account = ar_account or cls.ACCOUNT_RETAIL_AR
        await cls._post_ledger_pair(
            conn,
            debit_account=debit_account,
            credit_account=credit_account,
            amount=amount,
            description=description,
            reference_id=reference_id,
        )

    @classmethod
    async def _post_expense_ledger(
        cls,
        conn: Any,
        *,
        expense_id: int,
        payment_method: str,
        amount: float,
        description: str,
    ) -> None:
        """Post an operating expense: DR 7400 Operating Expense, CR cash/bank.

        For payment_method='credit' (paid on account) the credit side goes to
        AP (2100) instead of cash — cash only leaves the books once the
        supplier is paid.
        """
        if payment_method == "credit":
            credit_account = cls.ACCOUNT_ACCOUNTS_PAYABLE
        else:
            credit_account = cls._payment_account(payment_method)
        await cls._post_ledger_pair(
            conn,
            debit_account=cls.ACCOUNT_OPERATING_EXPENSE,
            credit_account=credit_account,
            amount=amount,
            description=description,
            reference_id=f"expense:{expense_id}",
        )

    @classmethod
    async def _reverse_expense_ledger(
        cls,
        conn: Any,
        *,
        expense_id: int,
        payment_method: str,
        amount: float,
        description: str,
    ) -> None:
        """Reverse an expense posting (contra-entry). Used on edit / delete."""
        if payment_method == "credit":
            debit_account = cls.ACCOUNT_ACCOUNTS_PAYABLE
        else:
            debit_account = cls._payment_account(payment_method)
        await cls._post_ledger_pair(
            conn,
            debit_account=debit_account,
            credit_account=cls.ACCOUNT_OPERATING_EXPENSE,
            amount=amount,
            description=f"REVERSAL — {description}",
            reference_id=f"expense:{expense_id}",
        )

    async def get_product_wac(self, product_id: int) -> float:
        """Return the current weighted average cost for a product.

        WAC = SUM(remaining_quantity * unit_cost) / SUM(remaining_quantity)
        across all active (remaining_quantity > 0) batches. Returns 0.0 when
        there are no active batches.
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT SUM(remaining_quantity * unit_cost) AS total_cost,
                          SUM(remaining_quantity)             AS total_qty
                   FROM inventory_batches
                   WHERE product_id = $1 AND remaining_quantity > 0""",
                product_id,
            )
        if not row or not row["total_qty"] or float(row["total_qty"]) == 0.0:
            return 0.0
        return float(row["total_cost"]) / float(row["total_qty"])

    async def receive_inventory_batch(
        self,
        name: str,
        oem_code: Optional[str],
        quantity: float,
        unit_cost: float,
        min_stock: int,
        supplier: Optional[str] = None,
        reference: Optional[str] = None,
        notes: Optional[str] = None,
        received_at: Optional[datetime] = None,
        unit: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Post one inventory receipt (one Excel row).

        Runs atomically in a single transaction:
          1. Upsert the product (by OEM, else by name, else insert).
             - On insert: unit_price defaults to unit_cost so the sales flow has
               a sensible starting price. On update: unit_price is left alone so
               we never silently change the selling price from a receipt file.
          2. Increment products.current_stock by quantity (stock goes up because
             this is a receipt, not a replacement).
          3. Insert one row into inventory_batches (quantity, remaining_quantity,
             unit_cost). WAC is derived from this table on demand.
          4. Insert two ledger rows for the same transaction_date and reference:
               DR 1300 Inventory            = quantity * unit_cost
               CR 2100 Accounts payable     = quantity * unit_cost

        Returns a dict with keys: product_id, batch_id, new_stock, new_wac,
        total_cost, was_created (True if the product row was newly inserted).
        """
        if quantity <= 0:
            raise ValueError("quantity must be > 0")
        if unit_cost < 0:
            raise ValueError("unit_cost must be >= 0")

        total_cost = round(float(quantity) * float(unit_cost), 2)
        clean_oem = oem_code.strip().upper() if oem_code else None

        if not clean_oem:
            raise ValueError("oem_code სავალდებულოა — იდენტიფიკაცია მხოლოდ OEM-ით ხდება")

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                was_created = False
                product_id: Optional[int] = None

                existing = await conn.fetchrow(
                    "SELECT id FROM products WHERE oem_code = $1",
                    clean_oem,
                )
                clean_unit = unit.strip() if unit else 'ცალი'

                if existing:
                    product_id = existing["id"]
                    await conn.execute(
                        "UPDATE products SET name = $1, unit_price = $2, unit = $3 WHERE id = $4",
                        name, unit_cost, clean_unit, product_id,
                    )
                else:
                    if received_at is not None:
                        row = await conn.fetchrow(
                            """INSERT INTO products
                                   (name, oem_code, current_stock, min_stock, unit_price, unit, created_at)
                               VALUES ($1, $2, 0, $3, $4, $5, $6)
                               RETURNING id""",
                            name, clean_oem, min_stock, unit_cost, clean_unit, received_at,
                        )
                    else:
                        row = await conn.fetchrow(
                            """INSERT INTO products
                                   (name, oem_code, current_stock, min_stock, unit_price, unit)
                               VALUES ($1, $2, 0, $3, $4, $5)
                               RETURNING id""",
                            name, clean_oem, min_stock, unit_cost, clean_unit,
                        )
                    product_id = row["id"]
                    was_created = True

                stock_row = await conn.fetchrow(
                    """UPDATE products
                       SET current_stock = current_stock + $1
                       WHERE id = $2
                       RETURNING current_stock""",
                    int(quantity), product_id,
                )
                new_stock = int(stock_row["current_stock"]) if stock_row else 0

                if received_at is not None:
                    batch_row = await conn.fetchrow(
                        """INSERT INTO inventory_batches
                               (product_id, quantity, remaining_quantity,
                                unit_cost, received_at, supplier, reference, notes)
                           VALUES ($1, $2, $2, $3, $4, $5, $6, $7)
                           RETURNING id""",
                        product_id, quantity, unit_cost, received_at,
                        supplier, reference, notes,
                    )
                else:
                    batch_row = await conn.fetchrow(
                        """INSERT INTO inventory_batches
                               (product_id, quantity, remaining_quantity,
                                unit_cost, supplier, reference, notes)
                           VALUES ($1, $2, $2, $3, $4, $5, $6)
                           RETURNING id""",
                        product_id, quantity, unit_cost,
                        supplier, reference, notes,
                    )
                batch_id = batch_row["id"]

                # Double-entry ledger posting: inventory ↑ (debit), AP ↑ (credit).
                ledger_ref = reference or f"batch:{batch_id}"
                ledger_desc = (
                    f"Inventory receipt — {name}"
                    + (f" (OEM {clean_oem})" if clean_oem else "")
                )
                ledger_date = received_at or datetime.utcnow()
                await conn.execute(
                    """INSERT INTO ledger
                           (transaction_date, account_code, debit_amount, credit_amount,
                            description, reference_id)
                       VALUES ($1, $2, $3, 0, $4, $5)""",
                    ledger_date, self.ACCOUNT_INVENTORY, total_cost, ledger_desc, ledger_ref,
                )
                await conn.execute(
                    """INSERT INTO ledger
                           (transaction_date, account_code, debit_amount, credit_amount,
                            description, reference_id)
                       VALUES ($1, $2, 0, $3, $4, $5)""",
                    ledger_date, self.ACCOUNT_ACCOUNTS_PAYABLE, total_cost, ledger_desc, ledger_ref,
                )

                # WAC is computed inside the same transaction so the caller sees
                # the value that reflects this batch.
                wac_row = await conn.fetchrow(
                    """SELECT SUM(remaining_quantity * unit_cost) AS total_cost,
                              SUM(remaining_quantity)             AS total_qty
                       FROM inventory_batches
                       WHERE product_id = $1 AND remaining_quantity > 0""",
                    product_id,
                )
                if wac_row and wac_row["total_qty"] and float(wac_row["total_qty"]) > 0:
                    new_wac = float(wac_row["total_cost"]) / float(wac_row["total_qty"])
                else:
                    new_wac = 0.0

        result = {
            "product_id": product_id,
            "batch_id": batch_id,
            "new_stock": new_stock,
            "new_wac": new_wac,
            "total_cost": total_cost,
            "was_created": was_created,
        }
        self._audit("inventory_received", result, reference_id=f"inventory:{batch_id}")
        return result

    # ─── Sales (atomic: record sale + update stock in one transaction) ─────────

    async def create_sale(
        self,
        product_id: Optional[int],
        quantity: int,
        unit_price: float,
        payment_method: str,
        seller_type: str = "individual",
        buyer_type: str = "retail",
        customer_name: Optional[str] = None,
        notes: Optional[str] = None,
        vat_amount: float = 0.0,
        is_vat_included: bool = False,
        client_name: Optional[str] = None,
        payment_status: str = "paid",
    ) -> Tuple[int, int]:
        """Insert sale + decrement stock + post double-entry ledger, atomically.

        ფ.პ (seller_type='individual') sales: saved to DB for management reports
        but NO ledger entries are posted.

        LLC sales enter formal accounting:
          - retail cash/transfer: DR 1100/1200, CR 6100
          - retail credit (ნისია): DR 1410 1, CR 6100
          - business cash/transfer: DR 1100/1200, CR 6100
          - business consignment (credit): DR 1410 N, CR 6100
          + COGS pair: DR 7100, CR 1610

        Returns (sale_id, new_stock_level).
        """
        # Credit (ნისია) sales are always unpaid — force 'debt' regardless of caller default
        if payment_method == "credit":
            payment_status = "debt"

        revenue = round(float(unit_price) * int(quantity), 2)
        output_vat = round(revenue - revenue / 1.18, 2) if seller_type == "llc" else 0.0
        business_account: Optional[str] = None

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Resolve business customer account before INSERT (inside transaction)
                if (seller_type == "llc" and buyer_type == "business"
                        and payment_method == "credit"):
                    name = client_name or customer_name
                    if name:
                        business_account = await self._get_or_create_business_customer(
                            conn, name
                        )

                row = await conn.fetchrow(
                    """INSERT INTO sales
                           (product_id, quantity, unit_price, payment_method,
                            seller_type, buyer_type, customer_name, notes,
                            vat_amount, is_vat_included, output_vat,
                            client_name, payment_status)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                       RETURNING id""",
                    product_id, quantity, unit_price, payment_method,
                    seller_type, buyer_type, customer_name or None, notes,
                    round(vat_amount, 2), is_vat_included, output_vat,
                    client_name or None, payment_status,
                )
                sale_id = row["id"]

                cost_amount = 0.0
                new_stock = 0
                if product_id is not None:
                    stock_row = await conn.fetchrow(
                        """UPDATE products
                           SET current_stock = current_stock - $1
                           WHERE id = $2
                           RETURNING current_stock""",
                        quantity, product_id,
                    )
                    new_stock = stock_row["current_stock"] if stock_row else 0
                    cost_amount = await self._consume_inventory_fifo(
                        conn, product_id, quantity,
                    )
                    if cost_amount > 0:
                        await conn.execute(
                            "UPDATE sales SET cost_amount = $1, cogs = $1 WHERE id = $2",
                            cost_amount, sale_id,
                        )

                label = client_name or customer_name
                description = (
                    f"Sale #{sale_id} — {label}"
                    if label else f"Sale #{sale_id}"
                )
                await self._post_sale_ledger(
                    conn,
                    sale_id=sale_id,
                    payment_method=payment_method,
                    revenue=revenue,
                    cost_amount=cost_amount,
                    description=description,
                    seller_type=seller_type,
                    output_vat=output_vat,
                    buyer_type=buyer_type,
                    business_account=business_account,
                )

                if seller_type == "llc" and output_vat > 0:
                    await conn.execute(
                        """INSERT INTO vat_ledger (transaction_type, amount, reference_id)
                           VALUES ('sales_vat', $1, $2)""",
                        -output_vat, f"sale:{sale_id}",
                    )

        self._audit("sale_created", {
            "sale_id": sale_id,
            "product_id": product_id,
            "quantity": quantity,
            "unit_price": unit_price,
            "revenue": revenue,
            "cost_amount": cost_amount,
            "payment_method": payment_method,
            "payment_status": payment_status,
            "seller_type": seller_type,
            "buyer_type": buyer_type,
            "customer_name": customer_name,
            "client_name": client_name,
            "notes": notes,
            "new_stock": new_stock,
            "vat_amount": round(vat_amount, 2),
            "is_vat_included": is_vat_included,
            "output_vat": output_vat,
        }, reference_id=f"sale:{sale_id}")
        return sale_id, new_stock

    async def delete_sale(self, sale_id: int) -> Optional[SaleRow]:
        """Delete a sale, restore stock + inventory batch, reverse the ledger.

        All in one transaction:
          1. SELECT the sale (FOR UPDATE).
          2. If linked to a product: +quantity to stock, plus insert a new
             inventory batch carrying the original unit cost so future WAC
             stays consistent with what the sale consumed.
          3. Reverse the sale's revenue + COGS ledger entries.
          4. DELETE the sales row.
        Returns the deleted sale record, or None if not found.
        """
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                sale = await conn.fetchrow(
                    "SELECT * FROM sales WHERE id = $1 FOR UPDATE", sale_id,
                )
                if not sale:
                    return None
                sale_dict = dict(sale)

                qty = int(sale_dict["quantity"])
                unit_price = float(sale_dict["unit_price"])
                cost_amount = float(sale_dict.get("cost_amount") or 0.0)
                revenue = round(unit_price * qty, 2)
                pm = sale_dict["payment_method"]
                product_id = sale_dict.get("product_id")
                label = sale_dict.get("customer_name") or f"Sale #{sale_id}"

                if product_id:
                    await conn.execute(
                        """UPDATE products
                           SET current_stock = current_stock + $1
                           WHERE id = $2""",
                        qty, product_id,
                    )
                    await self._restore_inventory_batch(
                        conn, product_id, qty, cost_amount,
                        note=f"Reversal of sale #{sale_id}",
                    )

                seller_type = sale_dict.get("seller_type", "individual")
                buyer_type = sale_dict.get("buyer_type", "retail")
                output_vat = float(sale_dict.get("output_vat") or 0.0)

                business_account: Optional[str] = None
                if seller_type == "llc" and buyer_type == "business" and pm == "credit":
                    business_account = await self._get_ar_account_for_sale(conn, sale_dict)

                await self._reverse_sale_ledger(
                    conn,
                    sale_id=sale_id,
                    payment_method=pm,
                    revenue=revenue,
                    cost_amount=cost_amount,
                    description=f"Sale #{sale_id} — {label}",
                    seller_type=seller_type,
                    output_vat=output_vat,
                    buyer_type=buyer_type,
                    business_account=business_account,
                )

                # Reverse the VAT ledger entry: only for LLC sales
                if seller_type == "llc" and output_vat > 0:
                    await conn.execute(
                        """INSERT INTO vat_ledger (transaction_type, amount, reference_id)
                           VALUES ('sales_vat', $1, $2)""",
                        output_vat, f"reversal:sale:{sale_id}",
                    )

                await conn.execute("DELETE FROM sales WHERE id = $1", sale_id)

        self._audit("sale_deleted", sale_dict, reference_id=f"reversal:sale:{sale_id}")
        return sale_dict  # type: ignore[return-value]

    async def mark_sale_paid(self, sale_id: int, payment_method: str) -> bool:
        """Mark a credit (ნისია) sale as paid + post AR settlement to ledger.

        Ledger posting (atomic with the UPDATE):
            DR cash/bank   = remaining sale_total
            CR 1400 AR     = remaining sale_total
        The original "sale:{id}" revenue entries stay intact; this settlement
        lives under reference "payment:{sale_id}" so reports can distinguish
        revenue booking from cash collection. Returns True if updated.
        """
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                sale = await conn.fetchrow(
                    """SELECT id, unit_price, quantity, customer_name, client_name,
                              seller_type, buyer_type
                       FROM sales
                       WHERE id = $1 AND payment_method = 'credit'
                       FOR UPDATE""",
                    sale_id,
                )
                if not sale:
                    return False
                sale_dict = dict(sale)
                amount = round(float(sale["unit_price"]) * int(sale["quantity"]), 2)
                await conn.execute(
                    "UPDATE sales SET payment_method = $1, payment_status = 'paid' WHERE id = $2",
                    payment_method, sale_id,
                )
                if sale_dict.get("seller_type") == "llc":
                    label = sale["client_name"] or sale["customer_name"] or f"Sale #{sale_id}"
                    ar_account = await self._get_ar_account_for_sale(conn, sale_dict)
                    await self._post_settlement_ledger(
                        conn,
                        reference_id=f"payment:{sale_id}",
                        payment_method=payment_method,
                        amount=amount,
                        description=f"Nisia payment #{sale_id} — {label}",
                        ar_account=ar_account,
                    )
        self._audit("nisia_paid", {
            "sale_id": sale_id,
            "payment_method": payment_method,
            "amount": amount,
            "customer_name": sale["customer_name"],
        }, reference_id=f"payment:{sale_id}")
        return True

    async def mark_customer_sales_paid(self, customer_name: str, payment_method: str) -> int:
        """Mark all credit sales for a customer as paid + post AR settlement for LLC sales.

        ფ.პ sales: payment_method updated, no ledger entry.
        LLC sales: payment_method updated + settlement entry (DR cash/bank, CR 1410 x).
        Returns total number of sales updated.
        """
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                rows = await conn.fetch(
                    """SELECT id, unit_price, quantity, seller_type, buyer_type,
                              client_name, customer_name
                       FROM sales
                       WHERE payment_method = 'credit'
                         AND (customer_name = $1 OR client_name = $1)
                       FOR UPDATE""",
                    customer_name,
                )
                if not rows:
                    return 0

                llc_total = 0.0
                llc_ar_account: Optional[str] = None

                for r in rows:
                    row_total = float(r["unit_price"]) * int(r["quantity"])
                    if r["seller_type"] == "llc":
                        llc_total += row_total
                        if llc_ar_account is None:
                            llc_ar_account = await self._get_ar_account_for_sale(conn, dict(r))

                result = await conn.execute(
                    """UPDATE sales
                       SET payment_method = $1, payment_status = 'paid'
                       WHERE payment_method = 'credit'
                         AND (customer_name = $2 OR client_name = $2)""",
                    payment_method, customer_name,
                )
                if llc_total > 0 and llc_ar_account:
                    stamp = self._now().strftime("%Y%m%d%H%M%S")
                    await self._post_settlement_ledger(
                        conn,
                        reference_id=f"payment:customer:{customer_name}:{stamp}",
                        payment_method=payment_method,
                        amount=round(llc_total, 2),
                        description=f"Nisia bulk payoff — {customer_name}",
                        ar_account=llc_ar_account,
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
        the remaining balance. One settlement ledger entry is posted for the
        full applied amount (DR cash, CR 1400 AR).
        Returns the remaining debt for this customer after the payment.
        """
        if amount <= 0:
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow(
                    """SELECT COALESCE(SUM(unit_price * quantity), 0) AS total
                       FROM sales
                       WHERE payment_method = 'credit'
                         AND (customer_name = $1 OR client_name = $1)""",
                    customer_name,
                )
                return float(row["total"]) if row else 0.0

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                rows = await conn.fetch(
                    """SELECT id, unit_price, quantity, seller_type, buyer_type,
                              client_name, customer_name
                       FROM sales
                       WHERE payment_method = 'credit'
                         AND (customer_name = $1 OR client_name = $1)
                       ORDER BY sold_at ASC
                       FOR UPDATE""",
                    customer_name,
                )
                remaining_payment = amount
                applied = 0.0
                applied_llc = 0.0
                llc_ar_account: Optional[str] = None

                for row in rows:
                    if remaining_payment <= 0:
                        break
                    sale_total = float(row["unit_price"]) * row["quantity"]
                    is_llc = row["seller_type"] == "llc"
                    if remaining_payment >= sale_total:
                        await conn.execute(
                            "UPDATE sales SET payment_method = 'cash', payment_status = 'paid' WHERE id = $1",
                            row["id"],
                        )
                        remaining_payment -= sale_total
                        applied += sale_total
                        if is_llc:
                            applied_llc += sale_total
                            if llc_ar_account is None:
                                llc_ar_account = await self._get_ar_account_for_sale(conn, dict(row))
                    else:
                        new_total = sale_total - remaining_payment
                        new_price = new_total / row["quantity"]
                        await conn.execute(
                            "UPDATE sales SET unit_price = $1 WHERE id = $2",
                            new_price, row["id"],
                        )
                        if is_llc:
                            applied_llc += remaining_payment
                            if llc_ar_account is None:
                                llc_ar_account = await self._get_ar_account_for_sale(conn, dict(row))
                        applied += remaining_payment
                        remaining_payment = 0.0
                        break

                if applied_llc > 0 and llc_ar_account:
                    stamp = self._now().strftime("%Y%m%d%H%M%S")
                    await self._post_settlement_ledger(
                        conn,
                        reference_id=f"payment:customer:{customer_name}:{stamp}",
                        payment_method="cash",
                        amount=round(applied_llc, 2),
                        description=f"Nisia partial payment — {customer_name}",
                        ar_account=llc_ar_account,
                    )

                total_row = await conn.fetchrow(
                    """SELECT COALESCE(SUM(unit_price * quantity), 0.0) AS remaining
                       FROM sales
                       WHERE payment_method = 'credit'
                         AND (customer_name = $1 OR client_name = $1)""",
                    customer_name,
                )
                return float(total_row["remaining"]) if total_row else 0.0

    async def get_weekly_sales(self) -> List[SaleRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT s.*, p.name AS product_name, p.oem_code
                   FROM sales s
                   LEFT JOIN products p ON s.product_id = p.id
                   WHERE s.sold_at >= $1 AND s.status != 'returned'
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
                   WHERE s.payment_method = 'credit' AND s.status != 'returned'
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
        refund_method: str = "cash",
    ) -> Tuple[int, int]:
        """Record a return: restore stock + inventory batch + contra-revenue.

        One transaction performs:
          1. INSERT the return row with refund_method.
          2. Increment product stock by quantity.
          3. If linked to a sale: mark it status='returned' so all financial
             queries exclude it automatically.
          4. If linked to a sale: restore the proportional inventory batch at
             the original cost per unit (qty/sale_qty * cost_amount). Reverse
             the COGS side for that portion so COGS doesn't double-count.
          5. Post a contra-revenue pair for the refund:
                DR 6100 Revenue   = refund_amount   (reversing some revenue)
                CR 1100 Cash / 1400 AR (depending on the sale's payment_method)
        Returns (return_id, new_stock_level).
        """
        qty = int(quantity)
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """INSERT INTO returns
                           (sale_id, product_id, quantity, refund_amount,
                            refund_method, exchange_product_id, notes)
                       VALUES ($1, $2, $3, $4, $5, $6, $7)
                       RETURNING id""",
                    sale_id, product_id, qty, refund_amount,
                    refund_method, exchange_product_id, notes,
                )
                return_id = row["id"]

                stock_row = await conn.fetchrow(
                    """UPDATE products
                       SET current_stock = current_stock + $1
                       WHERE id = $2
                       RETURNING current_stock""",
                    qty, product_id,
                )
                new_stock = stock_row["current_stock"] if stock_row else 0

                # If we know the original sale, use its COGS + payment method to
                # build an accurate, balanced reversal.
                cogs_portion = 0.0
                pm = refund_method if refund_method in ("cash", "transfer") else "cash"
                if sale_id is not None:
                    sale = await conn.fetchrow(
                        """SELECT quantity, cost_amount, payment_method
                           FROM sales WHERE id = $1""",
                        sale_id,
                    )
                    if sale:
                        sale_qty = max(int(sale["quantity"]), 1)
                        sale_cost = float(sale["cost_amount"] or 0.0)
                        portion = min(qty, sale_qty) / sale_qty
                        cogs_portion = round(sale_cost * portion, 2)
                        pm = sale["payment_method"]
                        # Mark the original sale as returned so it is excluded
                        # from all financial calculations going forward.
                        await conn.execute(
                            "UPDATE sales SET status = 'returned' WHERE id = $1",
                            sale_id,
                        )

                await self._restore_inventory_batch(
                    conn, product_id, qty, cogs_portion,
                    note=f"Return #{return_id}" + (f" (sale #{sale_id})" if sale_id else ""),
                )

                reference = f"return:{return_id}"
                refund = round(float(refund_amount), 2)
                credit_account = self._payment_account(pm)
                # Contra-revenue: DR Revenue, CR cash/AR for the refund value
                await self._post_ledger_pair(
                    conn,
                    debit_account=self.ACCOUNT_REVENUE,
                    credit_account=credit_account,
                    amount=refund,
                    description=f"Return #{return_id} — refund",
                    reference_id=reference,
                )
                # Reverse COGS portion: DR Inventory, CR COGS
                await self._post_ledger_pair(
                    conn,
                    debit_account=self.ACCOUNT_INVENTORY,
                    credit_account=self.ACCOUNT_COGS,
                    amount=cogs_portion,
                    description=f"Return #{return_id} — COGS reversal",
                    reference_id=reference,
                )

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

    # ─── Clients ──────────────────────────────────────────────────────────────

    async def upsert_client(
        self,
        telegram_id: int,
        full_name: Optional[str] = None,
        username: Optional[str] = None,
    ) -> None:
        """Ensure a row exists in clients for this Telegram user.

        Called before any order INSERT that carries a client_id so the FK
        constraint (orders.client_id → clients.id) is never violated.
        ON CONFLICT DO UPDATE refreshes the display name if it changed.
        """
        async with self.pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO clients (id, full_name, username)
                   VALUES ($1, $2, $3)
                   ON CONFLICT (id) DO UPDATE
                     SET full_name = COALESCE(EXCLUDED.full_name, clients.full_name),
                         username  = COALESCE(EXCLUDED.username,  clients.username)""",
                telegram_id, full_name or None, username or None,
            )

    # ─── Orders ───────────────────────────────────────────────────────────────

    async def create_order(
        self,
        product_id: Optional[int],
        quantity_needed: int,
        priority: str = "low",
        notes: Optional[str] = None,
        oem_code: Optional[str] = None,
        part_name: str = "",
    ) -> int:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO orders
                       (product_id, quantity_needed, priority, notes, oem_code, part_name)
                   VALUES ($1, $2, $3, $4, $5, $6)
                   RETURNING id""",
                product_id, quantity_needed, priority, notes, oem_code, part_name,
            )
            order_id: int = row["id"]
        self._audit("order_created", {
            "order_id": order_id,
            "product_id": product_id,
            "quantity_needed": quantity_needed,
            "priority": priority,
            "notes": notes,
            "oem_code": oem_code,
            "part_name": part_name,
        }, reference_id=f"order:{order_id}")
        return order_id

    async def has_active_order_for_product(self, product_id: int) -> bool:
        """Return True if an open (non-completed) order already exists for this product.

        Prevents duplicate auto-reorder entries when stock keeps falling.
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT EXISTS(
                     SELECT 1 FROM orders
                     WHERE product_id = $1
                       AND status NOT IN ('fulfilled', 'delivered', 'cancelled', 'completed')
                   ) AS exists""",
                product_id,
            )
            return bool(row["exists"]) if row else False

    async def create_orders_bulk(
        self,
        items: List[Dict[str, Any]],
    ) -> List[int]:
        """Insert several orders atomically.

        Each entry must contain: ``product_id`` (Optional[int]),
        ``quantity_needed`` (int > 0), ``priority`` (str), ``notes``
        (Optional[str]), ``oem_code`` (Optional[str]), ``part_name`` (str).
        Returns the inserted IDs in the same order.
        Wrapped in a single transaction — a partial failure rolls back
        the whole batch.
        """
        if not items:
            return []

        logger.info(
            "create_orders_bulk: inserting %d order(s) | "
            "qty_needed=%s | priorities=%s | oem_codes=%s",
            len(items),
            [item.get("quantity_needed") for item in items],
            [item.get("priority") for item in items],
            [item.get("oem_code") for item in items],
        )

        # Ensure every distinct client_id exists in the clients table before the
        # bulk INSERT so the FK constraint is never violated.
        distinct_client_ids: set = {
            item["client_id"] for item in items
            if item.get("client_id") is not None
        }
        for cid in distinct_client_ids:
            await self.upsert_client(int(cid))

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                ids: List[int] = []
                for idx, item in enumerate(items):
                    product_id: Optional[int] = item.get("product_id")
                    if product_id is not None:
                        product_id = int(product_id)

                    raw_qty = item.get("quantity_needed")
                    if raw_qty is None:
                        logger.error(
                            "create_orders_bulk: row %d — quantity_needed key missing! "
                            "item keys=%s item=%r",
                            idx, list(item.keys()), item,
                        )
                        raise ValueError(
                            f"Row {idx}: quantity_needed is missing — item keys: {list(item.keys())}"
                        )
                    quantity_needed = int(raw_qty)
                    priority: str = str(item.get("priority") or "low")
                    notes: Optional[str] = item.get("notes")
                    oem_code: Optional[str] = item.get("oem_code")
                    client_id: Optional[int] = item.get("client_id")
                    part_name: str = str(item.get("part_name") or "")

                    logger.info(
                        "create_orders_bulk: row %d — product_id=%r(%s) "
                        "quantity_needed=%d priority=%r oem_code=%r client_id=%r part_name=%r",
                        idx,
                        product_id, type(product_id).__name__,
                        quantity_needed, priority, oem_code, client_id, part_name,
                    )

                    try:
                        row = await conn.fetchrow(
                            """INSERT INTO orders
                                   (product_id, quantity_needed, priority, notes,
                                    oem_code, client_id, part_name)
                               VALUES ($1, $2, $3, $4, $5, $6, $7)
                               RETURNING id""",
                            product_id,
                            quantity_needed,
                            priority,
                            notes,
                            oem_code,
                            client_id,
                            part_name,
                        )
                    except Exception as exc:
                        logger.error(
                            "create_orders_bulk: INSERT failed at row %d | "
                            "product_id=%r(%s) quantity_needed=%d priority=%r "
                            "oem_code=%r client_id=%r part_name=%r | "
                            "error_type=%s | error=%s",
                            idx,
                            product_id, type(product_id).__name__,
                            quantity_needed, priority, oem_code, client_id, part_name,
                            type(exc).__name__, exc,
                            exc_info=True,
                        )
                        raise
                    ids.append(row["id"])

        logger.info("create_orders_bulk: success — inserted IDs: %s", ids)
        self._audit("orders_bulk_created", {
            "order_ids": ids,
            "items": items,
            "count": len(ids),
        }, reference_id=f"bulk_order:{ids[0]}..{ids[-1]}" if ids else None)
        return ids

    async def get_pending_orders(self) -> List[OrderRow]:
        """Return pending orders sorted by priority (urgent first), then date."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT o.*, p.name AS product_name,
                          COALESCE(o.oem_code, p.oem_code) AS oem_code
                   FROM orders o
                   LEFT JOIN products p ON o.product_id = p.id
                   WHERE o.status = 'pending'
                   ORDER BY
                     CASE o.priority
                       WHEN 'urgent' THEN 1
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

    async def revert_order_to_pending(self, order_id: int) -> bool:
        """Revert a completed order back to pending. Returns True if successful."""
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE orders SET status = 'pending' WHERE id = $1 AND status = 'completed'",
                order_id,
            )
            return result == "UPDATE 1"

    async def update_orders_topic_message(
        self,
        order_ids: List[int],
        topic_id: int,
        topic_message_id: int,
    ) -> None:
        """Attach the same group-topic message to a batch of orders.

        Used by /addorder: after the grouped summary is posted to
        ORDERS_TOPIC_ID, every order in that batch stores the posted
        message_id so the '✅ შესრულდა' callback can look them up and
        mark the whole batch completed in one shot.
        """
        if not order_ids:
            return
        async with self.pool.acquire() as conn:
            await conn.execute(
                """UPDATE orders
                   SET topic_id = $1, topic_message_id = $2
                   WHERE id = ANY($3::int[])""",
                topic_id, topic_message_id, list(order_ids),
            )

    async def complete_orders_by_topic_message(
        self,
        topic_id: int,
        topic_message_id: int,
    ) -> List[OrderRow]:
        """Mark every pending order tied to this topic message as completed.

        Returns the full OrderRow list (with joined product_name / oem_code)
        of the orders that were actually transitioned from pending→completed.
        Orders already in a non-pending state are left untouched and are
        NOT included in the returned list.
        """
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                rows = await conn.fetch(
                    """UPDATE orders o
                       SET status = 'completed'
                       WHERE o.topic_id = $1
                         AND o.topic_message_id = $2
                         AND o.status = 'pending'
                       RETURNING o.id""",
                    topic_id, topic_message_id,
                )
                if not rows:
                    return []
                completed_ids = [r["id"] for r in rows]
                full = await conn.fetch(
                    """SELECT o.*, p.name AS product_name, p.oem_code
                       FROM orders o
                       LEFT JOIN products p ON o.product_id = p.id
                       WHERE o.id = ANY($1::int[])
                       ORDER BY
                         CASE o.priority
                           WHEN 'urgent' THEN 1
                           ELSE 2
                         END,
                         o.id""",
                    completed_ids,
                )
                return self._rows(full)  # type: ignore[return-value]

    async def get_orders_by_topic_message(
        self,
        topic_id: int,
        topic_message_id: int,
    ) -> List[OrderRow]:
        """Return all orders linked to a specific topic message (any status)."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT o.*, p.name AS product_name, p.oem_code
                   FROM orders o
                   LEFT JOIN products p ON o.product_id = p.id
                   WHERE o.topic_id = $1 AND o.topic_message_id = $2
                   ORDER BY
                     CASE o.priority
                       WHEN 'urgent' THEN 1
                       ELSE 2
                     END,
                     o.id""",
                topic_id, topic_message_id,
            )
            return self._rows(rows)  # type: ignore[return-value]

    async def delete_orders_by_topic_message(
        self,
        topic_id: int,
        topic_message_id: int,
    ) -> int:
        """Delete all orders linked to a topic message. Returns deleted count."""
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                """DELETE FROM orders
                   WHERE topic_id = $1 AND topic_message_id = $2""",
                topic_id, topic_message_id,
            )
        count = int((result or "DELETE 0").split()[-1])
        self._audit("orders_deleted_by_topic_message", {
            "topic_id": topic_id,
            "topic_message_id": topic_message_id,
            "deleted_count": count,
        })
        return count

    async def update_order_quantity(
        self,
        order_id: int,
        new_quantity: int,
    ) -> bool:
        """Update quantity_needed for a pending order. Returns True if updated."""
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                """UPDATE orders SET quantity_needed = $1
                   WHERE id = $2 AND status = 'pending'""",
                new_quantity, order_id,
            )
        updated = result == "UPDATE 1"
        if updated:
            self._audit("order_quantity_updated", {
                "order_id": order_id,
                "new_quantity": new_quantity,
            }, reference_id=f"order:{order_id}")
        return updated

    _VALID_ORDER_STATUSES = frozenset(
        {"new", "processing", "ordered", "ready", "delivered", "cancelled"}
    )

    async def update_order_status(self, order_id: int, status: str) -> bool:
        """Update the status of a single order. Returns True if the row was found."""
        if status not in self._VALID_ORDER_STATUSES:
            raise ValueError(f"Invalid order status: {status!r}")
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE orders SET status = $1 WHERE id = $2",
                status, order_id,
            )
        updated = result == "UPDATE 1"
        if updated:
            self._audit("order_status_updated", {
                "order_id": order_id,
                "status": status,
            }, reference_id=f"order:{order_id}")
        return updated

    async def get_order_by_id(self, order_id: int) -> Optional[Dict[str, Any]]:
        """Return a single order row (with joined product_name) or None."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT o.*, p.name AS product_name
                   FROM orders o
                   LEFT JOIN products p ON p.id = o.product_id
                   WHERE o.id = $1""",
                order_id,
            )
        return self._row(row)

    # ─── Expenses ─────────────────────────────────────────────────────────────

    async def create_expense(
        self,
        amount: float,
        description: Optional[str] = None,
        category: Optional[str] = None,
        payment_method: str = "cash",
        vat_amount: float = 0.0,
        is_vat_included: bool = False,
        is_paid: bool = True,
        is_non_cash: bool = False,
    ) -> int:
        """Insert an expense + post its ledger entry atomically.

        Ledger posting (one transaction):
            DR 7400 Operating expense      = amount
            CR 1100 Cash   (payment_method='cash')
            CR 1200 Bank   (payment_method='transfer')
            CR 2100 AP     (payment_method='credit' — unpaid supplier bill)

        For inventory write-offs (is_non_cash=True) callers should use
        create_inventory_shortage_expense() instead, which posts to 7500/1600.
        """
        amt = round(float(amount), 2)
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """INSERT INTO expenses
                           (amount, description, category, payment_method,
                            vat_amount, is_vat_included, is_paid, is_non_cash)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id""",
                    amount, description, category, payment_method,
                    round(vat_amount, 2), is_vat_included, is_paid, is_non_cash,
                )
                expense_id = row["id"]
                label = description or category or f"Expense #{expense_id}"
                await self._post_expense_ledger(
                    conn,
                    expense_id=expense_id,
                    payment_method=payment_method,
                    amount=amt,
                    description=f"Expense #{expense_id} — {label}",
                )
        self._audit("expense_created", {
            "expense_id": expense_id,
            "amount": amt,
            "description": description,
            "category": category,
            "payment_method": payment_method,
            "vat_amount": round(vat_amount, 2),
            "is_vat_included": is_vat_included,
            "is_paid": is_paid,
            "is_non_cash": is_non_cash,
        }, reference_id=f"expense:{expense_id}")
        return expense_id

    async def create_inventory_shortage_expense(
        self,
        oem_code: str,
        name: str,
        shortage_qty: float,
        unit_cost: float,
    ) -> Dict[str, Any]:
        """Record an inventory shortage detected during a stock count.

        Runs atomically in one transaction:
          1. Reduce inventory_batches.remaining_quantity FIFO by shortage_qty.
          2. Set products.current_stock -= shortage_qty.
          3. Insert expense row: is_non_cash=True, is_paid=True, payment_method='credit'.
             amount = shortage_qty * unit_cost.
          4. Post ledger pair:
               DR 7500 Inventory Write-off = loss_value
               CR 1600 Inventory           = loss_value
             No cash/bank account is touched — this is a pure P&L write-off.

        Returns: {expense_id, product_id, shortage_qty, unit_cost, loss_value, new_stock}
        """
        if shortage_qty <= 0:
            raise ValueError("shortage_qty must be > 0")
        loss_value = round(float(shortage_qty) * float(unit_cost), 2)
        ref = f"stockcount:shortage:{oem_code}"

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                product_row = await conn.fetchrow(
                    "SELECT id, current_stock FROM products WHERE oem_code = $1",
                    oem_code,
                )
                if not product_row:
                    raise ValueError(f"პროდუქტი OEM '{oem_code}' ვერ მოიძებნა")
                product_id: int = product_row["id"]

                # FIFO consume from inventory batches
                remaining_to_remove = float(shortage_qty)
                if loss_value > 0:
                    batches = await conn.fetch(
                        """SELECT id, remaining_quantity FROM inventory_batches
                           WHERE product_id = $1 AND remaining_quantity > 0
                           ORDER BY received_at ASC, id ASC""",
                        product_id,
                    )
                    for batch in batches:
                        if remaining_to_remove <= 0:
                            break
                        can_take = min(float(batch["remaining_quantity"]), remaining_to_remove)
                        await conn.execute(
                            """UPDATE inventory_batches
                               SET remaining_quantity = remaining_quantity - $1
                               WHERE id = $2""",
                            can_take, batch["id"],
                        )
                        remaining_to_remove -= can_take

                # Update current_stock
                stock_row = await conn.fetchrow(
                    """UPDATE products
                       SET current_stock = current_stock - $1
                       WHERE id = $2 RETURNING current_stock""",
                    int(shortage_qty), product_id,
                )
                new_stock = int(stock_row["current_stock"]) if stock_row else 0

                # Insert expense (non-cash write-off)
                desc = f"Inventory Shortage: {oem_code} - {name}"
                expense_row = await conn.fetchrow(
                    """INSERT INTO expenses
                           (amount, description, category, payment_method,
                            is_paid, is_non_cash)
                       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id""",
                    loss_value if loss_value > 0 else 0.01,
                    desc,
                    "საწყობის ნაკლი",
                    "credit",
                    True,
                    True,
                )
                expense_id: int = expense_row["id"]

                # Ledger: DR 7500 Write-off / CR 1600 Inventory (only when there is a value)
                if loss_value > 0:
                    await conn.execute(
                        """INSERT INTO ledger
                               (transaction_date, account_code, debit_amount, credit_amount,
                                description, reference_id)
                           VALUES (NOW(), $1, $2, 0, $3, $4)""",
                        self.ACCOUNT_INVENTORY_WRITEOFF, loss_value,
                        f"Inventory shortage — {name} (OEM {oem_code})", ref,
                    )
                    await conn.execute(
                        """INSERT INTO ledger
                               (transaction_date, account_code, debit_amount, credit_amount,
                                description, reference_id)
                           VALUES (NOW(), $1, 0, $2, $3, $4)""",
                        self.ACCOUNT_INVENTORY, loss_value,
                        f"Inventory shortage — {name} (OEM {oem_code})", ref,
                    )

        result = {
            "expense_id": expense_id,
            "product_id": product_id,
            "shortage_qty": shortage_qty,
            "unit_cost": unit_cost,
            "loss_value": loss_value,
            "new_stock": new_stock,
        }
        self._audit("inventory_shortage", result, reference_id=ref)
        return result

    async def record_inventory_overage(
        self,
        oem_code: str,
        name: str,
        overage_qty: float,
    ) -> Dict[str, Any]:
        """Record an inventory overage detected during a stock count.

        Updates products.current_stock += overage_qty and posts a ledger entry:
            DR 1600 Inventory = overage_value (at WAC)
            CR 7500 Inventory Write-off (contra — reversal of prior write-off if any)

        When no WAC exists the overage is recorded at zero value (stock-only adjustment).
        Returns: {product_id, overage_qty, wac, overage_value, new_stock}
        """
        if overage_qty <= 0:
            raise ValueError("overage_qty must be > 0")
        ref = f"stockcount:overage:{oem_code}"

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                product_row = await conn.fetchrow(
                    "SELECT id, current_stock FROM products WHERE oem_code = $1",
                    oem_code,
                )
                if not product_row:
                    raise ValueError(f"პროდუქტი OEM '{oem_code}' ვერ მოიძებნა")
                product_id = product_row["id"]

                wac_row = await conn.fetchrow(
                    """SELECT SUM(remaining_quantity * unit_cost) AS tc,
                              SUM(remaining_quantity)             AS tq
                       FROM inventory_batches
                       WHERE product_id = $1 AND remaining_quantity > 0""",
                    product_id,
                )
                wac = (
                    float(wac_row["tc"]) / float(wac_row["tq"])
                    if wac_row and wac_row["tq"] and float(wac_row["tq"]) > 0
                    else 0.0
                )
                overage_value = round(overage_qty * wac, 2)

                stock_row = await conn.fetchrow(
                    """UPDATE products
                       SET current_stock = current_stock + $1
                       WHERE id = $2 RETURNING current_stock""",
                    int(overage_qty), product_id,
                )
                new_stock = int(stock_row["current_stock"]) if stock_row else 0

                if overage_value > 0:
                    await conn.execute(
                        """INSERT INTO ledger
                               (transaction_date, account_code, debit_amount, credit_amount,
                                description, reference_id)
                           VALUES (NOW(), $1, $2, 0, $3, $4)""",
                        self.ACCOUNT_INVENTORY, overage_value,
                        f"Inventory overage — {name} (OEM {oem_code})", ref,
                    )
                    await conn.execute(
                        """INSERT INTO ledger
                               (transaction_date, account_code, debit_amount, credit_amount,
                                description, reference_id)
                           VALUES (NOW(), $1, 0, $2, $3, $4)""",
                        self.ACCOUNT_INVENTORY_WRITEOFF, overage_value,
                        f"Inventory overage — {name} (OEM {oem_code})", ref,
                    )

        result = {
            "product_id": product_id,
            "overage_qty": overage_qty,
            "wac": wac,
            "overage_value": overage_value,
            "new_stock": new_stock,
        }
        self._audit("inventory_overage", result, reference_id=ref)
        return result

    async def get_weekly_expenses(self) -> List[ExpenseRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM expenses
                   WHERE created_at >= $1 AND is_paid = TRUE
                   ORDER BY created_at DESC""",
                self._week_ago(),
            )
            return self._rows(rows)  # type: ignore[return-value]

    async def get_weekly_unpaid_expenses(self) -> List[ExpenseRow]:
        """Return unpaid (accrued) expenses from the last 7 days."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM expenses
                   WHERE is_paid = FALSE
                   ORDER BY created_at DESC""",
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
        """Return cash balance breakdown — SSOT formula used by both bot and dashboard.

        balance = cash_sales - cash_expenses - deposits - transfers_out + transfers_in - cash_returns

        Only active (non-returned) sales count. NULL refund_method defaults to 'cash'.
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                WITH
                  cash_s AS (
                    SELECT COALESCE(SUM(unit_price * quantity), 0) AS total
                    FROM sales
                    WHERE payment_method = 'cash' AND status != 'returned'
                  ),
                  cash_e AS (
                    SELECT COALESCE(SUM(amount), 0) AS total
                    FROM expenses WHERE payment_method = 'cash' AND is_paid = TRUE AND is_non_cash = FALSE
                  ),
                  deps AS (
                    SELECT COALESCE(SUM(amount), 0) AS total FROM cash_deposits
                  ),
                  tr_out AS (
                    SELECT COALESCE(SUM(amount), 0) AS total
                    FROM transfers WHERE from_account = 'cash_gel'
                  ),
                  tr_in AS (
                    SELECT COALESCE(SUM(amount), 0) AS total
                    FROM transfers WHERE to_account = 'cash_gel'
                  ),
                  cash_ret AS (
                    SELECT COALESCE(SUM(refund_amount), 0) AS total
                    FROM returns WHERE COALESCE(refund_method, 'cash') = 'cash'
                  )
                SELECT
                  cash_s.total  AS cash_sales,
                  cash_e.total  AS cash_expenses,
                  deps.total    AS deposits,
                  tr_out.total  AS transfers_out,
                  tr_in.total   AS transfers_in,
                  cash_ret.total AS cash_returns
                FROM cash_s, cash_e, deps, tr_out, tr_in, cash_ret
                """
            )
        cash_sales    = float(row["cash_sales"])
        cash_expenses = float(row["cash_expenses"])
        deposits      = float(row["deposits"])
        transfers_out = float(row["transfers_out"])
        transfers_in  = float(row["transfers_in"])
        cash_returns  = float(row["cash_returns"])
        return {
            "cash_sales":    cash_sales,
            "cash_expenses": cash_expenses,
            "deposits":      deposits,
            "transfers_out": transfers_out,
            "transfers_in":  transfers_in,
            "cash_returns":  cash_returns,
            "balance": cash_sales - cash_expenses - deposits - transfers_out + transfers_in - cash_returns,
        }

    # ─── Internal transfers ───────────────────────────────────────────────────

    async def create_transfer(
        self,
        from_account: str,
        to_account: str,
        amount: float,
        currency: str = "GEL",
        note: Optional[str] = None,
    ) -> int:
        """Record an internal transfer between two accounts."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO transfers (from_account, to_account, amount, currency, note)
                   VALUES ($1, $2, $3, $4, $5) RETURNING id""",
                from_account, to_account, amount, currency, note,
            )
            return row["id"]

    async def get_transfers(self) -> List[TransferRow]:
        """Return all transfers ordered newest-first."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM transfers ORDER BY created_at DESC")
            return self._rows(rows)  # type: ignore[return-value]

    async def get_transfers_by_period(
        self, start: datetime, end: datetime
    ) -> List[TransferRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM transfers
                   WHERE created_at >= $1 AND created_at < $2
                   ORDER BY created_at DESC""",
                start, end,
            )
            return self._rows(rows)  # type: ignore[return-value]

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
        payment_status = "debt" if payment_method == "credit" else "paid"
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO sales
                       (product_id, quantity, unit_price, payment_method,
                        seller_type, customer_name, sold_at, notes, payment_status)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                   RETURNING id""",
                product_id, quantity, unit_price, payment_method,
                seller_type, customer_name or None, sold_at, notes, payment_status,
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
                     AND s.status != 'returned'
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
                   WHERE created_at >= $1 AND created_at <= $2 AND is_paid = TRUE
                   ORDER BY created_at DESC""",
                date_from, date_to,
            )
            return self._rows(rows)  # type: ignore[return-value]

    async def get_unpaid_expenses_by_period(
        self, date_from: datetime, date_to: datetime
    ) -> List[ExpenseRow]:
        """Return accrued liabilities (unpaid import consumables) for a period."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM expenses
                   WHERE created_at >= $1 AND created_at <= $2 AND is_paid = FALSE
                   ORDER BY created_at DESC""",
                date_from, date_to,
            )
            return self._rows(rows)  # type: ignore[return-value]

    async def get_all_unpaid_expenses(self) -> List[ExpenseRow]:
        """Return all accrued liabilities across all time."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM expenses
                   WHERE is_paid = FALSE
                   ORDER BY created_at DESC""",
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
        """Pay a single nisia/debt sale fully or partially + post AR settlement.

        If amount >= sale total: marks sale paid, posts full settlement.
        If amount < sale total: reduces unit_price, posts partial settlement.
        Settlement posts under reference "payment:{sale_id}" — DR cash/bank,
        CR 1400 AR.
        Returns remaining debt on this sale after payment (0.0 if fully paid,
        or -1.0 if the sale was not found / already paid).
        """
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """SELECT unit_price, quantity, customer_name, client_name
                       FROM sales
                       WHERE id = $1 AND payment_method = 'credit'
                       FOR UPDATE""",
                    sale_id,
                )
                if not row:
                    return -1.0  # sale not found or already paid
                sale_total = float(row["unit_price"]) * row["quantity"]
                label = row["client_name"] or row["customer_name"] or f"Sale #{sale_id}"
                if amount >= sale_total:
                    await conn.execute(
                        """UPDATE sales
                           SET payment_method = $1, payment_status = 'paid'
                           WHERE id = $2""",
                        payment_method, sale_id,
                    )
                    await self._post_settlement_ledger(
                        conn,
                        reference_id=f"payment:{sale_id}",
                        payment_method=payment_method,
                        amount=round(sale_total, 2),
                        description=f"Debt collected #{sale_id} — {label}",
                    )
                    return 0.0
                else:
                    remaining = sale_total - amount
                    new_price = remaining / row["quantity"]
                    await conn.execute(
                        "UPDATE sales SET unit_price = $1 WHERE id = $2",
                        new_price, sale_id,
                    )
                    await self._post_settlement_ledger(
                        conn,
                        reference_id=f"payment:{sale_id}",
                        payment_method=payment_method,
                        amount=round(float(amount), 2),
                        description=f"Debt partial payment #{sale_id} — {label}",
                    )
                    return remaining

    async def get_debtors(self) -> list:
        """Return all outstanding ნისიები grouped by customer name.

        Includes both LLC and ფ.პ debt sales so management reports show everything.
        Each row includes seller_type so callers can distinguish accounting vs non-accounting.
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT
                       s.id,
                       s.quantity,
                       s.unit_price,
                       s.sold_at,
                       s.client_name,
                       s.customer_name,
                       s.notes,
                       s.seller_type,
                       s.buyer_type,
                       COALESCE(p.name, s.notes, 'უცნობი პროდუქტი') AS product_name,
                       p.oem_code,
                       ROUND(s.quantity * s.unit_price, 2) AS total_amount
                   FROM sales s
                   LEFT JOIN products p ON p.id = s.product_id
                   WHERE s.payment_status = 'debt'
                     AND s.status != 'returned'
                   ORDER BY
                       s.seller_type DESC,
                       COALESCE(s.client_name, s.customer_name, ''),
                       s.sold_at DESC""",
            )
            return self._rows(rows)

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
                   WHERE s.seller_type = 'llc'
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
        product_id: Optional[int] = None,
        clear_product: bool = False,
        seller_type: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Atomically update a sale: stock, inventory batches, and ledger.

        All changes happen inside a single transaction:
          • stock: +old_quantity / -new_quantity across old/new product.
          • batches: when product or quantity changed, restore the old sale's
            batch at its recorded cost and FIFO-consume a fresh batch for the
            new quantity. cost_amount on the sale is rewritten to the fresh
            cost so COGS stays tied to real batches.
          • ledger: when any of (quantity, unit_price, product_id,
            payment_method) change, reverse the old "sale:{id}" revenue +
            COGS pair and post a new pair matching the new values. Net
            bookkeeping stays balanced.

        `None` for any column means "leave unchanged". Use
        clear_product=True to detach a product; use product_id=<int> to
        relink. Returns the updated sale row, or None if the sale was not
        found.
        """
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                sale = await conn.fetchrow(
                    "SELECT * FROM sales WHERE id=$1 FOR UPDATE", sale_id
                )
                if not sale:
                    return None
                old = dict(sale)

                old_product_id = old.get("product_id")
                old_quantity   = int(old["quantity"])
                old_unit_price = float(old["unit_price"])
                old_pm         = old["payment_method"]
                old_cost       = float(old.get("cost_amount") or 0.0)

                # Resolve the new values in terms of "what will actually be stored"
                if clear_product:
                    new_product_id: Optional[int] = None
                elif product_id is not None:
                    new_product_id = int(product_id)
                else:
                    new_product_id = old_product_id

                new_quantity   = int(quantity) if quantity is not None else old_quantity
                new_unit_price = float(unit_price) if unit_price is not None else old_unit_price
                new_pm         = payment_method if payment_method is not None else old_pm

                product_changed  = new_product_id != old_product_id
                quantity_changed = new_quantity != old_quantity
                price_changed    = new_unit_price != old_unit_price
                pm_changed       = new_pm != old_pm
                ledger_touching  = (
                    product_changed or quantity_changed or price_changed or pm_changed
                )

                # ─── Stock adjustment ─────────────────────────────────────
                if product_changed:
                    if old_product_id is not None:
                        await conn.execute(
                            "UPDATE products SET current_stock = current_stock + $1 "
                            "WHERE id = $2",
                            old_quantity, old_product_id,
                        )
                    if new_product_id is not None:
                        await conn.execute(
                            "UPDATE products SET current_stock = current_stock - $1 "
                            "WHERE id = $2",
                            new_quantity, new_product_id,
                        )
                elif quantity_changed and old_product_id is not None:
                    delta = old_quantity - new_quantity  # >0 restores, <0 deducts
                    await conn.execute(
                        "UPDATE products SET current_stock = current_stock + $1 "
                        "WHERE id = $2",
                        delta, old_product_id,
                    )

                # ─── Inventory batch rebalance ────────────────────────────
                # Only disturb batches when product or quantity actually moved.
                new_cost = old_cost
                if product_changed or quantity_changed:
                    if old_product_id is not None and old_cost > 0:
                        await self._restore_inventory_batch(
                            conn, old_product_id, old_quantity, old_cost,
                            note=f"Edit reversal of sale #{sale_id}",
                        )
                    new_cost = 0.0
                    if new_product_id is not None:
                        new_cost = await self._consume_inventory_fifo(
                            conn, new_product_id, new_quantity,
                        )

                # ─── Build the UPDATE (data columns) ─────────────────────
                updates: List[str] = []
                values: List[Any] = []
                idx = 1

                if quantity is not None:
                    updates.append(f"quantity = ${idx}")
                    values.append(new_quantity)
                    idx += 1
                if unit_price is not None:
                    updates.append(f"unit_price = ${idx}")
                    values.append(new_unit_price)
                    idx += 1
                if payment_method is not None:
                    updates.append(f"payment_method = ${idx}")
                    values.append(new_pm)
                    idx += 1
                if seller_type is not None:
                    updates.append(f"seller_type = ${idx}")
                    values.append(seller_type)
                    idx += 1
                if customer_name is not None:
                    updates.append(f"customer_name = ${idx}")
                    values.append(customer_name or None)
                    idx += 1
                if notes is not None:
                    updates.append(f"notes = ${idx}")
                    values.append(notes or None)
                    idx += 1
                if clear_product or product_id is not None:
                    updates.append(f"product_id = ${idx}")
                    values.append(new_product_id)
                    idx += 1
                if product_changed or quantity_changed:
                    updates.extend([f"cost_amount = ${idx}", f"cogs = ${idx + 1}"])
                    values.extend([round(new_cost, 2), round(new_cost, 2)])
                    idx += 2

                if not updates and not ledger_touching:
                    return self._row(sale)

                row = sale
                if updates:
                    values.append(sale_id)
                    row = await conn.fetchrow(
                        f"UPDATE sales SET {', '.join(updates)} "
                        f"WHERE id = ${idx} RETURNING *",
                        *values,
                    )

                # ─── Ledger rebalance ─────────────────────────────────────
                if ledger_touching:
                    label_old = old.get("customer_name") or f"Sale #{sale_id}"
                    label_new = (customer_name if customer_name is not None
                                 else old.get("customer_name")) or f"Sale #{sale_id}"
                    await self._reverse_sale_ledger(
                        conn,
                        sale_id=sale_id,
                        payment_method=old_pm,
                        revenue=round(old_unit_price * old_quantity, 2),
                        cost_amount=old_cost,
                        description=f"Sale #{sale_id} — {label_old}",
                    )
                    await self._post_sale_ledger(
                        conn,
                        sale_id=sale_id,
                        payment_method=new_pm,
                        revenue=round(new_unit_price * new_quantity, 2),
                        cost_amount=round(new_cost, 2),
                        description=f"Sale #{sale_id} (edited) — {label_new}",
                    )

                # Re-join product name for callers that expect it
                if row:
                    result = dict(row)
                    if result.get("product_id"):
                        prod = await conn.fetchrow(
                            "SELECT name, oem_code FROM products WHERE id=$1",
                            result["product_id"],
                        )
                        if prod:
                            result["product_name"] = prod["name"]
                            result["oem_code"] = prod["oem_code"]
                    return result
                return None

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
        payment_method: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Update expense fields atomically. Re-posts ledger when amount or
        payment_method changes (reverse old, post new) so bookkeeping stays
        balanced. Returns updated row or None if not found."""
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
        if payment_method is not None:
            updates.append(f"payment_method = ${idx}")
            values.append(payment_method)
            idx += 1

        if not updates:
            return await self.get_expense(expense_id)

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                current = await conn.fetchrow(
                    "SELECT * FROM expenses WHERE id = $1 FOR UPDATE", expense_id,
                )
                if not current:
                    return None
                old = dict(current)

                values.append(expense_id)
                row = await conn.fetchrow(
                    f"UPDATE expenses SET {', '.join(updates)} "
                    f"WHERE id = ${idx} RETURNING *",
                    *values,
                )
                new_row = dict(row) if row else None
                if new_row is None:
                    return None

                old_amount = round(float(old["amount"]), 2)
                new_amount = round(float(new_row["amount"]), 2)
                old_pm = old["payment_method"]
                new_pm = new_row["payment_method"]

                if old_amount != new_amount or old_pm != new_pm:
                    old_label = old.get("description") or old.get("category") or f"Expense #{expense_id}"
                    new_label = new_row.get("description") or new_row.get("category") or f"Expense #{expense_id}"
                    await self._reverse_expense_ledger(
                        conn,
                        expense_id=expense_id,
                        payment_method=old_pm,
                        amount=old_amount,
                        description=f"Expense #{expense_id} — {old_label}",
                    )
                    await self._post_expense_ledger(
                        conn,
                        expense_id=expense_id,
                        payment_method=new_pm,
                        amount=new_amount,
                        description=f"Expense #{expense_id} — {new_label}",
                    )

                return new_row

    async def update_expense_topic_message(
        self, expense_id: int, topic_id: int, topic_message_id: int
    ) -> None:
        """Store the group-topic message ID for an expense so it can be updated later."""
        async with self.pool.acquire() as conn:
            await conn.execute(
                "UPDATE expenses SET topic_id=$1, topic_message_id=$2 WHERE id=$3",
                topic_id, topic_message_id, expense_id,
            )

    async def delete_expense(self, expense_id: int) -> Optional[Dict[str, Any]]:
        """Hard-delete an expense, reversing the ledger posting atomically.

        Returns the deleted row (including topic_id / topic_message_id so the
        caller can update the topic message in place) or None when the row
        does not exist.
        """
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    "SELECT * FROM expenses WHERE id = $1 FOR UPDATE", expense_id,
                )
                if not row:
                    return None
                current = dict(row)

                label = current.get("description") or current.get("category") or f"Expense #{expense_id}"
                await self._reverse_expense_ledger(
                    conn,
                    expense_id=expense_id,
                    payment_method=current["payment_method"],
                    amount=float(current["amount"]),
                    description=f"Expense #{expense_id} — {label}",
                )
                await conn.execute("DELETE FROM expenses WHERE id = $1", expense_id)
                return current

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
        """Move a sale to deleted_sales (24h restore window), restore stock,
        and reverse the sale's ledger entries atomically.

        The original cost_amount travels with the archived row so a later
        restore can consume WAC correctly regardless of drift.
        Returns the archived row (with topic_id / topic_message_id), or None.
        """
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                sale = await conn.fetchrow(
                    "SELECT * FROM sales WHERE id=$1 FOR UPDATE", sale_id,
                )
                if not sale:
                    return None
                sale_dict = dict(sale)

                qty = int(sale_dict["quantity"])
                unit_price = float(sale_dict["unit_price"])
                cost_amount = float(sale_dict.get("cost_amount") or 0.0)
                revenue = round(unit_price * qty, 2)
                pm = sale_dict["payment_method"]
                product_id = sale_dict.get("product_id")
                label = sale_dict.get("customer_name") or f"Sale #{sale_id}"

                expires = self._now() + timedelta(hours=24)
                archived = await conn.fetchrow(
                    """INSERT INTO deleted_sales
                           (original_sale_id, product_id, quantity, unit_price,
                            payment_method, seller_type, customer_name,
                            sold_at, notes, topic_id, topic_message_id,
                            cost_amount, expires_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                       RETURNING id""",
                    sale_dict["id"],
                    product_id,
                    qty,
                    unit_price,
                    pm,
                    sale_dict.get("seller_type", "individual"),
                    sale_dict.get("customer_name"),
                    sale_dict.get("sold_at"),
                    sale_dict.get("notes"),
                    sale_dict.get("topic_id"),
                    sale_dict.get("topic_message_id"),
                    cost_amount,
                    expires,
                )
                sale_dict["deleted_id"] = archived["id"]

                if product_id:
                    await conn.execute(
                        "UPDATE products SET current_stock=current_stock+$1 WHERE id=$2",
                        qty, product_id,
                    )
                    await self._restore_inventory_batch(
                        conn, product_id, qty, cost_amount,
                        note=f"Soft-delete of sale #{sale_id}",
                    )

                await self._reverse_sale_ledger(
                    conn,
                    sale_id=sale_id,
                    payment_method=pm,
                    revenue=revenue,
                    cost_amount=cost_amount,
                    description=f"Sale #{sale_id} — {label}",
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
        """Re-insert a deleted sale, re-consume inventory (WAC), re-post ledger.

        Runs inside one transaction:
          1. Look up the archived row (must be within 24h window).
          2. INSERT a new sales row (fresh id).
          3. Deduct stock and FIFO-consume inventory_batches at current WAC.
             Cost may differ from the pre-delete cost if batches changed — we
             store the fresh cost_amount on the new sale.
          4. Post revenue + COGS ledger pair under reference "sale:{new_id}".
          5. DELETE the archived row.
        Returns the new sale_id, or None if not found / expired.
        """
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                ds = await conn.fetchrow(
                    "SELECT * FROM deleted_sales WHERE id=$1 AND expires_at > NOW()",
                    deleted_id,
                )
                if not ds:
                    return None
                d = dict(ds)

                product_id = d.get("product_id")
                qty = int(d["quantity"])
                unit_price = float(d["unit_price"])
                pm = d["payment_method"]
                customer_name = d.get("customer_name")
                revenue = round(unit_price * qty, 2)

                row = await conn.fetchrow(
                    """INSERT INTO sales
                           (product_id, quantity, unit_price, payment_method,
                            seller_type, customer_name, sold_at, notes)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                       RETURNING id""",
                    product_id, qty, unit_price, pm,
                    d.get("seller_type", "individual"),
                    customer_name, d.get("sold_at"), d.get("notes"),
                )
                new_sale_id = row["id"]

                cost_amount = 0.0
                if product_id:
                    await conn.execute(
                        "UPDATE products SET current_stock=current_stock-$1 WHERE id=$2",
                        qty, product_id,
                    )
                    cost_amount = await self._consume_inventory_fifo(
                        conn, product_id, qty,
                    )
                    if cost_amount > 0:
                        await conn.execute(
                            "UPDATE sales SET cost_amount = $1, cogs = $1 WHERE id = $2",
                            cost_amount, new_sale_id,
                        )

                label = customer_name or f"Sale #{new_sale_id}"
                await self._post_sale_ledger(
                    conn,
                    sale_id=new_sale_id,
                    payment_method=pm,
                    revenue=revenue,
                    cost_amount=cost_amount,
                    description=f"Restored sale #{new_sale_id} — {label}",
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

    # ─── Import history ──────────────────────────────────────────────────────────

    async def save_import_history_rows(self, rows: list) -> int:
        """Insert multiple import history rows in one transaction. Returns row count."""
        if not rows:
            return 0
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                for r in rows:
                    await conn.execute(
                        """INSERT INTO imports_history
                               (import_date, oem, name, quantity, unit,
                                unit_price_usd, exchange_rate,
                                transport_cost_gel, other_cost_gel,
                                total_unit_cost_gel, suggested_retail_price_gel)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)""",
                        r["import_date"], r["oem"], r["name"],
                        r["quantity"], r["unit"],
                        r["unit_price_usd"], r["exchange_rate"],
                        r["transport_cost_gel"], r["other_cost_gel"],
                        r["total_unit_cost_gel"], r["suggested_retail_price_gel"],
                    )
        return len(rows)

    async def get_imports_history(self, limit: int = 500) -> list:
        """Return recent import history rows ordered by import_date DESC."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT id, import_date, oem, name, quantity, unit,
                          unit_price_usd, exchange_rate,
                          transport_cost_gel, other_cost_gel,
                          total_unit_cost_gel, suggested_retail_price_gel,
                          created_at
                   FROM imports_history
                   ORDER BY import_date DESC, created_at DESC
                   LIMIT $1""",
                limit,
            )
        return [dict(r) for r in rows]

    async def get_last_import_prices(self, oems: list[str]) -> dict[str, Decimal]:
        """Return the most recent unit_price_usd per OEM from imports_history."""
        if not oems:
            return {}
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT DISTINCT ON (oem) oem, unit_price_usd
                FROM imports_history
                WHERE oem = ANY($1)
                ORDER BY oem, import_date DESC, created_at DESC
                """,
                oems,
            )
        return {row["oem"]: row["unit_price_usd"] for row in rows}

    # ─── Personal Orders ──────────────────────────────────────────────────────

    _ITEMS_SUBQUERY = """
        COALESCE(
            (SELECT json_agg(json_build_object(
                        'id', i.id, 'part_name', i.part_name, 'oem_code', i.oem_code
                    ) ORDER BY i.id)
             FROM personal_order_items i WHERE i.order_id = o.id),
            '[]'::json
        ) AS items
    """

    def _row_to_po(self, row: Any) -> PersonalOrderRow:
        d = dict(row)
        items = d.get("items")
        if not isinstance(items, list):
            d["items"] = []
        return d  # type: ignore[return-value]

    async def create_personal_order(
        self,
        customer_name: str,
        items: List[Tuple[str, Optional[str]]],  # [(part_name, oem_code)]
        sale_price: float,
        customer_contact: Optional[str] = None,
        cost_price: Optional[float] = None,
        transportation_cost: Optional[float] = None,
        vat_amount: Optional[float] = None,
        sale_price_min: Optional[float] = None,
        estimated_arrival: Optional[Any] = None,
        notes: Optional[str] = None,
    ) -> PersonalOrderRow:
        primary_name = items[0][0] if items else ""
        primary_oem = items[0][1] if items else None
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """INSERT INTO personal_orders
                           (customer_name, customer_contact, part_name, oem_code,
                            cost_price, transportation_cost, vat_amount,
                            sale_price_min, sale_price, estimated_arrival, notes)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                       RETURNING *""",
                    customer_name, customer_contact, primary_name, primary_oem,
                    cost_price, transportation_cost, vat_amount,
                    sale_price_min, sale_price, estimated_arrival, notes,
                )
                order_id = row["id"]
                for part_name, oem_code in items:
                    await conn.execute(
                        "INSERT INTO personal_order_items (order_id, part_name, oem_code) VALUES ($1, $2, $3)",
                        order_id, part_name, oem_code,
                    )
        result = await self.get_personal_order_by_id(order_id)
        return result  # type: ignore[return-value]

    async def get_personal_orders(self, limit: int = 100) -> List[PersonalOrderRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                f"""SELECT o.*, {self._ITEMS_SUBQUERY}
                    FROM personal_orders o
                    ORDER BY o.created_at DESC
                    LIMIT $1""",
                limit,
            )
        return [self._row_to_po(r) for r in rows]  # type: ignore[misc]

    async def get_personal_order_by_id(self, order_id: int) -> Optional[PersonalOrderRow]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                f"SELECT o.*, {self._ITEMS_SUBQUERY} FROM personal_orders o WHERE o.id = $1",
                order_id,
            )
        return self._row_to_po(row) if row else None

    async def get_personal_order_by_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Public view — omits owner-only financial fields."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                f"""SELECT o.id, o.tracking_token, o.customer_name, o.part_name, o.oem_code,
                           o.sale_price_min, o.sale_price, o.amount_paid,
                           o.status, o.estimated_arrival, o.created_at,
                           {self._ITEMS_SUBQUERY}
                    FROM personal_orders o
                    WHERE o.tracking_token = $1""",
                token,
            )
        if not row:
            return None
        d = dict(row)
        if not isinstance(d.get("items"), list):
            d["items"] = []
        return d

    async def update_personal_order(self, order_id: int, **fields: Any) -> None:
        allowed = {
            "customer_name", "customer_contact", "part_name", "oem_code",
            "cost_price", "transportation_cost", "vat_amount",
            "sale_price_min", "sale_price", "amount_paid", "status", "estimated_arrival", "notes",
        }
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return
        set_clauses = ", ".join(
            f"{col} = ${i + 2}" for i, col in enumerate(updates)
        )
        values = list(updates.values())
        async with self.pool.acquire() as conn:
            await conn.execute(
                f"UPDATE personal_orders SET {set_clauses}, updated_at = NOW() WHERE id = $1",
                order_id, *values,
            )

    async def save_personal_order_tg_message(
        self, order_id: int, chat_id: int, message_id: int
    ) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                "UPDATE personal_orders SET telegram_chat_id = $2, telegram_message_id = $3 WHERE id = $1",
                order_id, chat_id, message_id,
            )

    async def update_personal_order_payment(self, order_id: int, amount_paid: float) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """UPDATE personal_orders
                   SET amount_paid = $2, updated_at = NOW()
                   WHERE id = $1""",
                order_id, amount_paid,
            )
