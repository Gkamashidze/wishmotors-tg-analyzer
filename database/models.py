from dataclasses import dataclass
from typing import Optional

# ─── SQL schema (PostgreSQL) ──────────────────────────────────────────────────

CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS products (
    id            SERIAL PRIMARY KEY,
    name          TEXT    NOT NULL,
    oem_code      TEXT    UNIQUE,
    current_stock INTEGER NOT NULL DEFAULT 0,
    min_stock     INTEGER NOT NULL DEFAULT 20,
    unit_price    NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_oem  ON products(oem_code);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

CREATE TABLE IF NOT EXISTS sales (
    id             SERIAL PRIMARY KEY,
    product_id     INTEGER REFERENCES products(id),
    quantity       INTEGER NOT NULL,
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
    sale_id             INTEGER REFERENCES sales(id),
    product_id          INTEGER NOT NULL REFERENCES products(id),
    quantity            INTEGER NOT NULL,
    refund_amount       NUMERIC(12, 2) NOT NULL,
    exchange_product_id INTEGER REFERENCES products(id),
    returned_at         TIMESTAMPTZ DEFAULT NOW(),
    notes               TEXT
);

CREATE TABLE IF NOT EXISTS orders (
    id              SERIAL PRIMARY KEY,
    product_id      INTEGER REFERENCES products(id),
    quantity_needed INTEGER NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    notes           TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
    id          SERIAL PRIMARY KEY,
    amount      NUMERIC(12, 2) NOT NULL,
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

# Applied once at startup to add new columns to existing tables (idempotent).
MIGRATE_SQL = """
ALTER TABLE sales ADD COLUMN IF NOT EXISTS seller_type   TEXT NOT NULL DEFAULT 'individual';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_name TEXT;
"""


# ─── Dataclasses (for type hints in handlers) ─────────────────────────────────

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
