from dataclasses import dataclass
from typing import List, Optional
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
-- ─── Migration tracking ───────────────────────────────────────────────────────
-- Backfill UPDATEs are gated by this table so they run exactly once even though
-- MIGRATE_SQL itself executes on every bot restart.
CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id TEXT PRIMARY KEY,
    applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- Order priority: urgent | low  (legacy 'normal' rows already normalized to 'low')
ALTER TABLE orders ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'low';
-- Change column default so any future INSERT without explicit priority lands on 'low'.
ALTER TABLE orders ALTER COLUMN priority SET DEFAULT 'low';

-- part_name: human-readable product name stored directly on the order row so
-- freeform orders (product_id IS NULL) still carry a display name.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS part_name TEXT NOT NULL DEFAULT '';
-- Back-fill existing rows from the joined products table.
UPDATE orders o
SET part_name = COALESCE(p.name, '')
FROM products p
WHERE o.product_id = p.id
  AND (o.part_name IS NULL OR o.part_name = '');

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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE migration_id = 'normalize_order_priority') THEN
    UPDATE orders SET priority = 'low' WHERE priority = 'normal' OR priority IS NULL;
    INSERT INTO schema_migrations (migration_id) VALUES ('normalize_order_priority');
  END IF;
END $$;

-- clients: one row per Telegram user who has placed at least one order.
-- id = Telegram user ID (BIGINT — exceeds int32). Extra columns are optional
-- and populated lazily; only id is required for the FK on orders.client_id.
CREATE TABLE IF NOT EXISTS clients (
    id           BIGINT PRIMARY KEY,
    full_name    TEXT,
    username     TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_created_at ON clients(created_at DESC);

-- client_id: Telegram user ID of the person who placed the order.
-- Added as nullable so existing rows and fresh INSERTs without a known
-- requester are not rejected. Column type must be BIGINT — Telegram user IDs
-- exceed int32 range (max 2 147 483 647).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_id BIGINT;
ALTER TABLE orders ALTER COLUMN client_id TYPE BIGINT;
ALTER TABLE orders ALTER COLUMN client_id DROP NOT NULL;

-- Ensure FK exists only if the clients table is present.
-- Idempotent: skips if the constraint already exists.
DO $$ BEGIN
  ALTER TABLE orders
    ADD CONSTRAINT orders_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Recommended selling price set by the Import module (landed cost × margin).
-- NULL means no price has been set yet via the import calculator.
ALTER TABLE products ADD COLUMN IF NOT EXISTS recommended_price NUMERIC(12, 2);

-- Accrued liability tracking: is_paid=true means cash already left the account.
-- Import consumables are inserted with is_paid=false (unpaid supplier invoice).
-- Only paid expenses should be deducted from cash/bank balances.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_expenses_is_paid ON expenses(is_paid) WHERE is_paid = FALSE;

-- Non-cash inventory write-offs (shortages from stock count).
-- When TRUE: the expense hits the P&L (DR 7500) but NO cash/bank account is
-- touched — the credit goes to Inventory (CR 1600), not to Cash or AP.
-- These rows must NEVER be included in Cash/Bank balance deductions.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_non_cash BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_expenses_is_non_cash ON expenses(is_non_cash) WHERE is_non_cash = TRUE;

-- Catalog / MDM fields: product category and compatibility notes.
-- category:            free-text type/group (e.g. 'ფილტრი', 'სარკე', 'გარდამბეჭდი')
-- compatibility_notes: vehicle compatibility or any extra info shown in catalog
ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS compatibility_notes TEXT;

-- Accounts Receivable / Debtors: explicit debt tracking.
-- client_name:    name of the debtor extracted from the debt keyword (ვალი + name).
-- payment_status: 'paid' (default — all cash/transfer sales), 'debt' (outstanding credit
--                 explicitly marked with ვალი/debt keyword in the sales message),
--                 'unpaid' (reserved for partial payments or accrued liabilities).
-- Debt sales route through payment_method='credit' → AR account 1400 in the ledger,
-- keeping Cash/Bank balances untouched until the debt is collected via the dashboard.
ALTER TABLE sales         ADD COLUMN IF NOT EXISTS client_name    TEXT;
ALTER TABLE sales         ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'paid';
ALTER TABLE deleted_sales ADD COLUMN IF NOT EXISTS client_name    TEXT;
ALTER TABLE deleted_sales ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'paid';

CREATE INDEX IF NOT EXISTS idx_sales_payment_status ON sales(payment_status) WHERE payment_status = 'debt';

-- Explicit COGS column: quantity × WAC at time of sale (same value as
-- cost_amount, kept as a named alias so reports can reference it directly).
-- cost_amount remains for reversal / ledger-posting backward compatibility.
ALTER TABLE sales         ADD COLUMN IF NOT EXISTS cogs NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE deleted_sales ADD COLUMN IF NOT EXISTS cogs NUMERIC(14, 2) NOT NULL DEFAULT 0;
-- Back-fill cogs from cost_amount (runs once).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE migration_id = 'backfill_cogs') THEN
    UPDATE sales         SET cogs = cost_amount WHERE cogs = 0 AND cost_amount > 0;
    UPDATE deleted_sales SET cogs = cost_amount WHERE cogs = 0 AND cost_amount > 0;
    INSERT INTO schema_migrations (migration_id) VALUES ('backfill_cogs');
  END IF;
