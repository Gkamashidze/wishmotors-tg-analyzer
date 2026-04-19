import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

type ExportFormat = "xlsx" | "pdf";

// GET /api/accounting/trial-balance/export?from=YYYY-MM-DD&to=YYYY-MM-DD&format=xlsx|pdf
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromStr  = searchParams.get("from");
  const toStr    = searchParams.get("to");
  const format   = (searchParams.get("format") ?? "xlsx") as ExportFormat;

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
        opening AS (
          SELECT account_code,
            COALESCE(SUM(debit_amount),  0) AS debit,
            COALESCE(SUM(credit_amount), 0) AS credit
          FROM ledger WHERE transaction_date < $1
          GROUP BY account_code
        ),
        period AS (
          SELECT account_code,
            COALESCE(SUM(debit_amount),  0) AS debit,
            COALESCE(SUM(credit_amount), 0) AS credit
          FROM ledger WHERE transaction_date >= $1 AND transaction_date <= $2
          GROUP BY account_code
        ),
        all_codes AS (
          SELECT account_code FROM opening
          UNION SELECT account_code FROM period
        )
      SELECT
        ac.account_code,
        coa.name     AS account_name,
        coa.type     AS account_type,
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

    const processed = rows.map((r) => {
      const od = Number(r.opening_debit);
      const oc = Number(r.opening_credit);
      const pd = Number(r.period_debit);
      const pc = Number(r.period_credit);
      return {
        კოდი:              r.account_code,
        ანგარიში:          r.account_name ?? r.account_code,
        ტიპი:              r.account_type ?? "",
        "გახსნ. დებეტი":  od,
        "გახსნ. კრედიტი": oc,
        "პერ. დებეტი":    pd,
        "პერ. კრედიტი":   pc,
        "დახ. დებეტი":    od + pd,
        "დახ. კრედიტი":   oc + pc,
      };
    });

    const totals = processed.reduce(
      (acc, r) => ({
        ...acc,
        "გახსნ. დებეტი":  acc["გახსნ. დებეტი"]  + r["გახსნ. დებეტი"],
        "გახსნ. კრედიტი": acc["გახსნ. კრედიტი"] + r["გახსნ. კრედიტი"],
        "პერ. დებეტი":    acc["პერ. დებეტი"]    + r["პერ. დებეტი"],
        "პერ. კრედიტი":   acc["პერ. კრედიტი"]   + r["პერ. კრედიტი"],
        "დახ. დებეტი":    acc["დახ. დებეტი"]    + r["დახ. დებეტი"],
        "დახ. კრედიტი":   acc["დახ. კრედიტი"]   + r["დახ. კრედიტი"],
      }),
      { კოდი: "სულ", ანგარიში: "", ტიპი: "", "გახსნ. დებეტი": 0, "გახსნ. კრედიტი": 0, "პერ. დებეტი": 0, "პერ. კრედიტი": 0, "დახ. დებეტი": 0, "დახ. კრედიტი": 0 },
    );

    if (format === "xlsx") {
      const wb = XLSX.utils.book_new();

      const headerRow = [["ბრუნვითი უწყისი", `${fromStr} — ${toStr}`]];
      const ws = XLSX.utils.aoa_to_sheet(headerRow);
      XLSX.utils.sheet_add_json(ws, [...processed, totals], { origin: "A3", skipHeader: false });

      const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
      ws["!cols"] = [
        { wch: 8 },
        { wch: 32 },
        { wch: 12 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
      ];
      ws["!ref"] = XLSX.utils.encode_range(range);

      XLSX.utils.book_append_sheet(wb, ws, "ბრუნვითი უწყისი");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;

      return new NextResponse(buf as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="trial-balance-${fromStr}-${toStr}.xlsx"`,
        },
      });
    }

    // PDF — return printable HTML
    const htmlRows = processed
      .map(
        (r) =>
          `<tr>
            <td>${r["კოდი"]}</td>
            <td>${r["ანგარიში"]}</td>
            <td>${r["ტიპი"]}</td>
            <td class="num">${r["გახსნ. დებეტი"].toFixed(2)}</td>
            <td class="num">${r["გახსნ. კრედიტი"].toFixed(2)}</td>
            <td class="num">${r["პერ. დებეტი"].toFixed(2)}</td>
            <td class="num">${r["პერ. კრედიტი"].toFixed(2)}</td>
            <td class="num">${r["დახ. დებეტი"].toFixed(2)}</td>
            <td class="num">${r["დახ. კრედიტი"].toFixed(2)}</td>
          </tr>`,
      )
      .join("");

    const html = `<!DOCTYPE html>
<html lang="ka">
<head>
<meta charset="UTF-8" />
<title>ბრუნვითი უწყისი — ${fromStr} — ${toStr}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; margin: 20px; }
  h1 { font-size: 16px; margin-bottom: 4px; }
  p  { font-size: 12px; color: #555; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  th { background: #f0f0f0; font-weight: bold; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: bold; background: #e8e8e8; }
  @media print { button { display: none; } }
</style>
</head>
<body>
<button onclick="window.print()" style="margin-bottom:12px;padding:8px 16px;cursor:pointer;">🖨️ PDF-ად ბეჭდვა</button>
<h1>ბრუნვითი უწყისი</h1>
<p>პერიოდი: ${fromStr} — ${toStr}</p>
<table>
  <thead>
    <tr>
      <th>კოდი</th><th>ანგარიში</th><th>ტიპი</th>
      <th class="num">გახსნ. დებ.</th><th class="num">გახსნ. კრედ.</th>
      <th class="num">პერ. დებ.</th><th class="num">პერ. კრედ.</th>
      <th class="num">დახ. დებ.</th><th class="num">დახ. კრედ.</th>
    </tr>
  </thead>
  <tbody>${htmlRows}</tbody>
  <tfoot>
    <tr>
      <td colspan="3">სულ</td>
      <td class="num">${totals["გახსნ. დებეტი"].toFixed(2)}</td>
      <td class="num">${totals["გახსნ. კრედიტი"].toFixed(2)}</td>
      <td class="num">${totals["პერ. დებეტი"].toFixed(2)}</td>
      <td class="num">${totals["პერ. კრედიტი"].toFixed(2)}</td>
      <td class="num">${totals["დახ. დებეტი"].toFixed(2)}</td>
      <td class="num">${totals["დახ. კრედიტი"].toFixed(2)}</td>
    </tr>
  </tfoot>
</table>
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="trial-balance-${fromStr}-${toStr}.html"`,
      },
    });
  } catch (err) {
    console.error("[trial-balance/export] GET error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
