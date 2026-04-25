import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await query(`
      ALTER TABLE accounting_partner_transactions
        ADD COLUMN IF NOT EXISTS currency        TEXT          NOT NULL DEFAULT 'GEL',
        ADD COLUMN IF NOT EXISTS original_amount NUMERIC(12,4),
        ADD COLUMN IF NOT EXISTS exchange_rate   NUMERIC(10,4) NOT NULL DEFAULT 1.0
    `);

    await query(`
      ALTER TABLE expenses
        ADD COLUMN IF NOT EXISTS currency        TEXT          NOT NULL DEFAULT 'GEL',
        ADD COLUMN IF NOT EXISTS original_amount NUMERIC(12,4),
        ADD COLUMN IF NOT EXISTS exchange_rate   NUMERIC(10,4) NOT NULL DEFAULT 1.0
    `);

    return NextResponse.json({ ok: true, message: "Multi-currency migration applied." });
  } catch (err) {
    console.error("[migrate-currency] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
