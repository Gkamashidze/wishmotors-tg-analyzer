from dataclasses import dataclass
from typing import Optional
from typing_extensions import TypedDict

# ─── SQL schema (PostgreSQL) ──────────────────────────────────────────────────

CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS products (
    id            SERIAL PRIMARY KEY,
    name          TEXT    NOT NULL,
    oem_code      TEXT    UNIQUE,
    current_stock INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
    min_stock     INTEGER NOT NULL DEFAULT 20 CHECK (min_stock >= 0),
    unit_price    NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_oem  ON products(oem_code);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

CREATE TABLE IF NOT EXISTS sales (
    id             SERIAL PRIMARY KEY,
    product_id     INTEGER REFERENCES products(id) ON DELETE SET NULL,
    quantity       INTEGER NOT NULL CHECK (quantity > 0),
    unit_price     NUMERIC(12, 2) NOT NULL,
    payment_method TEXT    NOT NULL DEFAULT 'credit',
    seller_type    TEXT    NOT NULL DEFAULT 'individual',
    customer_name  TEXT,
    sold_at        TIMESTAMPTZ DEFAULT NOW(),
    notes          TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_sold_at       ON sales(sold_at);
CREATE INDEX IF NOT EXISTS idx_sales_product_id    ON sales(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_payment       ON sales(payment_method);

CREATE TABLE IF NOT EXISTS returns (
    id                  SERIAL PRIMARY KEY,
    sale_id             INTEGER REFERENCES sales(id) ON DELETE SET NULL,
    product_id          INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity            INTEGER NOT NULL CHECK (quantity > 0),
    refund_amount       NUMERIC(12, 2) NOT NULL,
    exchange_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    returned_at         TIMESTAMPTZ DEFAULT NOW(),
    notes               TEXT
);

CREATE TABLE IF NOT EXISTS orders (
    id              SERIAL PRIMARY KEY,
    product_id      INTEGER REFERENCES products(id) ON DELETE SET NULL,
    quantity_needed INTEGER NOT NULL CHECK (quantity_needed > 0),
    status          TEXT    NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    notes           TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
    id          SERIAL PRIMARY KEY,
    amount      NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    description TEXT,
    category    TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parse_failures (
    id           SERIAL PRIMARY KEY,
    topic_id     INTEGER NOT NULL,
    message_text TEXT    NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parse_failures_topic ON parse_failures(topic_id);
CREATE INDEX IF NOT EXISTS idx_parse_failures_time  ON parse_failures(created_at);
"""

# Applied once at startup to add new columns / constraints to existing tables (idempotent).
# Constraints are added NOT VALID so they apply to future rows without scanning existing data.
MIGRATE_SQL = """
-- Allow stock to go negative (wizard sales on unloaded inventory visible as negative)
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_current_stock_check;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS seller_type   TEXT NOT NULL DEFAULT 'individual';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_name TEXT;

DO $$ BEGIN
  ALTER TABLE sales ADD CONSTRAINT sales_quantity_positive CHECK (quantity > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE returns ADD CONSTRAINT returns_quantity_positive CHECK (quantity > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_quantity_positive CHECK (quantity_needed > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Topic message tracking for deletion/restore
ALTER TABLE sales ADD COLUMN IF NOT EXISTS topic_id         INTEGER;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS topic_message_id INTEGER;

-- Soft-deleted sales kept for 24h restore window
CREATE TABLE IF NOT EXISTS deleted_sales (
    id               SERIAL PRIMARY KEY,
    original_sale_id INTEGER,
    product_id       INTEGER,
    quantity         INTEGER NOT NULL,
    unit_price       NUMERIC(12, 2) NOT NULL,
    payment_method   TEXT NOT NULL DEFAULT 'credit',
    seller_type      TEXT NOT NULL DEFAULT 'individual',
    customer_name    TEXT,
    sold_at          TIMESTAMPTZ,
    notes            TEXT,
    topic_id         INTEGER,
    deleted_at       TIMESTAMPTZ DEFAULT NOW(),
    expires_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deleted_sales_expires ON deleted_sales(expires_at);

-- Topic message tracking for expenses (edit → delete old + re-post)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS topic_id         INTEGER;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS topic_message_id INTEGER;

-- Cash payment tracking for expenses (cash reduces hand balance; transfer does not)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';

-- Cash deposits: records when hand cash is transferred to bank
CREATE TABLE IF NOT EXISTS cash_deposits (
    id          SERIAL PRIMARY KEY,
    amount      NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    note        TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Unit of measure for products (ც, კგ, მ, კომპლ. etc.)
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'ც';

-- Track whether a company (შპს) sale has been receipted at the cash register
ALTER TABLE sales ADD COLUMN IF NOT EXISTS receipt_printed BOOLEAN NOT NULL DEFAULT FALSE;

-- Order priority: urgent | normal | low
ALTER TABLE orders ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';

DO $$ BEGIN
  ALTER TABLE expenses ADD CONSTRAINT expenses_amount_positive CHECK (amount > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
"""


# ─── TypedDict — type-safe dict shapes returned by db.py ─────────────────────
# These let handlers use typed access (e.g. product["id"]) with IDE support
# and mypy validation, without requiring a full ORM migration.

class ProductRow(TypedDict):
    id: int
    name: str
    oem_code: Optional[str]
    current_stock: int
    min_stock: int
    unit_price: float
    unit: str
    created_at: object  # datetime in practice


class SaleRow(TypedDict):
    id: int
    product_id: Optional[int]
    quantity: int
    unit_price: float
    payment_method: str
    seller_type: str
    customer_name: Optional[str]
    sold_at: object  # datetime
    notes: Optional[str]
    receipt_printed: bool
    # Joined fields (present in report queries)
    product_name: Optional[str]
    oem_code: Optional[str]


class ReturnRow(TypedDict):
    id: int
    sale_id: Optional[int]
    product_id: int
    quantity: int
    refund_amount: float
    exchange_product_id: Optional[int]
    returned_at: object  # datetime
    notes: Optional[str]
    product_name: Optional[str]


class OrderRow(TypedDict):
    id: int
    product_id: Optional[int]
    quantity_needed: int
    status: str
    priority: str  # urgent | normal | low
    created_at: object  # datetime
    notes: Optional[str]
    product_name: Optional[str]
    oem_code: Optional[str]


class ExpenseRow(TypedDict):
    id: int
    amount: float
    description: Optional[str]
    category: Optional[str]
    created_at: object  # datetime


class ParseFailureRow(TypedDict):
    message_text: str
    occurrences: int
    last_seen: object  # datetime


class CashDepositRow(TypedDict):
    id: int
    amount: float
    note: Optional[str]
    created_at: object  # datetime


# ─── Dataclasses (kept for backwards compatibility and future use) ────────────

@dataclass
class Product:
    id: int
    name: str
    oem_code: Optional[str]
    current_stock: int
    min_stock: int
    unit_price: float
    created_at: str


@dataclass
class Sale:
    id: int
    product_id: Optional[int]
    quantity: int
    unit_price: float
    payment_method: str
    seller_type: str
    customer_name: Optional[str]
    sold_at: str
    notes: Optional[str]
