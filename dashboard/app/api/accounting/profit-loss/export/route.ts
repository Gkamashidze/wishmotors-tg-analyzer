import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

type ExportFormat = "xlsx" | "pdf";

// GET /api/accounting/profit-loss/export?from=YYYY-MM-DD&to=YYYY-MM-DD&format=xlsx|pdf
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get("from");
  const toStr   = searchParams.get("to");
  const format  = (searchParams.get("format") ?? "xlsx") as ExportFormat;

  if (!fromStr || !toStr) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }

  const from = new Date(fromStr);
  const to   = new Date(toStr + "T23:59:59.999Z");

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
    const revenueRow = await queryOne<{ sales_revenue: string }>(
      `SELECT COALESCE(SUM(quantity * unit_price), 0) AS sales_revenue
       FROM sales WHERE sold_at >= $1 AND sold_at <= $2`,
      [from.toISOString(), to.toISOString()],
    );

    const cogsRow = await queryOne<{ cogs: string }>(
      `SELECT COALESCE(SUM(cost_amount), 0) AS cogs
       FROM sales WHERE sold_at >= $1 AND sold_at <= $2`,
      [from.toISOString(), to.toISOString()],
    );

    const expenseRows = await query<{ category: string; amount: string }>(
      `SELECT COALESCE(NULLIF(category, ''), 'სხვა') AS category, SUM(amount) AS amount
       FROM expenses WHERE created_at >= $1 AND created_at <= $2
       GROUP BY COALESCE(NULLIF(category, ''), 'სხვა')
       ORDER BY SUM(amount) DESC`,
      [from.toISOString(), to.toISOString()],
    );

    const salesRevenue    = Number(revenueRow?.sales_revenue ?? 0);
    const cogs            = Number(cogsRow?.cogs ?? 0);
    const grossProfit     = salesRevenue - cogs;
    const grossMarginPct  = salesRevenue > 0 ? (grossProfit / salesRevenue) * 100 : 0;
    const expenses        = expenseRows.map((r) => ({ category: r.category, amount: Number(r.amount) }));
    const totalExpenses   = expenses.reduce((s, r) => s + r.amount, 0);
    const netProfit       = grossProfit - totalExpenses;
    const netMarginPct    = salesRevenue > 0 ? (netProfit / salesRevenue) * 100 : 0;

    if (format === "xlsx") {
      const wb = XLSX.utils.book_new();

      const rows: (string | number)[][] = [
        ["მოგება-ზარალის ანგარიში", `${fromStr} — ${toStr}`],
        [],
        ["კატეგორია", "თანხა (₾)"],
        ["შემოსავლები", ""],
        ["  გაყიდვების შემოსავალი", salesRevenue],
        ["სულ შემოსავალი", salesRevenue],
        [],
        ["გაყიდვების თვითღირებულება", ""],
        ["  COGS", -cogs],
        ["სულ COGS", -cogs],
        [],
        [`მთლიანი მოგება (${grossMarginPct.toFixed(1)}%)`, grossProfit],
        [],
        ["საოპერაციო ხარჯები", ""],
        ...expenses.map((e) => [`  ${e.category}`, -e.amount]),
        ["სულ ხარჯები", -totalExpenses],
        [],
        [`წმინდა მოგება (${netMarginPct.toFixed(1)}%)`, netProfit],
      ];

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{ wch: 40 }, { wch: 18 }];

      XLSX.utils.book_append_sheet(wb, ws, "მოგება-ზარალი");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;

      return new NextResponse(buf as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="profit-loss-${fromStr}-${toStr}.xlsx"`,
        },
      });
    }

    // PDF — printable HTML
    const expenseHtmlRows = expenses
      .map(
        (e) =>
          `<tr><td class="indent">${e.category}</td><td class="num neg">-${e.amount.toFixed(2)}</td></tr>`,
      )
      .join("");

    const pnl = (v: number) =>
      `<span class="${v >= 0 ? "pos" : "neg"}">${v < 0 ? "-" : ""}${Math.abs(v).toFixed(2)}</span>`;

    const html = `<!DOCTYPE html>
<html lang="ka">
<head>
<meta charset="UTF-8" />
<title>მოგება-ზარალი — ${fromStr} — ${toStr}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; }
  h1 { font-size: 16px; margin-bottom: 4px; }
  p  { color: #555; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; max-width: 600px; }
  tr { border-bottom: 1px solid #eee; }
  td { padding: 5px 10px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .indent { padding-left: 24px; color: #444; }
  .section { font-weight: bold; background: #f5f5f5; }
  .total { font-weight: bold; }
  .gross { font-weight: bold; background: #dbeafe; }
  .net   { font-weight: bold; background: #dcfce7; }
  .net.loss { background: #fee2e2; }
  .pos { color: #15803d; }
  .neg { color: #dc2626; }
  @media print { button { display: none; } }
</style>
</head>
<body>
<button onclick="window.print()" style="margin-bottom:12px;padding:8px 16px;cursor:pointer;">🖨️ PDF-ად ბეჭდვა</button>
<h1>მოგება-ზარალის ანგარიში</h1>
<p>პერიოდი: ${fromStr} — ${toStr}</p>
<table>
  <tr class="section"><td>საოპერაციო შემოსავლები</td><td></td></tr>
  <tr><td class="indent">გაყიდვების შემოსავალი</td><td class="num pos">${salesRevenue.toFixed(2)}</td></tr>
  <tr class="total"><td>სულ შემოსავალი</td><td class="num pos">${salesRevenue.toFixed(2)}</td></tr>

  <tr class="section"><td>გაყიდვების თვითღირებულება</td><td></td></tr>
  <tr><td class="indent">COGS</td><td class="num neg">-${cogs.toFixed(2)}</td></tr>
  <tr class="total"><td>სულ COGS</td><td class="num neg">-${cogs.toFixed(2)}</td></tr>

  <tr class="gross"><td>მთლიანი მოგება (${grossMarginPct.toFixed(1)}%)</td><td class="num">${pnl(grossProfit)}</td></tr>

  <tr class="section"><td>საოპერაციო ხარჯები</td><td></td></tr>
  ${expenseHtmlRows}
  <tr class="total"><td>სულ ხარჯები</td><td class="num neg">-${totalExpenses.toFixed(2)}</td></tr>

  <tr class="net ${netProfit < 0 ? "loss" : ""}"><td>წმინდა მოგება (${netMarginPct.toFixed(1)}%)</td><td class="num">${pnl(netProfit)}</td></tr>
</table>
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="profit-loss-${fromStr}-${toStr}.html"`,
      },
    });
  } catch (err) {
    console.error("[profit-loss/export] GET error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
