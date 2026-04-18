import "server-only";
import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

export type StatementEntry = {
  date: string | null;
  description: string;
  credit: number;
  debit: number;
  balance: number;
};

export type AccountStatement = {
  account_key: string;
  account_name: string;
  currency: string;
  entries: StatementEntry[];
};

const VALID_KEYS = new Set(["cash_gel", "cash_usd", "bank_gel", "bank_usd"]);

// ---------------------------------------------------------------------------
// GET /api/account-balances/[accountKey]/statement
// Returns initial balance row + all transactions with running balance.
// cash_gel / cash_usd → payment_method = 'cash'
// bank_gel / bank_usd → payment_method = 'transfer'
// USD accounts have no transaction rows (only initial balance tracked).
// ---------------------------------------------------------------------------
export async function GET(
  _req: Request,
  { params }: { params: { accountKey: string } },
) {
  const { accountKey } = params;

  if (!VALID_KEYS.has(accountKey)) {
    return NextResponse.json({ error: "invalid account key" }, { status: 400 });
  }

  try {
    const account = await queryOne<{
      account_key: string;
      account_name: string;
      currency: string;
      initial_balance: string;
    }>(
      `SELECT account_key, account_name, currency, initial_balance
       FROM account_balances
       WHERE account_key = $1`,
      [accountKey],
    );

    if (!account) {
      return NextResponse.json({ error: "account not found" }, { status: 404 });
    }

    const initialBalance = Number(account.initial_balance);
    const isUSD = account.currency === "USD";
    const pmMethod = accountKey.startsWith("cash") ? "cash" : "transfer";

    type TxnRow = {
      txn_date: string;
      description: string;
      credit: string;
      debit: string;
    };

    let rawRows: TxnRow[] = [];

    if (!isUSD) {
      rawRows = await query<TxnRow>(
        `SELECT
           sold_at AS txn_date,
           'გაყიდვა #' || id::text AS description,
           (quantity * unit_price)::numeric AS credit,
           0::numeric AS debit
         FROM sales
         WHERE payment_method = $1

         UNION ALL

         SELECT
           created_at AS txn_date,
           'ხარჯი: ' || description AS description,
           0::numeric AS credit,
           amount::numeric AS debit
         FROM expenses
         WHERE payment_method = $1

         ORDER BY txn_date ASC`,
        [pmMethod],
      );
    }

    const entries: StatementEntry[] = [];
    let running = initialBalance;

    entries.push({
      date: null,
      description: "საწყისი ნაშთი",
      credit: initialBalance > 0 ? initialBalance : 0,
      debit: initialBalance < 0 ? Math.abs(initialBalance) : 0,
      balance: initialBalance,
    });

    for (const row of rawRows) {
      const credit = Number(row.credit);
      const debit = Number(row.debit);
      running = running + credit - debit;
      entries.push({
        date: row.txn_date,
        description: row.description,
        credit,
        debit,
        balance: running,
      });
    }

    const result: AccountStatement = {
      account_key: account.account_key,
      account_name: account.account_name,
      currency: account.currency,
      entries,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[statement] GET error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
