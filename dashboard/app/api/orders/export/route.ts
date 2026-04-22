import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface OrderExportRow {
  id: number;
  oem_code: string | null;
  product_name: string | null;
  quantity_needed: number;
  priority: string;
  status: string;
  notes: string | null;
  created_at: string;
}

const PRIORITY_MAP: Record<string, string> = {
  urgent: "სასწრაფო",
  low: "არც ისე სასწრაფო",
  // Legacy: old rows may still carry 'normal' — map to low label.
  normal: "არც ისე სასწრაფო",
};

const STATUS_MAP: Record<string, string> = {
  new:        "ახალი",
  processing: "მუშავდება",
  ordered:    "შეკვეთილი",
  ready:      "მზადაა",
  delivered:  "მიტანილი",
  cancelled:  "გაუქმებული",
};

const VALID_PRIORITIES = new Set(["all", "urgent", "low"]);
const VALID_STATUSES = new Set(["all", "new", "processing", "ordered", "ready", "delivered", "cancelled"]);

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const priority = searchParams.get("priority") ?? "all";
  const status = searchParams.get("status") ?? "all";
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();

  const safeP = VALID_PRIORITIES.has(priority) ? priority : "all";
  const safeS = VALID_STATUSES.has(status) ? status : "all";

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (safeP !== "all") {
    params.push(safeP);
    conditions.push(`o.priority = $${params.length}`);
  }
  if (safeS !== "all") {
    params.push(safeS);
    conditions.push(`o.status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    const n = params.length;
    conditions.push(`(LOWER(COALESCE(p.name, o.part_name)) LIKE $${n} OR LOWER(o.oem_code) LIKE $${n} OR LOWER(o.notes) LIKE $${n})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await query<OrderExportRow>(
    `SELECT o.id,
            o.oem_code,
            COALESCE(p.name, o.part_name) AS product_name,
            o.quantity_needed,
            CASE WHEN o.priority = 'urgent' THEN 'urgent' ELSE 'low' END AS priority,
            o.status,
            o.notes,
            o.created_at
     FROM orders o
     LEFT JOIN products p ON p.id = o.product_id
     ${where}
     ORDER BY CASE o.status WHEN 'pending' THEN 0 ELSE 1 END,
              CASE o.priority WHEN 'urgent' THEN 0 ELSE 1 END,
              o.created_at DESC`,
    params,
  );

  const sheetData = [
    ["#", "OEM კოდი", "დასახელება", "რაოდენობა", "პრიორიტეტი", "სტატუსი", "შენიშვნა", "შექმნის თარიღი"],
    ...rows.map((r, i) => [
      i + 1,
      r.oem_code ?? "",
      r.product_name ?? "",
      r.quantity_needed,
      PRIORITY_MAP[r.priority] ?? r.priority,
      STATUS_MAP[r.status] ?? r.status,
      r.notes ?? "",
      new Date(r.created_at).toLocaleDateString("ka-GE"),
    ]),
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  ws["!cols"] = [
    { wch: 5 },
    { wch: 18 },
    { wch: 30 },
    { wch: 12 },
    { wch: 16 },
    { wch: 14 },
    { wch: 30 },
    { wch: 18 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "შეკვეთები");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="orders-${date}.xlsx"`,
    },
  });
}
