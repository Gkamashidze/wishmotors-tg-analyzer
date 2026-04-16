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
os.environ.setdefault("CAPITAL_TOPIC_ID", "5")
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
        db = _make_db()
        pool, conn = _make_pool_mock()

        sale_row = {"id": 42}
        stock_row = {"current_stock": 8}
        conn.fetchrow = AsyncMock(side_effect=[sale_row, stock_row])
        db._pool = pool

        sale_id, new_stock = await db.create_sale(
            product_id=1,
            quantity=2,
            unit_price=30.0,
            payment_method="cash",
        )

        assert sale_id == 42
        assert new_stock == 8

    @pytest.mark.asyncio
    async def test_no_product_id_returns_zero_stock(self):
        db = _make_db()
        pool, conn = _make_pool_mock()
        conn.fetchrow = AsyncMock(return_value={"id": 7})
        db._pool = pool

        sale_id, new_stock = await db.create_sale(
            product_id=None,
            quantity=1,
            unit_price=20.0,
            payment_method="credit",
        )

        assert sale_id == 7
        assert new_stock == 0  # no product → stock unchanged


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
            "seller_type": "individual", "customer_name": None,
            "sold_at": None, "notes": None,
        }
        conn.fetchrow = AsyncMock(return_value=fake_sale)
        conn.execute = AsyncMock()
        db._pool = pool

        result = await db.delete_sale(5)
        assert result is not None
        assert result["id"] == 5
        # Verify stock restore was called
        conn.execute.assert_called()


class TestMarkSalePaid:
    @pytest.mark.asyncio
    async def test_returns_true_when_updated(self):
        db = _make_db()
        pool, conn = _make_pool_mock()
        conn.execute = AsyncMock(return_value="UPDATE 1")
        db._pool = pool

        result = await db.mark_sale_paid(1, "cash")
        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_not_found(self):
        db = _make_db()
        pool, conn = _make_pool_mock()
        conn.execute = AsyncMock(return_value="UPDATE 0")
        db._pool = pool

        result = await db.mark_sale_paid(999, "cash")
        assert result is False


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
    async def test_existing_product_posts_batch_stock_and_ledger(self):
        """Existing product: stock += qty, 1 batch insert, 2 ledger rows, WAC returned."""
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
            name="სარკე", oem_code="12345", quantity=10,
            unit_cost=15.0, min_stock=20,
        )

        assert result["product_id"] == 7
        assert result["batch_id"] == 100
        assert result["new_stock"] == 30
        assert result["new_wac"] == pytest.approx(10.0)
        assert result["total_cost"] == pytest.approx(150.0)
        assert result["was_created"] is False
        # Two ledger inserts were executed (debit + credit).
        assert conn.execute.call_count == 2

    @pytest.mark.asyncio
    async def test_new_product_is_created_when_oem_missing(self):
        """Unknown OEM → product row is inserted and was_created == True."""
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
