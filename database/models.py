from dataclasses import dataclass, field
from typing import Optional

# ─── SQL schema ───────────────────────────────────────────────────────────────

CREATE_TABLES_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    oem_code      TEXT,
    current_stock INTEGER NOT NULL DEFAULT 0,
    min_stock     INTEGER NOT NULL DEFAULT 20,
    unit_price    REAL    NOT NULL DEFAULT 0,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_oem  ON products(oem_code);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

CREATE TABLE IF NOT EXISTS sales (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id     INTEGER,
    quantity       INTEGER NOT NULL,
    sale_price     REAL    NOT NULL,
    payment_method TEXT    NOT NULL DEFAULT 'cash',
    sold_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes          TEXT,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_sales_sold_at    ON sales(sold_at);
CREATE INDEX IF NOT EXISTS idx_sales_product_id ON sales(product_id);

CREATE TABLE IF NOT EXISTS returns (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id             INTEGER,
    product_id          INTEGER NOT NULL,
    quantity            INTEGER NOT NULL,
    refund_amount       REAL    NOT NULL,
    exchange_product_id INTEGER,
    returned_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes               TEXT,
    FOREIGN KEY (sale_id)             REFERENCES sales(id),
    FOREIGN KEY (product_id)          REFERENCES products(id),
    FOREIGN KEY (exchange_product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id      INTEGER,
    quantity_needed INTEGER NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes           TEXT,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS expenses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    amount      REAL NOT NULL,
    description TEXT,
    category    TEXT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
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
    sale_price: float
    payment_method: str
    sold_at: str
    notes: Optional[str]


@dataclass
class ParsedSale:
    raw_product: str
    quantity: int
    price: float
    payment_method: str
    is_return: bool = False
    notes: str = ""