END $$;

-- Output VAT (18%) extracted from VAT-inclusive sale price: total - total/1.18
-- Always computed at sale time regardless of is_vat_included flag.
ALTER TABLE sales         ADD COLUMN IF NOT EXISTS output_vat NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE deleted_sales ADD COLUMN IF NOT EXISTS output_vat NUMERIC(14, 2) NOT NULL DEFAULT 0;

-- VAT ledger: strict single-entry log of all VAT movements.
-- amount > 0  → input VAT (recoverable, paid on imports)
-- amount < 0  → output VAT (payable, collected on sales)
-- Net VAT payable for a period = ABS(SUM(amount)) when sum is negative.
CREATE TABLE IF NOT EXISTS vat_ledger (
    id               SERIAL PRIMARY KEY,
    transaction_type TEXT           NOT NULL,
    amount           NUMERIC(14, 2) NOT NULL,
    reference_id     TEXT,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT vat_ledger_type_check CHECK (
        transaction_type IN ('import_vat', 'sales_vat', 'vat_payment')
    )
);

CREATE INDEX IF NOT EXISTS idx_vat_ledger_created_at ON vat_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_vat_ledger_type       ON vat_ledger(transaction_type);
CREATE INDEX IF NOT EXISTS idx_vat_ledger_reference  ON vat_ledger(reference_id);

-- Expense category default: ensure existing NULLs and future rows without an
-- explicit category land on 'general' rather than NULL.
ALTER TABLE expenses ALTER COLUMN category SET DEFAULT 'general';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE migration_id = 'backfill_expense_category') THEN
    UPDATE expenses SET category = 'general' WHERE category IS NULL OR category = '';
    INSERT INTO schema_migrations (migration_id) VALUES ('backfill_expense_category');
  END IF;
END $$;

-- Normalise seller_type: wizard previously stored 'company' instead of 'llc'.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE migration_id = 'normalize_seller_type') THEN
    UPDATE sales SET seller_type = 'llc' WHERE seller_type = 'company';
    INSERT INTO schema_migrations (migration_id) VALUES ('normalize_seller_type');
  END IF;
END $$;

-- Back-fill output_vat for LLC sales where it was never computed at sale time.
UPDATE sales
SET output_vat = ROUND(unit_price * quantity - (unit_price * quantity) / 1.18, 2)
WHERE seller_type = 'llc' AND output_vat = 0;

-- Back-fill vat_ledger entries for LLC sales that have none (preserves original sold_at).
INSERT INTO vat_ledger (transaction_type, amount, reference_id, created_at)
SELECT
  'sales_vat',
  -s.output_vat,
  'sale:' || s.id::text,
  s.sold_at
FROM sales s
LEFT JOIN vat_ledger vl
  ON vl.reference_id = 'sale:' || s.id::text
  AND vl.transaction_type = 'sales_vat'
