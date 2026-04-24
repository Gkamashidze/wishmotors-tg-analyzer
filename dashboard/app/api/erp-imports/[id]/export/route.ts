import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const ITEM_TYPE_LABELS: Record<string, string> = {
  inventory:   "საქონელი",
  fixed_asset: "ძირ. საშ.",
  consumable:  "სახარჯი",
};

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const importId = Number(id);
  if (isNaN(importId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const imp = await queryOne<{
    id: number;
    date: Date;
    supplier: string;
    invoice_number: string | null;
    declaration_number: string | null;
    status: string;
  }>(
    `SELECT id, date, supplier, invoice_number, declaration_number, status
     FROM imports WHERE id = $1`,
    [importId],
  );

  if (!imp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const items = await query<{
    product_name: string;
    oem_code: string | null;
    item_type: string;
    quantity: string;
    unit_price_usd: string;
    weight: string;
    allocated_transport_cost: string;
    allocated_terminal_cost: string;
    allocated_agency_cost: string;
    landed_cost_per_unit_gel: string;
    recommended_price: string | null;
  }>(
    `SELECT p.name AS product_name, p.oem_code,
            COALESCE(ii.item_type, 'inventory') AS item_type,
            ii.quantity, ii.unit_price_usd, ii.weight,
            ii.allocated_transport_cost, ii.allocated_terminal_cost,
            ii.allocated_agency_cost,
            ii.landed_cost_per_unit_gel, ii.recommended_price
     FROM import_items ii
     JOIN products p ON p.id = ii.product_id
     WHERE ii.import_id = $1
     ORDER BY ii.id`,
    [importId],
  );

  const dateStr = imp.date instanceof Date
    ? imp.date.toISOString().slice(0, 10)
    : String(imp.date).slice(0, 10);

  // ── Build sheet data ─────────────────────────────────────────────────────────

  const headerSection: (string | number | null)[][] = [
    ["მომწოდებელი", imp.supplier],
    ["თარიღი",      dateStr],
    ["ინვოისის #",  imp.invoice_number  ?? "—"],
    ["შეფასების #", imp.declaration_number ?? "—"],
    [],
  ];

  const columnHeaders = [
    "OEM",
    "დასახელება",
    "ტიპი",
    "რაოდენობა",
    "ერთეულის ფასი $",
    "წონა",
    "განაწილებული ტრანსპორტი ₾",
    "განაწილებული ტერმინალი ₾",
    "განაწილებული სააგენტო ₾",
    "სუფთა თვითღირებულება ₾",
    "რეკომენდებული ფასი ₾",
  ];

  const dataRows = items.map((it) => {
    const recPrice = it.recommended_price !== null ? Number(it.recommended_price) : null;
    return [
      it.oem_code ?? "",
      it.product_name,
      ITEM_TYPE_LABELS[it.item_type] ?? it.item_type,
      Number(it.quantity),
      Number(it.unit_price_usd),
      Number(it.weight),
      Number(it.allocated_transport_cost),
      Number(it.allocated_terminal_cost),
      Number(it.allocated_agency_cost),
      Number(it.landed_cost_per_unit_gel),
      recPrice ?? "",
    ];
  });

  const sheetData = [
    ...headerSection,
    columnHeaders,
    ...dataRows,
  ];

  // ── Create workbook ──────────────────────────────────────────────────────────

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  ws["!cols"] = [
    { wch: 18 }, // OEM
    { wch: 32 }, // Name
    { wch: 12 }, // Type
    { wch: 12 }, // Qty
    { wch: 16 }, // Unit price $
    { wch: 10 }, // Weight
    { wch: 26 }, // Transport
    { wch: 24 }, // Terminal
    { wch: 24 }, // Agency
    { wch: 26 }, // Landed cost
    { wch: 24 }, // Recommended price
  ];

  XLSX.utils.book_append_sheet(wb, ws, "იმპორტი");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const safeName = imp.supplier.replace(/[^\wა-ჿ]/g, "_").slice(0, 40);
  const filename = `import_${safeName}_${dateStr}.xlsx`;

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
