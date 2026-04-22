import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Ensure the table exists on first request
// ---------------------------------------------------------------------------
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS account_balances (
      id             SERIAL PRIMARY KEY,
      account_key    TEXT UNIQUE NOT NULL,
      account_name   TEXT NOT NULL,
      currency       TEXT NOT NULL,
      initial_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    INSERT INTO account_balances (account_key, account_name, currency, initial_balance)
    VALUES
      ('cash_gel', 'სალარო',             'GEL', 0),
      ('cash_usd', 'სალარო',             'USD', 0),
      ('bank_gel', 'საქართველოს ბანკი', 'GEL', 0),
      ('bank_usd', 'საქართველოს ბანკი', 'USD', 0)
    ON CONFLICT (account_key) DO NOTHING
  `);
}

export type AccountBalance = {
  account_key: string;
  account_name: string;
  currency: string;
  initial_balance: number;
  current_balance: number;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// GET /api/account-balances
// Returns all 4 accounts with computed current balances.
// GEL cash:  initial + SUM(cash sales) - SUM(cash expenses)
// GEL bank:  initial + SUM(transfer sales) - SUM(transfer expenses)
// USD accounts: initial_balance only (no USD transactions tracked)
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    await ensureTable();

    const rows = await query<{
      account_key: string;
      account_name: string;
      currency: string;
      initial_balance: string;
      current_balance: string;
      updated_at: string;
    }>(`
      WITH
        cash_sales AS (
          SELECT COALESCE(SUM(quantity * unit_price), 0) AS total
          FROM sales WHERE payment_method = 'cash' AND status != 'returned'
        ),
        cash_expenses AS (
          SELECT COALESCE(SUM(amount), 0) AS total
          FROM expenses WHERE payment_method = 'cash'
        ),
        transfer_sales AS (
          SELECT COALESCE(SUM(quantity * unit_price), 0) AS total
          FROM sales WHERE payment_method = 'transfer' AND status != 'returned'
        ),
        transfer_expenses AS (
          SELECT COALESCE(SUM(amount), 0) AS total
          FROM expenses WHERE payment_method = 'transfer'
        ),
        tr_cash_out AS (
          SELECT COALESCE(SUM(amount), 0) AS total
          FROM transfers WHERE from_account = 'cash_gel'
        ),
        tr_cash_in AS (
          SELECT COALESCE(SUM(amount), 0) AS total
          FROM transfers WHERE to_account = 'cash_gel'
        ),
        tr_bank_out AS (
          SELECT COALESCE(SUM(amount), 0) AS total
          FROM transfers WHERE from_account = 'bank_gel'
        ),
        tr_bank_in AS (
          SELECT COALESCE(SUM(amount), 0) AS total
          FROM transfers WHERE to_account = 'bank_gel'
        ),
        cash_returns AS (
          SELECT COALESCE(SUM(refund_amount), 0) AS total
          FROM returns WHERE COALESCE(refund_method, 'cash') = 'cash'
        ),
        bank_returns AS (
          SELECT COALESCE(SUM(refund_amount), 0) AS total
          FROM returns WHERE refund_method = 'bank'
        )
      SELECT
        ab.account_key,
        ab.account_name,
        ab.currency,
        ab.initial_balance,
        ab.updated_at,
        CASE
          WHEN ab.account_key = 'cash_gel'
            THEN ab.initial_balance + cs.total - ce.total - tco.total + tci.total - cr.total
          WHEN ab.account_key = 'bank_gel'
            THEN ab.initial_balance + ts.total - te.total - tbo.total + tbi.total - br.total
          ELSE ab.initial_balance
        END AS current_balance
      FROM account_balances ab
      CROSS JOIN cash_sales cs
      CROSS JOIN cash_expenses ce
      CROSS JOIN transfer_sales ts
      CROSS JOIN transfer_expenses te
      CROSS JOIN tr_cash_out tco
      CROSS JOIN tr_cash_in tci
      CROSS JOIN tr_bank_out tbo
      CROSS JOIN tr_bank_in tbi
      CROSS JOIN cash_returns cr
      CROSS JOIN bank_returns br
      ORDER BY ab.id
    `);

    const balances: AccountBalance[] = rows.map((r) => ({
      account_key: r.account_key,
      account_name: r.account_name,
      currency: r.currency,
      initial_balance: Number(r.initial_balance),
      current_balance: Number(r.current_balance),
      updated_at: r.updated_at,
    }));

    return NextResponse.json(balances);
  } catch (err) {
    console.error("[account-balances] GET error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/account-balances
// Body: { account_key: string; initial_balance: number }[]
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  try {
    await ensureTable();

    const body = await req.json();

    if (!Array.isArray(body) || body.length === 0) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const VALID_KEYS = new Set(["cash_gel", "cash_usd", "bank_gel", "bank_usd"]);

    for (const item of body) {
      if (
        typeof item.account_key !== "string" ||
        !VALID_KEYS.has(item.account_key) ||
        typeof item.initial_balance !== "number" ||
        !isFinite(item.initial_balance)
      ) {
        return NextResponse.json(
          { error: "invalid item: " + JSON.stringify(item) },
          { status: 400 },
        );
      }

      await queryOne(
        `UPDATE account_balances
         SET initial_balance = $1, updated_at = NOW()
         WHERE account_key = $2`,
        [item.initial_balance, item.account_key],
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[account-balances] PATCH error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