WHERE s.seller_type = 'llc'
  AND vl.id IS NULL
  AND s.output_vat > 0;

-- Reclassify VAT in the double-entry ledger: move VAT portion from 6100 to 3330.
-- Only runs for LLC sales that don't already have a reclassification entry.
INSERT INTO ledger (account_code, debit_amount, credit_amount, description, reference_id)
SELECT
  '6100', s.output_vat, 0,
  'VAT reclassification — Sale #' || s.id::text,
  'vat_reclass:sale:' || s.id::text
FROM sales s
LEFT JOIN ledger l ON l.reference_id = 'vat_reclass:sale:' || s.id::text
WHERE s.seller_type = 'llc' AND s.output_vat > 0 AND l.id IS NULL;

INSERT INTO ledger (account_code, debit_amount, credit_amount, description, reference_id)
SELECT
  '3330', 0, s.output_vat,
  'VAT reclassification — Sale #' || s.id::text,
  'vat_reclass:sale:' || s.id::text
FROM sales s
LEFT JOIN ledger l
  ON l.reference_id = 'vat_reclass:sale:' || s.id::text
  AND l.account_code = '3330'
WHERE s.seller_type = 'llc' AND s.output_vat > 0 AND l.id IS NULL;

-- Structured vehicle compatibility per product (model, drive, engine, year range).
CREATE TABLE IF NOT EXISTS product_compatibility (
  id         SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  model      TEXT NOT NULL,
  drive      TEXT,
  engine     TEXT,
  year_from  INTEGER,
  year_to    INTEGER
);
CREATE INDEX IF NOT EXISTS product_compatibility_product_id_idx ON product_compatibility(product_id);

-- Fuel type field for compatibility entries (ბენზინი / დიზელი / ჰიბრიდი).
ALTER TABLE product_compatibility ADD COLUMN IF NOT EXISTS fuel_type TEXT;

-- ─── Selling entity / buyer type split ───────────────────────────────────────
-- seller_type already captures WHICH ENTITY IS SELLING ('llc' | 'individual').
-- buyer_type captures WHO IS BUYING ('retail' | 'business').
-- Only LLC sales enter formal accounting. ფ.პ sales appear in management reports only.
ALTER TABLE sales         ADD COLUMN IF NOT EXISTS buyer_type TEXT NOT NULL DEFAULT 'retail';
ALTER TABLE deleted_sales ADD COLUMN IF NOT EXISTS buyer_type TEXT NOT NULL DEFAULT 'retail';

