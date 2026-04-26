import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

export type VatMonthRow = {
  month: string;          // "YYYY-MM"
  output_vat: number;     // გადასახდელი დღგ (from sales, positive value)
  input_vat: number;      // ჩასათვლელი დღგ (from imports, positive value)
  net_payable: number;    // გადასარიცხი დღგ = output_vat - input_vat
};

export type VatSummaryResponse = {
  period: { from: string; to: string };
  months: VatMonthRow[];
  totals: {
    output_vat: number;
    input_vat: number;
    net_payable: number;
  };
  // Legacy fields kept for backward compatibility with accounting/page.tsx
  vat_collected: number;
  vat_paid: number;
  vat_payable: number;
};

// GET /api/accounting/vat?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get("from");
  const toStr   = searchParams.get("to");

  if (!fromStr || !toStr) {
    return NextResponse.json(
      { error: "from and to query params are required" },
      { status: 400 },
    );
  }

  const from = new Date(fromStr);
  const to   = new Date(toStr + "T23:59:59.999Z");

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "invalid dates" }, { status: 400 });
  }

  try {
    const rows = await query<{
      month: string;
      output_vat: string;
      input_vat: string;
    }>(
      // import_vat rows are always kept (imports = LLC).
      // sales_vat rows are filtered to LLC-only via JOIN to sales table.
      `SELECT
         TO_CHAR(vl.created_at AT TIME ZONE 'Asia/Tbilisi', 'YYYY-MM') AS month,
         SUM(CASE WHEN vl.amount < 0 THEN ABS(vl.amount) ELSE 0 END)   AS output_vat,
         SUM(CASE WHEN vl.amount > 0 THEN vl.amount      ELSE 0 END)   AS input_vat
       FROM vat_ledger vl
       LEFT JOIN sales s
         ON vl.transaction_type = 'sales_vat'
        AND vl.reference_id = 'sale:' || s.id::text
       WHERE vl.transaction_type IN ('import_vat', 'sales_vat')
         AND vl.created_at >= $1
         AND vl.created_at <= $2
         AND (
           vl.transaction_type = 'import_vat'
           OR s.seller_type = 'llc'
         )
       GROUP BY month
       ORDER BY month DESC`,
      [from.toISOString(), to.toISOString()],
    );

    const months: VatMonthRow[] = rows.map((r) => {
      const outputVat = Number(r.output_vat);
      const inputVat  = Number(r.input_vat);
      return {
        month:       r.month,
        output_vat:  outputVat,
        input_vat:   inputVat,
        net_payable: outputVat - inputVat,
      };
    });

    const totals = months.reduce(
      (acc, m) => ({
        output_vat:  acc.output_vat  + m.output_vat,
        input_vat:   acc.input_vat   + m.input_vat,
        net_payable: acc.net_payable + m.net_payable,
      }),
      { output_vat: 0, input_vat: 0, net_payable: 0 },
    );

    const result: VatSummaryResponse = {
      period:        { from: fromStr, to: toStr },
      months,
      totals,
      // Legacy aliases
      vat_collected: totals.output_vat,
      vat_paid:      totals.input_vat,
      vat_payable:   totals.net_payable,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[vat] GET error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
