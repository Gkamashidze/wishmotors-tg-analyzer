import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

export type VatSummaryResponse = {
  period: { from: string; to: string };
  vat_collected: number;   // from sales (output VAT)
  vat_paid: number;        // from expenses (input VAT)
  vat_payable: number;     // net amount due to tax authority = collected - paid
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
    const salesVat = await queryOne<{ total: string }>(
      `SELECT COALESCE(SUM(vat_amount), 0) AS total
       FROM sales
       WHERE is_vat_included = TRUE AND sold_at >= $1 AND sold_at <= $2`,
      [from.toISOString(), to.toISOString()],
    );

    const expenseVat = await queryOne<{ total: string }>(
      `SELECT COALESCE(SUM(vat_amount), 0) AS total
       FROM expenses
       WHERE is_vat_included = TRUE AND created_at >= $1 AND created_at <= $2`,
      [from.toISOString(), to.toISOString()],
    );

    const vatCollected = Number(salesVat?.total ?? 0);
    const vatPaid      = Number(expenseVat?.total ?? 0);
    const vatPayable   = vatCollected - vatPaid;

    const result: VatSummaryResponse = {
      period:        { from: fromStr, to: toStr },
      vat_collected: vatCollected,
      vat_paid:      vatPaid,
      vat_payable:   vatPayable,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[vat] GET error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