-- Business customers: each gets a sequential sub-account under 1410 (starting at 2).
-- 1410 1 = retail (fixed), 1410 2, 1410 3, ... = individual business customers.
CREATE SEQUENCE IF NOT EXISTS business_customer_account_seq START 2;
CREATE TABLE IF NOT EXISTS business_customers (
    id             SERIAL PRIMARY KEY,
    name           TEXT           NOT NULL UNIQUE,
    account_number INTEGER        NOT NULL UNIQUE DEFAULT nextval('business_customer_account_seq'),
    created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_business_customers_name ON business_customers(name);

-- Reverse ledger entries for ფ.პ outstanding debt sales (payment_status='debt',
-- seller_type='individual'). These should not be in formal accounting.
-- Idempotent: skips rows already reversed (checked by reference_id prefix).
INSERT INTO ledger (account_code, debit_amount, credit_amount, description, reference_id, transaction_date)
SELECT
    l.account_code,
    l.credit_amount,
    l.debit_amount,
    'FZ_REVERSAL: ' || COALESCE(l.description, ''),
    'fz_reversal:' || l.id::text,
    NOW()
FROM ledger l
INNER JOIN sales s ON l.reference_id = 'sale:' || s.id::text
WHERE s.seller_type = 'individual'
  AND s.payment_status = 'debt'
  AND NOT EXISTS (
      SELECT 1 FROM ledger l2
      WHERE l2.reference_id = 'fz_reversal:' || l.id::text
  );

-- ─── Personal orders (owner-to-customer, outside company accounting) ─────────
-- tracking_token: 32-char hex string sent to the customer as a public link.
-- Financial fields (cost_price, transportation_cost, vat_amount) are owner-only.
-- status: ordered → in_transit → arrived → delivered | cancelled
CREATE TABLE IF NOT EXISTS personal_orders (
    id                 SERIAL PRIMARY KEY,
    tracking_token     TEXT           UNIQUE NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
    customer_name      TEXT           NOT NULL,
    customer_contact   TEXT,
    part_name          TEXT           NOT NULL,
    oem_code           TEXT,
    cost_price         NUMERIC(12, 2),
    transportation_cost NUMERIC(12, 2),
    vat_amount         NUMERIC(12, 2),
    sale_price         NUMERIC(12, 2) NOT NULL,
    amount_paid        NUMERIC(12, 2) NOT NULL DEFAULT 0,
    status             TEXT           NOT NULL DEFAULT 'ordered',
    estimated_arrival  DATE,
    notes              TEXT,
    created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT personal_orders_status_check CHECK (
        status IN ('ordered', 'in_transit', 'arrived', 'delivered', 'cancelled')
    ),
    CONSTRAINT personal_orders_sale_price_positive CHECK (sale_price > 0),
    CONSTRAINT personal_orders_amount_paid_non_negative CHECK (amount_paid >= 0)
);

CREATE INDEX IF NOT EXISTS idx_personal_orders_token      ON personal_orders(tracking_token);
CREATE INDEX IF NOT EXISTS idx_personal_orders_created_at ON personal_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_personal_orders_status     ON personal_orders(status);

ALTER TABLE personal_orders ADD COLUMN IF NOT EXISTS sale_price_min NUMERIC(12, 2);
ALTER TABLE personal_orders ADD COLUMN IF NOT EXISTS telegram_chat_id    BIGINT;
ALTER TABLE personal_orders ADD COLUMN IF NOT EXISTS telegram_message_id BIGINT;
ALTER TABLE personal_orders ADD COLUMN IF NOT EXISTS sale_price_currency VARCHAR(3) NOT NULL DEFAULT 'GEL';
ALTER TABLE personal_orders ADD COLUMN IF NOT EXISTS amount_paid_currency VARCHAR(3) NOT NULL DEFAULT 'GEL';

CREATE TABLE IF NOT EXISTS personal_order_items (
    id         SERIAL PRIMARY KEY,
    order_id   INTEGER NOT NULL REFERENCES personal_orders(id) ON DELETE CASCADE,
    part_name  TEXT    NOT NULL,
    oem_code   TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_order_items_order ON personal_order_items(order_id);

-- Migrate existing single-part data into the items table (idempotent)
INSERT INTO personal_order_items (order_id, part_name, oem_code)
SELECT o.id, o.part_name, o.oem_code
FROM personal_orders o
WHERE o.part_name IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM personal_order_items i WHERE i.order_id = o.id
  );

-- ─── imports_history: supplier / invoice / invoice-rate columns ───────────────
-- Optional Excel columns 10–13 that allow grouping by supplier+invoice and
-- comparing the invoice-date exchange rate against the declaration-date rate.
ALTER TABLE imports_history ADD COLUMN IF NOT EXISTS supplier              TEXT;
ALTER TABLE imports_history ADD COLUMN IF NOT EXISTS invoice_number        TEXT;
ALTER TABLE imports_history ADD COLUMN IF NOT EXISTS invoice_date          DATE;
ALTER TABLE imports_history ADD COLUMN IF NOT EXISTS invoice_exchange_rate NUMERIC(10, 4)
    CHECK (invoice_exchange_rate IS NULL OR invoice_exchange_rate > 0);

CREATE INDEX IF NOT EXISTS idx_imports_history_supplier ON imports_history(supplier)
    WHERE supplier IS NOT NULL;

-- How many units were actually placed with the supplier (may be less than quantity_needed).
-- quantity_needed - quantity_ordered = remaining units still to be ordered.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity_ordered INTEGER NOT NULL DEFAULT 0;

-- ─── Product images (multi-image gallery) ────────────────────────────────────
-- Each product can have many images. position controls display order.
-- The legacy products.image_url is kept as the "primary" image and is also
-- stored as the first row in product_images for backwards compatibility.
CREATE TABLE IF NOT EXISTS product_images (
    id         SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    url        TEXT    NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, position);

-- Back-fill: every product that has image_url but no product_images row gets one
INSERT INTO product_images (product_id, url, position)
SELECT p.id, p.image_url, 0
FROM products p
WHERE p.image_url IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id);

