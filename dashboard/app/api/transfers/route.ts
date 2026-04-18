import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID_ACCOUNTS = new Set(["cash_gel", "cash_usd", "bank_gel", "bank_usd"]);

export type Transfer = {
  id: number;
  amount: number;
  currency: string;
  from_account: string;
  to_account: string;
  note: string | null;
  created_at: string;
};

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS transfers (
      id           SERIAL PRIMARY KEY,
      amount       NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      currency     TEXT           NOT NULL DEFAULT 'GEL',
      from_account TEXT           NOT NULL,
      to_account   TEXT           NOT NULL,
      note         TEXT,
      created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
      CONSTRAINT transfers_different_accounts CHECK (from_account <> to_account)
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_transfers_created_at ON transfers(created_at DESC)
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_transfers_from ON transfers(from_account)
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_transfers_to ON transfers(to_account)
  `);
}

// GET /api/transfers — list all transfers newest-first
export async function GET() {
  try {
    await ensureTable();
    const rows = await query<{
      id: string;
      amount: string;
      currency: string;
      from_account: string;
      to_account: string;
      note: string | null;
      created_at: string;
    }>(`SELECT * FROM transfers ORDER BY created_at DESC LIMIT 200`);

    const transfers: Transfer[] = rows.map((r) => ({
      id: Number(r.id),
      amount: Number(r.amount),
      currency: r.currency,
      from_account: r.from_account,
      to_account: r.to_account,
      note: r.note,
      created_at: r.created_at,
    }));

    return NextResponse.json(transfers);
  } catch (err) {
    console.error("[transfers] GET error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

// POST /api/transfers — create a new transfer
// Body: { from_account, to_account, amount, currency?, note? }
export async function POST(req: NextRequest) {
  try {
    await ensureTable();

    const body = await req.json();
    const { from_account, to_account, amount, currency = "GEL", note = null } = body;

    if (
      typeof from_account !== "string" ||
      !VALID_ACCOUNTS.has(from_account) ||
      typeof to_account !== "string" ||
      !VALID_ACCOUNTS.has(to_account) ||
      from_account === to_account
    ) {
      return NextResponse.json(
        { error: "from_account და to_account სხვადასხვა და სწორი უნდა იყოს" },
        { status: 400 },
      );
    }

    const parsed = Number(amount);
    if (!isFinite(parsed) || parsed <= 0) {
      return NextResponse.json(
        { error: "amount დადებითი რიცხვი უნდა იყოს" },
        { status: 400 },
      );
    }

    const row = await queryOne<{ id: string }>(
      `INSERT INTO transfers (from_account, to_account, amount, currency, note)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [from_account, to_account, parsed, currency, note],
    );

    return NextResponse.json({ id: Number(row?.id), ok: true }, { status: 201 });
  } catch (err) {
    console.error("[transfers] POST error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
