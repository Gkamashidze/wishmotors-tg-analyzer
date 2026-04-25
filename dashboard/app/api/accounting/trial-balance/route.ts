import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export type TrialBalanceRow = {
  account_code: string;
  account_name: string;
  account_type: string;
  opening_debit: number;
  opening_credit: number;
  period_debit: number;
  period_credit: number;
  closing_debit: number;
  closing_credit: number;
};

// GET /api/accounting/trial-balance?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");

  if (!fromStr || !toStr) {
    return NextResponse.json(
      { error: "from and to query params are required" },
      { status: 400 },
    );
  }

  const from = new Date(fromStr);
  const to = new Date(toStr + "T23:59:59.999Z");

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "invalid dates" }, { status: 400 });
  }

  if (to < from) {
    return NextResponse.json({ error: "'to' must be >= 'from'" }, { status: 400 });
  }

  const diffDays = (to.getTime() - from.getTime()) / 86_400_000;
  if (diffDays > 3660) {
    return NextResponse.json({ error: "date range cannot exceed 10 years" }, { status: 400 });
  }

  try {
    const rows = await query<{
      account_code: string;
      account_name: string | null;
      account_type: string | null;
      opening_debit: string;
      opening_credit: string;
      period_debit: string;
      period_credit: string;
    }>(`
      WITH
        -- Exclude ledger rows that belong to individual (FZ) sales.
        -- Sale rows carry reference_id = 'sale:<id>'; all other rows (batches,
        -- expenses, payments) have no sales.id match and are kept as-is.
        llc_ledger AS (
          SELECT l.*
          FROM ledger l
          LEFT JOIN sales s
            ON l.reference_id = 'sale:' || s.id::text
          WHERE s.id IS NULL OR s.seller_type = 'llc'
        ),
        opening AS (
          SELECT
            account_code,
            COALESCE(SUM(debit_amount),  0) AS debit,
            COALESCE(SUM(credit_amount), 0) AS credit
          FROM llc_ledger
          WHERE transaction_date < $1
          GROUP BY account_code
        ),
        period AS (
          SELECT
            account_code,
            COALESCE(SUM(debit_amount),  0) AS debit,
            COALESCE(SUM(credit_amount), 0) AS credit
          FROM llc_ledger
          WHERE transaction_date >= $1
            AND transaction_date <= $2
          GROUP BY account_code
        ),
        all_codes AS (
          SELECT account_code FROM opening
          UNION
          SELECT account_code FROM period
        )
      SELECT
        ac.account_code,
        coa.name        AS account_name,
        coa.type        AS account_type,
        COALESCE(o.debit,  0) AS opening_debit,
        COALESCE(o.credit, 0) AS opening_credit,
        COALESCE(p.debit,  0) AS period_debit,
        COALESCE(p.credit, 0) AS period_credit
      FROM all_codes ac
      LEFT JOIN opening o ON o.account_code = ac.account_code
      LEFT JOIN period  p ON p.account_code = ac.account_code
      LEFT JOIN chart_of_accounts coa ON coa.code = ac.account_code
      ORDER BY ac.account_code
    `, [from.toISOString(), to.toISOString()]);

    const result: TrialBalanceRow[] = rows.map((r) => {
      const openDebit   = Number(r.opening_debit);
      const openCredit  = Number(r.opening_credit);
      const periDebit   = Number(r.period_debit);
      const periCredit  = Number(r.period_credit);

      const closingDebit  = openDebit  + periDebit;
      const closingCredit = openCredit + periCredit;

      return {
        account_code:   r.account_code,
        account_name:   r.account_name ?? r.account_code,
        account_type:   r.account_type ?? "unknown",
        opening_debit:  openDebit,
        opening_credit: openCredit,
        period_debit:   periDebit,
        period_credit:  periCredit,
        closing_debit:  closingDebit,
        closing_credit: closingCredit,
      };
    });

    // Totals row
    const totals = result.reduce(
      (acc, r) => ({
        opening_debit:  acc.opening_debit  + r.opening_debit,
        opening_credit: acc.opening_credit + r.opening_credit,
        period_debit:   acc.period_debit   + r.period_debit,
        period_credit:  acc.period_credit  + r.period_credit,
        closing_debit:  acc.closing_debit  + r.closing_debit,
        closing_credit: acc.closing_credit + r.closing_credit,
      }),
      { opening_debit: 0, opening_credit: 0, period_debit: 0, period_credit: 0, closing_debit: 0, closing_credit: 0 },
    );

    return NextResponse.json({ rows: result, totals });
  } catch (err) {
    console.error("[trial-balance] GET error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
