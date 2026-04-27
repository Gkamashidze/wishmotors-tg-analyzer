"""
Unit tests for database/db.py — tests the logic without a real database.
Uses unittest.mock to patch asyncpg so no PostgreSQL instance is needed.
"""

import os
from unittest.mock import AsyncMock, MagicMock
import pytest

# Minimal env so config loads
os.environ.setdefault("BOT_TOKEN", "test")
os.environ.setdefault("GROUP_ID", "1")
os.environ.setdefault("SALES_TOPIC_ID", "2")
os.environ.setdefault("ORDERS_TOPIC_ID", "3")
os.environ.setdefault("EXPENSES_TOPIC_ID", "4")
os.environ.setdefault("STOCK_TOPIC_ID", "5")
os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost/test")
os.environ.setdefault("ADMIN_IDS", "12345")
os.environ.setdefault("RAILWAY_ENVIRONMENT", "test")

from database.db import Database  # noqa: E402


def _make_db() -> Database:
    db = Database(dsn="postgresql://x:x@localhost/test")
    return db


def _make_pool_mock():
    """Return a MagicMock that simulates asyncpg.Pool with async context manager."""
    conn = AsyncMock()
    conn.transaction = MagicMock(return_value=AsyncMock(
        __aenter__=AsyncMock(return_value=conn),
        __aexit__=AsyncMock(return_value=None),
    ))
    pool = MagicMock()
    pool.acquire = MagicMock(return_value=AsyncMock(
        __aenter__=AsyncMock(return_value=conn),
        __aexit__=AsyncMock(return_value=None),
    ))
    return pool, conn


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestDatabasePool:
    def test_pool_raises_before_init(self):
        """Accessing pool before init() must raise RuntimeError."""
        db = _make_db()
        with pytest.raises(RuntimeError, match="Database.init()"):
            _ = db.pool

    def test_pool_returns_pool_after_inject(self):
        """Pool property returns the injected pool."""
        db = _make_db()
        mock_pool = MagicMock()
        db._pool = mock_pool
        assert db.pool is mock_pool


class TestGetProductById:
    @pytest.mark.asyncio
    async def test_returns_none_when_not_found(self):
        db = _make_db()
        pool, conn = _make_pool_mock()
        conn.fetchrow = AsyncMock(return_value=None)
        db._pool = pool

        result = await db.get_product_by_id(999)
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_product_dict(self):
        db = _make_db()
        pool, conn = _make_pool_mock()
        fake_row = {
            "id": 1, "name": "სარკე", "oem_code": "12345",
            "current_stock": 10, "min_stock": 5,
            "unit_price": 30.0, "created_at": None,
        }
        conn.fetchrow = AsyncMock(return_value=fake_row)
        db._pool = pool

        result = await db.get_product_by_id(1)
        assert result is not None
        assert result["id"] == 1
        assert result["name"] == "სარკე"


class TestCreateSale:
    @pytest.mark.asyncio
    async def test_returns_sale_id_and_new_stock(self):
        """LLC product sale with no active batches: revenue+VAT pairs post, no COGS."""
        db = _make_db()
        pool, conn = _make_pool_mock()

        # fetchrow sequence: INSERT sales → UPDATE products stock
        sale_row  = {"id": 42}
        stock_row = {"current_stock": 8}
        conn.fetchrow = AsyncMock(side_effect=[sale_row, stock_row])
        # _consume_inventory_fifo: no active batches → cost 0
        conn.fetch = AsyncMock(return_value=[])
        conn.execute = AsyncMock()
        db._pool = pool

        sale_id, new_stock = await db.create_sale(
            product_id=1,
            quantity=2,
            unit_price=30.0,
            payment_method="cash",
            seller_type="llc",
        )

        assert sale_id == 42
        assert new_stock == 8
        # LLC with output_vat > 0: net-revenue pair (2) + VAT pair (2) = 4 ledger INSERTs
        # + 1 vat_ledger INSERT = 5 total. No COGS (cost=0).
        assert conn.execute.call_count == 5

    @pytest.mark.asyncio
    async def test_no_product_id_returns_zero_stock(self):
        """LLC freeform nisia: no stock/batches touched, AR+VAT pairs posted."""
        db = _make_db()
        pool, conn = _make_pool_mock()
        conn.fetchrow = AsyncMock(return_value={"id": 7})
        conn.fetch = AsyncMock(return_value=[])
        conn.execute = AsyncMock()
        db._pool = pool

        sale_id, new_stock = await db.create_sale(
            product_id=None,
            quantity=1,
            unit_price=20.0,
            payment_method="credit",
            seller_type="llc",
        )

        assert sale_id == 7
        assert new_stock == 0  # no product → stock unchanged
        # LLC with output_vat > 0: net-revenue pair (2) + VAT pair (2) = 4 ledger INSERTs
        # + 1 vat_ledger INSERT = 5 total. No COGS (no product).
        assert conn.execute.call_count == 5

    @pytest.mark.asyncio
    async def test_posts_cogs_pair_when_batches_exist(self):
        """Sale against an active batch posts both revenue and COGS pairs."""
        db = _make_db()
        pool, conn = _make_pool_mock()

        sale_row  = {"id": 55}
        stock_row = {"current_stock": 3}
        conn.fetchrow = AsyncMock(side_effect=[sale_row, stock_row])
        # One batch covering the full qty at cost 10.0 per unit.
        conn.fetch = AsyncMock(return_value=[
            {"id": 1, "remaining_quantity": 5, "unit_cost": 10.0},
        ])
        conn.execute = AsyncMock()
        db._pool = pool

        sale_id, new_stock = await db.create_sale(
            product_id=1,
            quantity=2,
            unit_price=30.0,
            payment_method="cash",
            seller_type="llc",
        )

        assert sale_id == 55
        assert new_stock == 3
        # 1 batch UPDATE + 1 UPDATE sales.cost_amount
        # + 6 ledger INSERTs (net-revenue pair + VAT pair + COGS pair)
        # + 1 vat_ledger INSERT = 9 total.
        assert conn.execute.call_count == 9