-- ─── Public catalog fields ────────────────────────────────────────────────────
-- slug:         URL-friendly identifier, auto-generated from name + oem_code.
-- is_published: only published products appear in the public catalog (default: hidden).
-- description:  long-form product description shown on the detail page.
-- image_url:    primary product image URL (multi-image support added later if needed).
ALTER TABLE products ADD COLUMN IF NOT EXISTS slug         TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS description  TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url    TEXT;

-- Unique index serves both UNIQUE enforcement and slug lookup performance.
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_slug ON products(slug);

-- Backfill slugs for existing products (Georgian → Latin transliteration, URL-safe).
-- Runs only for rows where slug IS NULL so re-runs are safe.
DO $$
DECLARE
  v_base    TEXT;
  v_slug    TEXT;
  v_counter INT;
  prod      RECORD;
BEGIN
  FOR prod IN
    SELECT id, name, oem_code FROM products WHERE slug IS NULL ORDER BY id
  LOOP
    v_base := prod.name || COALESCE(' ' || prod.oem_code, '');

    -- Multi-char Georgian → Latin (must run before single-char translate)
    v_base := replace(v_base, 'ჟ', 'zh');
    v_base := replace(v_base, 'შ', 'sh');
    v_base := replace(v_base, 'ჩ', 'ch');
    v_base := replace(v_base, 'ც', 'ts');
    v_base := replace(v_base, 'ძ', 'dz');
    v_base := replace(v_base, 'წ', 'ts');
    v_base := replace(v_base, 'ჭ', 'ch');
    v_base := replace(v_base, 'ხ', 'kh');
    v_base := replace(v_base, 'ღ', 'gh');

    -- Single-char Georgian → Latin (1-to-1; source and dest are both 23 chars)
    -- ა→a ბ→b გ→g დ→d ე→e ვ→v ზ→z თ→t ი→i კ→k ლ→l მ→m ნ→n ო→o პ→p რ→r ს→s ტ→t უ→u ფ→p ქ→k ყ→q ჰ→h
    v_base := translate(v_base,
      'აბგდევზთიკლმნოპრსტუფქყჰ',
      'abgdevztiklmnoprstupkqh'
    );

    -- Lowercase (normalises Latin chars from OEM codes like HU7009Z)
    v_base := lower(v_base);
    -- Collapse any non-alphanumeric run into a single hyphen
    v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
    -- Strip leading/trailing hyphens
    v_base := trim(both '-' from v_base);

    -- Fallback for products whose name+oem produced an empty string
    IF v_base = '' THEN
      v_base := 'product-' || prod.id::text;
    END IF;

    -- Resolve slug collisions by appending -2, -3, …
    v_slug    := v_base;
    v_counter := 2;
    WHILE EXISTS (SELECT 1 FROM products WHERE slug = v_slug) LOOP
      v_slug    := v_base || '-' || v_counter;
      v_counter := v_counter + 1;
    END LOOP;

    UPDATE products SET slug = v_slug WHERE id = prod.id;
  END LOOP;
END $$;

-- clients table was sometimes created with only (id, created_at) before full_name/username
-- were added. These idempotent ALTERs ensure the columns exist regardless.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS username  TEXT;

