import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS imports (
        id                   SERIAL PRIMARY KEY,
        date                 DATE NOT NULL DEFAULT CURRENT_DATE,
        supplier             VARCHAR(255) NOT NULL DEFAULT '',
        invoice_number       VARCHAR(100),
        exchange_rate        NUMERIC(10, 4) NOT NULL DEFAULT 1,
        total_transport_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
        total_terminal_cost  NUMERIC(12, 2) NOT NULL DEFAULT 0,
        total_agency_cost    NUMERIC(12, 2) NOT NULL DEFAULT 0,
        total_vat_cost       NUMERIC(12, 2) NOT NULL DEFAULT 0,
        document_url         TEXT,
        document_name        VARCHAR(255),
        status               VARCHAR(20) NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'completed')),
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS import_items (
        id                       SERIAL PRIMARY KEY,
        import_id                INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
        product_id               INTEGER NOT NULL REFERENCES products(id),
        quantity                 NUMERIC(12, 4) NOT NULL DEFAULT 0,
        unit                     VARCHAR(50) NOT NULL DEFAULT 'ცალი',
        unit_price_usd           NUMERIC(12, 4) NOT NULL DEFAULT 0,
        weight                   NUMERIC(12, 4) NOT NULL DEFAULT 0,
        total_price_usd          NUMERIC(12, 4),
        total_price_gel          NUMERIC(12, 4),
        allocated_transport_cost NUMERIC(12, 4),
        allocated_terminal_cost  NUMERIC(12, 4),
        allocated_agency_cost    NUMERIC(12, 4),
        allocated_vat_cost       NUMERIC(12, 4),
        landed_cost_per_unit_gel NUMERIC(12, 4),
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_erp_imports_status ON imports(status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_erp_imports_date   ON imports(date)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_erp_import_items   ON import_items(import_id)`);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[migrate-erp]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const rows = await query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'imports'
      ) AS exists
    `);
    return NextResponse.json({ tablesExist: rows[0]?.exists ?? false });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