class TestDeleteSale:
    @pytest.mark.asyncio
    async def test_returns_none_when_sale_not_found(self):
        db = _make_db()
        pool, conn = _make_pool_mock()
        conn.fetchrow = AsyncMock(return_value=None)
        db._pool = pool

        result = await db.delete_sale(999)
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_sale_dict_on_success(self):
        db = _make_db()
        pool, conn = _make_pool_mock()
        fake_sale = {
            "id": 5, "product_id": 1, "quantity": 2,
            "unit_price": 30.0, "payment_method": "cash",
            "seller_type": "llc", "buyer_type": "retail", "customer_name": None,
            "sold_at": None, "notes": None,
            "cost_amount": 20.0, "output_vat": 0.0,
        }
        conn.fetchrow = AsyncMock(return_value=fake_sale)
        conn.execute = AsyncMock()
        db._pool = pool

        result = await db.delete_sale(5)
        assert result is not None
        assert result["id"] == 5
        # Expected executes (LLC seller, output_vat=0, buyer_type=retail):
        #   1. UPDATE products (stock restore)
        #   2. INSERT inventory_batches (restore batch at original cost)
        #   3..4. Revenue reversal pair (DR revenue, CR cash)
        #   5..6. COGS reversal pair (DR inventory, CR COGS)
        #   7. DELETE sales row
        assert conn.execute.call_count == 7


class TestMarkSalePaid:
    @pytest.mark.asyncio
    async def test_returns_true_when_updated(self):
        """Full payoff of a nisia posts settlement pair (DR cash, CR AR)."""
        db = _make_db()
        pool, conn = _make_pool_mock()
        conn.fetchrow = AsyncMock(return_value={
            "id": 1, "unit_price": 30.0, "quantity": 2, "customer_name": "Giorgi",
            "client_name": None, "seller_type": "llc", "buyer_type": "retail",
        })
        conn.execute = AsyncMock()
        db._pool = pool

        result = await db.mark_sale_paid(1, "cash")
        assert result is True
        # UPDATE sales.payment_method + 2 ledger INSERTs (settlement pair).
        # seller_type="llc" triggers ledger; buyer_type="retail" → 1410 1, no extra fetchrow.
        assert conn.execute.call_count == 3

    @pytest.mark.asyncio
    async def test_returns_false_when_not_found(self):
        db = _make_db()
        pool, conn = _make_pool_mock()
        conn.fetchrow = AsyncMock(return_value=None)
        conn.execute = AsyncMock()
        db._pool = pool

        result = await db.mark_sale_paid(999, "cash")
        assert result is False
        assert conn.execute.call_count == 0


class TestUpdateStock:
    @pytest.mark.asyncio
    async def test_returns_new_stock_level(self):
        db = _make_db()
        pool, conn = _make_pool_mock()
        conn.fetchrow = AsyncMock(return_value={"current_stock": 15})
        db._pool = pool

        result = await db.update_stock(1, -3)
        assert result == 15

    @pytest.mark.asyncio
    async def test_returns_zero_when_product_not_found(self):
        db = _make_db()
        pool, conn = _make_pool_mock()
        conn.fetchrow = AsyncMock(return_value=None)
        db._pool = pool

        result = await db.update_stock(999, -1)
        assert result == 0


class TestGetProductWAC:
    @pytest.mark.asyncio
    async def test_returns_zero_when_no_active_batches(self):
        db = _make_db()
        pool, conn = _make_pool_mock()
        conn.fetchrow = AsyncMock(return_value={"total_cost": None, "total_qty": None})
        db._pool = pool

        wac = await db.get_product_wac(1)
        assert wac == 0.0

    @pytest.mark.asyncio
    async def test_returns_weighted_average_across_batches(self):
        """Two active batches: 10 @ 5.00 + 20 @ 8.00 → WAC = 210 / 30 = 7.00"""
        db = _make_db()
        pool, conn = _make_pool_mock()
        conn.fetchrow = AsyncMock(return_value={"total_cost": 210.0, "total_qty": 30.0})
        db._pool = pool

        wac = await db.get_product_wac(1)
        assert wac == pytest.approx(7.0)