-- ─── catalog_orders: orders placed by customers via the public catalog ────────
-- Kept separate from `orders` (owner's internal supply management).
-- status: new → confirmed → fulfilled | cancelled
CREATE TABLE IF NOT EXISTS catalog_orders (
    id              SERIAL PRIMARY KEY,
    product_id      INTEGER REFERENCES products(id) ON DELETE SET NULL,
    product_name    TEXT           NOT NULL,
    oem_code        TEXT,
    price           NUMERIC(12, 2) NOT NULL,
    quantity        INTEGER        NOT NULL DEFAULT 1,
    status          TEXT           NOT NULL DEFAULT 'new',
    client_id       BIGINT         REFERENCES clients(id) ON DELETE SET NULL,
    client_name     TEXT,
    client_username TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT catalog_orders_status_check CHECK (
        status IN ('new', 'confirmed', 'fulfilled', 'cancelled')
    )
);

CREATE INDEX IF NOT EXISTS idx_catalog_orders_created_at ON catalog_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_orders_status     ON catalog_orders(status);
CREATE INDEX IF NOT EXISTS idx_catalog_orders_client_id  ON catalog_orders(client_id);

-- updated_at for products (used by sitemap for lastModified)
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products(updated_at DESC);

-- item_type: inventory (საქონელი) | fixed_asset (ძირ. საშ.) | consumable (სახარჯი)
ALTER TABLE products ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'inventory';

-- backfill from most recent import_items entry per product
UPDATE products p
SET item_type = sub.item_type
FROM (
  SELECT DISTINCT ON (product_id) product_id, item_type
  FROM import_items
  WHERE item_type IS NOT NULL
  ORDER BY product_id, id DESC
) sub
WHERE sub.product_id = p.id
  AND p.item_type = 'inventory';

-- Lost search log: every zero-result catalog search is recorded here.
-- Used as a shopping list for items to import next.
CREATE TABLE IF NOT EXISTS lost_searches (
    id               SERIAL PRIMARY KEY,
    query            TEXT           NOT NULL,
    source           TEXT           NOT NULL DEFAULT 'catalog',
    results_count    INTEGER        NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lost_searches_created ON lost_searches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lost_searches_query   ON lost_searches(LOWER(query));

-- Permanent archive of deleted expenses (no expiry).
CREATE TABLE IF NOT EXISTS deleted_expenses (
    id                  SERIAL PRIMARY KEY,
    original_expense_id INTEGER,
    amount              NUMERIC(12,2) NOT NULL,
    description         TEXT,
    category            TEXT,
    payment_method      TEXT NOT NULL DEFAULT 'cash',
    is_paid             BOOLEAN NOT NULL DEFAULT TRUE,
    is_non_cash         BOOLEAN NOT NULL DEFAULT FALSE,
    vat_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_vat_included     BOOLEAN NOT NULL DEFAULT FALSE,
    topic_id            INTEGER,
    topic_message_id    INTEGER,
    deleted_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deleted_expenses_deleted_at ON deleted_expenses(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_deleted_expenses_original   ON deleted_expenses(original_expense_id);

-- Before-snapshot stored on every sale edit (old values, inside transaction).
CREATE TABLE IF NOT EXISTS sale_edits (
    id              SERIAL PRIMARY KEY,
    sale_id         INTEGER NOT NULL,
    quantity        INTEGER NOT NULL,
    unit_price      NUMERIC(12,2) NOT NULL,
    payment_method  TEXT NOT NULL,
    seller_type     TEXT NOT NULL DEFAULT 'individual',
    customer_name   TEXT,
    notes           TEXT,
    product_id      INTEGER,
    edited_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sale_edits_sale_id   ON sale_edits(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_edits_edited_at ON sale_edits(edited_at DESC);

-- Before-snapshot stored on every expense edit (old values, inside transaction).
CREATE TABLE IF NOT EXISTS expense_edits (
    id              SERIAL PRIMARY KEY,
    expense_id      INTEGER NOT NULL,
    amount          NUMERIC(12,2) NOT NULL,
    description     TEXT,
    category        TEXT,
    payment_method  TEXT NOT NULL DEFAULT 'cash',
    edited_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expense_edits_expense_id ON expense_edits(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_edits_edited_at  ON expense_edits(edited_at DESC);

-- ─── #27: Missing indexes on returns table ────────────────────────────────────
-- Queries that look up returns by product or sale were doing full-table scans.
CREATE INDEX IF NOT EXISTS idx_returns_product_id ON returns(product_id);
CREATE INDEX IF NOT EXISTS idx_returns_sale_id    ON returns(sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_returns_returned_at ON returns(returned_at DESC);
"""


# ─── TypedDict — type-safe dict shapes returned by db.py ─────────────────────
# These let handlers use typed access (e.g. product["id"]) with IDE support
# and mypy validation, without requiring a full ORM migration.

class ClientRow(TypedDict):
    id: int  # Telegram user ID
    full_name: Optional[str]
    username: Optional[str]
    created_at: object  # datetime


class ProductRow(TypedDict):
    id: int
    name: str
    oem_code: Optional[str]
    current_stock: int
    min_stock: int
    unit_price: float
    unit: str
    recommended_price: Optional[float]
    category: Optional[str]
    compatibility_notes: Optional[str]
    slug: Optional[str]
    is_published: bool
    description: Optional[str]
    image_url: Optional[str]
    item_type: str  # 'inventory' | 'fixed_asset' | 'consumable'
    created_at: object  # datetime in practice
    updated_at: object  # datetime in practice


class SaleRow(TypedDict):
    id: int
    product_id: Optional[int]
    quantity: int
    unit_price: float
    payment_method: str
    seller_type: str   # 'llc' | 'individual' — which entity is SELLING
    buyer_type: str    # 'retail' | 'business' — who is BUYING
    customer_name: Optional[str]
    client_name: Optional[str]    # debtor name extracted from ვალი keyword
    payment_status: str           # 'paid' | 'debt' | 'unpaid'
    sold_at: object  # datetime
    notes: Optional[str]
    receipt_printed: bool
    topic_id: Optional[int]
    topic_message_id: Optional[int]
    vat_amount: float
    is_vat_included: bool
    output_vat: float   # 18% VAT extracted from VAT-inclusive total: total - total/1.18
    cost_amount: float  # COGS snapshot (WAC at time of sale); used for reversals
    cogs: float         # Explicit COGS alias: quantity × unit_cost
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
    priority: str  # urgent | low
    created_at: object  # datetime
    notes: Optional[str]
    part_name: str  # name stored on the order row itself (always present)
    product_name: Optional[str]  # joined from products (may be None)
    oem_code: Optional[str]


class ExpenseRow(TypedDict):
    id: int
    amount: float
    description: Optional[str]
    category: Optional[str]
    created_at: object  # datetime
    vat_amount: float
    is_vat_included: bool
    is_paid: bool
    is_non_cash: bool  # True = inventory write-off; never deducts cash/bank


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
    supplier: Optional[str]
    invoice_number: Optional[str]
    invoice_date: Optional[object]  # date
    invoice_exchange_rate: Optional[float]
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


class PersonalOrderItemRow(TypedDict):
    id: int
    part_name: str
    oem_code: Optional[str]


class PersonalOrderRow(TypedDict):
    id: int
    tracking_token: str
    customer_name: str
    customer_contact: Optional[str]
    part_name: str
    oem_code: Optional[str]
    cost_price: Optional[float]
    transportation_cost: Optional[float]
    vat_amount: Optional[float]
    sale_price_min: Optional[float]
    sale_price: float
    sale_price_currency: str
    amount_paid: float
    amount_paid_currency: str
    status: str
    estimated_arrival: Optional[object]  # date
    notes: Optional[str]
    created_at: object  # datetime
    updated_at: object  # datetime
    items: List[PersonalOrderItemRow]
    telegram_chat_id: Optional[int]
    telegram_message_id: Optional[int]


class DeletedExpenseRow(TypedDict):
    id: int
    original_expense_id: Optional[int]
    amount: float
    description: Optional[str]
    category: Optional[str]
    payment_method: str
    is_paid: bool
    is_non_cash: bool
    vat_amount: float
    is_vat_included: bool
    topic_id: Optional[int]
    topic_message_id: Optional[int]
    deleted_at: object  # datetime


class SaleEditRow(TypedDict):
    id: int
    sale_id: int
    quantity: int
    unit_price: float
    payment_method: str
    seller_type: str
    customer_name: Optional[str]
    notes: Optional[str]
    product_id: Optional[int]
    edited_at: object  # datetime


class ExpenseEditRow(TypedDict):
    id: int
    expense_id: int
    amount: float
    description: Optional[str]
    category: Optional[str]
    payment_method: str
    edited_at: object  # datetime


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
