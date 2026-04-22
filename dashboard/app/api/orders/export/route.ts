import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { query } from "@/lib/db";

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
  pending: "მოლოდინში",
  ordered: "შეკვეთილი",
  received: "მიღებული",
  cancelled: "გაუქმებული",
  completed: "შესრულდა",
};

const VALID_PRIORITIES = new Set(["all", "urgent", "low"]);
const VALID_STATUSES = new Set(["all", "pending", "ordered", "received", "cancelled", "completed"]);

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
    conditions.push(`(LOWER(p.name) LIKE $${n} OR LOWER(COALESCE(o.oem_code, p.oem_code)) LIKE $${n} OR LOWER(o.notes) LIKE $${n})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await query<OrderExportRow>(
    `SELECT o.id,
            COALESCE(o.oem_code, p.oem_code, '-')                        AS oem_code,
            COALESCE(p.name, NULLIF(o.part_name, ''), 'ძველი ჩანაწერი') AS product_name,
            COALESCE(o.quantity_needed, 0)                               AS quantity_needed,
            COALESCE(o.priority, 'low')                                  AS priority,
            COALESCE(o.status, 'pending')                                AS status,
            o.notes,
            COALESCE(o.created_at, NOW())                                AS created_at
     FROM orders o
     LEFT JOIN products p ON p.id = o.product_id
     ${where}
     ORDER BY CASE o.status WHEN 'pending' THEN 0 ELSE 1 END,
              CASE o.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
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
