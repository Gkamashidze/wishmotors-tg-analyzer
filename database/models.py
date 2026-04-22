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

-- ─── Ledger (double-entry bookkeeping) ───────────────────────────────────────
-- One row = one posting. A business transaction is stored as ≥2 rows that
-- balance (sum of debits == sum of credits). Each row is single-sided:
-- either debit_amount > 0 XOR credit_amount > 0.
CREATE TABLE IF NOT EXISTS ledger (
    id               SERIAL PRIMARY KEY,
    transaction_date TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    account_code     TEXT           NOT NULL,
    debit_amount     NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (debit_amount  >= 0),
    credit_amount    NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
    description      TEXT,
    reference_id     TEXT,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT ledger_single_sided CHECK (
        (debit_amount > 0 AND credit_amount = 0)
        OR (credit_amount > 0 AND debit_amount = 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_ledger_txn_date    ON ledger(transaction_date);
CREATE INDEX IF NOT EXISTS idx_ledger_account     ON ledger(account_code, transaction_date);
CREATE INDEX IF NOT EXISTS idx_ledger_reference   ON ledger(reference_id);

-- ─── Inventory batches (WAC — weighted average cost) ─────────────────────────
-- Each purchase / receipt creates one batch. WAC per product is computed as
--   SUM(remaining_quantity * unit_cost) / SUM(remaining_quantity)
-- across all active (remaining_quantity > 0) batches for that product.
-- quantity is NUMERIC so non-integer units (კგ, მ) are supported alongside 'ც'.
CREATE TABLE IF NOT EXISTS inventory_batches (
    id                  SERIAL PRIMARY KEY,
    product_id          INTEGER        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity            NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
    remaining_quantity  NUMERIC(14, 3) NOT NULL CHECK (remaining_quantity >= 0),
    unit_cost           NUMERIC(14, 4) NOT NULL CHECK (unit_cost >= 0),
    received_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    supplier            TEXT,
    reference           TEXT,
    notes               TEXT,
    CONSTRAINT inventory_batches_remaining_le_qty CHECK (remaining_quantity <= quantity)
);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_product  ON inventory_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_received ON inventory_batches(product_id, received_at);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_active
    ON inventory_batches(product_id) WHERE remaining_quantity > 0;
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

ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_id      INTEGER REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity_needed INTEGER NOT NULL DEFAULT 1;

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

-- Unit of measure for products (ცალი, ლიტრი, კომპლექტი, კგ, მ, etc.)
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'ცალი';
ALTER TABLE products ALTER COLUMN unit SET DEFAULT 'ცალი';

-- Track whether a company (შპს) sale has been receipted at the cash register
ALTER TABLE sales ADD COLUMN IF NOT EXISTS receipt_printed BOOLEAN NOT NULL DEFAULT FALSE;

-- Order priority: urgent | normal | low
ALTER TABLE orders ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';

DO $$ BEGIN
  ALTER TABLE expenses ADD CONSTRAINT expenses_amount_positive CHECK (amount > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- COGS snapshot on each sale so deletions / returns can reverse the exact
-- cost originally posted to the ledger (WAC can drift after later receipts).
ALTER TABLE sales         ADD COLUMN IF NOT EXISTS cost_amount NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE deleted_sales ADD COLUMN IF NOT EXISTS cost_amount NUMERIC(14, 2) NOT NULL DEFAULT 0;

-- Topic message tracking for orders and deleted_sales (so edit/cancel/restore
-- flows can update the original bot confirmation in the group topic).
ALTER TABLE orders        ADD COLUMN IF NOT EXISTS topic_id         INTEGER;
ALTER TABLE orders        ADD COLUMN IF NOT EXISTS topic_message_id INTEGER;
ALTER TABLE deleted_sales ADD COLUMN IF NOT EXISTS topic_message_id INTEGER;

-- OEM code stored directly on the order so freeform orders (product_id IS NULL)
-- still carry a machine-readable identifier visible in the dashboard.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS oem_code TEXT;

-- Ensure oem_code has a UNIQUE constraint (idempotent: catches both fresh
-- databases already carrying products_oem_code_key and re-runs of this migration).
DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_oem_code_unique UNIQUE (oem_code);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

-- Real-time immutable audit log: every write operation posts a JSON snapshot
-- here via a fire-and-forget background task (see database/audit_log.py).
-- Rows are NEVER updated or deleted — append-only for tamper evidence.
CREATE TABLE IF NOT EXISTS transaction_audit_log (
    id           BIGSERIAL    PRIMARY KEY,
    event_type   TEXT         NOT NULL,
    reference_id TEXT,
    payload      JSONB        NOT NULL,
    checksum     TEXT         NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_event_type  ON transaction_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at  ON transaction_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_reference   ON transaction_audit_log(reference_id);

-- VAT (18%) tracking on sales and expenses
ALTER TABLE sales    ADD COLUMN IF NOT EXISTS vat_amount       NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE sales    ADD COLUMN IF NOT EXISTS is_vat_included  BOOLEAN        NOT NULL DEFAULT FALSE;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_amount       NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_vat_included  BOOLEAN        NOT NULL DEFAULT FALSE;

ALTER TABLE deleted_sales ADD COLUMN IF NOT EXISTS vat_amount      NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE deleted_sales ADD COLUMN IF NOT EXISTS is_vat_included BOOLEAN        NOT NULL DEFAULT FALSE;

-- Import cost history: one row per product per import batch.
-- Stores all cost components so WAC can be audited independently.
CREATE TABLE IF NOT EXISTS imports_history (
    id                         SERIAL PRIMARY KEY,
    import_date                DATE           NOT NULL,
    oem                        TEXT           NOT NULL,
    name                       TEXT           NOT NULL,
    quantity                   NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
    unit                       TEXT           NOT NULL DEFAULT 'ც',
    unit_price_usd             NUMERIC(12, 4) NOT NULL CHECK (unit_price_usd >= 0),
    exchange_rate              NUMERIC(10, 4) NOT NULL CHECK (exchange_rate > 0),
    transport_cost_gel         NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (transport_cost_gel >= 0),
    other_cost_gel             NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (other_cost_gel >= 0),
    total_unit_cost_gel        NUMERIC(12, 4) NOT NULL CHECK (total_unit_cost_gel >= 0),
    suggested_retail_price_gel NUMERIC(12, 4) NOT NULL CHECK (suggested_retail_price_gel >= 0),
    created_at                 TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_imports_history_date ON imports_history(import_date DESC);
CREATE INDEX IF NOT EXISTS idx_imports_history_oem  ON imports_history(oem);

-- Internal transfers between accounts (e.g. cash_gel → bank_gel).
-- Affects balance of both the source and destination account.
CREATE TABLE IF NOT EXISTS transfers (
    id           SERIAL PRIMARY KEY,
    amount       NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    currency     TEXT           NOT NULL DEFAULT 'GEL',
    from_account TEXT           NOT NULL,
    to_account   TEXT           NOT NULL,
    note         TEXT,
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT transfers_different_accounts CHECK (from_account <> to_account)
);

CREATE INDEX IF NOT EXISTS idx_transfers_created_at ON transfers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_from       ON transfers(from_account);
CREATE INDEX IF NOT EXISTS idx_transfers_to         ON transfers(to_account);

-- Refund method on returns: tracks whether money was given back as cash or bank transfer.
-- Used by the cashflow dashboard to deduct from the correct account.
ALTER TABLE returns ADD COLUMN IF NOT EXISTS refund_method TEXT NOT NULL DEFAULT 'cash';

-- Sale status: 'active' (default) or 'returned'.
-- Returned sales stay in the table for audit history but are excluded from all
-- revenue / cashflow calculations.  Use status != 'returned' in every query
-- that counts money or products sold.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status) WHERE status != 'active';

-- Normalize legacy 'normal' priority orders → 'low'.
-- Bot only ever creates 'urgent' or 'low'; 'normal' was the old DB default.
-- Idempotent: safe to run multiple times.
UPDATE orders SET priority = 'low' WHERE priority = 'normal' OR priority IS NULL;

-- client_id: Telegram user ID of the person who placed the order.
-- Added as nullable so existing rows and fresh INSERTs without a known
-- requester are not rejected. Column type must be BIGINT — Telegram user IDs
-- exceed int32 range (max 2 147 483 647).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_id BIGINT;
ALTER TABLE orders ALTER COLUMN client_id TYPE BIGINT;
ALTER TABLE orders ALTER COLUMN client_id DROP NOT NULL;
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
    topic_id: Optional[int]
    topic_message_id: Optional[int]
    vat_amount: float
    is_vat_included: bool
    # Joined fields (present in report queries)
    product_name: Optional[str]
    oem_code: Optional[str]


class ReturnRow(TypedDict):
    id: int
    sale_id: Optional[int]
    product_id: int
    quantity: int
    refund_amount: float
    refund_method: str  # 'cash' | 'bank'
    exchange_product_id: Optional[int]
    returned_at: object  # datetime
    notes: Optional[str]
    product_name: Optional[str]


class OrderRow(TypedDict):
    id: int
    product_id: Optional[int]
    client_id: Optional[int]
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
    vat_amount: float
    is_vat_included: bool


class ParseFailureRow(TypedDict):
    message_text: str
    occurrences: int
    last_seen: object  # datetime


class CashDepositRow(TypedDict):
    id: int
    amount: float
    note: Optional[str]
    created_at: object  # datetime


class TransferRow(TypedDict):
    id: int
    amount: float
    currency: str
    from_account: str
    to_account: str
    note: Optional[str]
    created_at: object  # datetime


class ImportHistoryRow(TypedDict):
    id: int
    import_date: object  # date
    oem: str
    name: str
    quantity: float
    unit: str
    unit_price_usd: float
    exchange_rate: float
    transport_cost_gel: float
    other_cost_gel: float
    total_unit_cost_gel: float
    suggested_retail_price_gel: float
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