class TestReceiveInventoryBatch:
    @pytest.mark.asyncio
    async def test_rejects_non_positive_quantity(self):
        db = _make_db()
        with pytest.raises(ValueError, match="quantity"):
            await db.receive_inventory_batch(
                name="სარკე", oem_code="12345", quantity=0,
                unit_cost=10.0, min_stock=20,
            )

    @pytest.mark.asyncio
    async def test_rejects_negative_unit_cost(self):
        db = _make_db()
        with pytest.raises(ValueError, match="unit_cost"):
            await db.receive_inventory_batch(
                name="სარკე", oem_code="12345", quantity=5,
                unit_cost=-1.0, min_stock=20,
            )

    @pytest.mark.asyncio
    async def test_raises_when_oem_is_missing(self):
        """No OEM code → ValueError raised immediately (strict OEM-only mode)."""
        db = _make_db()
        with pytest.raises(ValueError, match="oem_code"):
            await db.receive_inventory_batch(
                name="სარკე", oem_code=None, quantity=5,
                unit_cost=10.0, min_stock=20,
            )

    @pytest.mark.asyncio
    async def test_raises_when_oem_is_empty_string(self):
        """Empty-string OEM → ValueError raised (treated same as missing)."""
        db = _make_db()
        with pytest.raises(ValueError, match="oem_code"):
            await db.receive_inventory_batch(
                name="სარკე", oem_code="   ", quantity=5,
                unit_cost=10.0, min_stock=20,
            )

    @pytest.mark.asyncio
    async def test_existing_product_updates_name_price_and_posts_batch(self):
        """Existing product: name+unit_price updated, stock += qty, 1 batch, 2 ledger rows."""
        db = _make_db()
        pool, conn = _make_pool_mock()

        # fetchrow sequence:
        #   1. SELECT id FROM products WHERE oem_code = ... → existing
        #   2. UPDATE products SET current_stock += ... RETURNING current_stock
        #   3. INSERT INTO inventory_batches RETURNING id
        #   4. SELECT WAC aggregates
        conn.fetchrow = AsyncMock(side_effect=[
            {"id": 7},                                     # product found by OEM
            {"current_stock": 30},                         # stock after receipt
            {"id": 100},                                   # batch id
            {"total_cost": 200.0, "total_qty": 20.0},      # WAC aggregates
        ])
        conn.execute = AsyncMock()
        db._pool = pool

        result = await db.receive_inventory_batch(
            name="სარკე განახლებული", oem_code="12345", quantity=10,
            unit_cost=15.0, min_stock=20,
        )

        assert result["product_id"] == 7
        assert result["batch_id"] == 100
        assert result["new_stock"] == 30
        assert result["new_wac"] == pytest.approx(10.0)
        assert result["total_cost"] == pytest.approx(150.0)
        assert result["was_created"] is False
        # execute calls: 1 UPDATE (name+unit_price) + 2 ledger inserts = 3.
        assert conn.execute.call_count == 3

    @pytest.mark.asyncio
    async def test_new_product_is_created_when_oem_not_in_db(self):
        """OEM not found in DB → product row inserted and was_created == True."""
        db = _make_db()
        pool, conn = _make_pool_mock()

        # fetchrow sequence:
        #   1. SELECT id FROM products WHERE oem_code = ... → None
        #   2. INSERT INTO products ... RETURNING id
        #   3. UPDATE products SET current_stock += ... RETURNING current_stock
        #   4. INSERT INTO inventory_batches RETURNING id
        #   5. SELECT WAC aggregates
        conn.fetchrow = AsyncMock(side_effect=[
            None,
            {"id": 42},
            {"current_stock": 5},
            {"id": 101},
            {"total_cost": 25.0, "total_qty": 5.0},
        ])
        conn.execute = AsyncMock()
        db._pool = pool

        result = await db.receive_inventory_batch(
            name="ახალი ნაწილი", oem_code="99999",
            quantity=5, unit_cost=5.0, min_stock=20,
        )

        assert result["product_id"] == 42
        assert result["was_created"] is True
        assert result["new_wac"] == pytest.approx(5.0)


class TestEditProduct:
    @pytest.mark.asyncio
    async def test_returns_none_when_no_updates(self):
        """edit_product with no fields calls get_product_by_id instead."""
        db = _make_db()
        pool, conn = _make_pool_mock()
        conn.fetchrow = AsyncMock(return_value=None)
        db._pool = pool

        # Passing no kwargs → falls through to get_product_by_id
        result = await db.edit_product(1)
        assert result is None

    @pytest.mark.asyncio
    async def test_updates_name_field(self):
        db = _make_db()
        pool, conn = _make_pool_mock()
        updated = {
            "id": 1, "name": "ახალი სახელი", "oem_code": None,
            "current_stock": 5, "min_stock": 2, "unit_price": 25.0, "created_at": None,
        }
        conn.fetchrow = AsyncMock(return_value=updated)
        db._pool = pool

        result = await db.edit_product(1, name="ახალი სახელი")
        assert result is not None
        assert result["name"] == "ახალი სახელი"
