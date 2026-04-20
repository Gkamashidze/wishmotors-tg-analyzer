import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getImportsHistory } from "@/lib/queries";

export const dynamic = "force-dynamic";

// ── GET /api/imports — return history ────────────────────────────────────────
export async function GET() {
  try {
    const rows = await getImportsHistory(1000);
    return NextResponse.json(rows);
  } catch (err) {
    console.error("[imports GET]", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}

// ── POST /api/imports — parse uploaded Excel and persist rows ─────────────────
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "ფაილი ვერ მოიძებნა" }, { status: 400 });
    }

    const bytes = await (file as Blob).arrayBuffer();
    const rows = parseImportExcel(Buffer.from(bytes));

    if (rows.parsed.length === 0) {
      return NextResponse.json(
        { error: "ფაილი ცარიელია ან ყველა სტრიქონი გამოტოვდა", skipped: rows.errors },
        { status: 422 },
      );
    }

    // Persist import history rows
    for (const r of rows.parsed) {
      await query(
        `INSERT INTO imports_history
           (import_date, oem, name, quantity, unit,
            unit_price_usd, exchange_rate,
            transport_cost_gel, other_cost_gel,
            total_unit_cost_gel, suggested_retail_price_gel)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          r.importDate,
          r.oem,
          r.name,
          r.quantity,
          r.unit,
          r.unitPriceUsd,
          r.exchangeRate,
          r.transportCostGel,
          r.otherCostGel,
          r.totalUnitCostGel,
          r.suggestedRetailPriceGel,
        ],
      );

      // Upsert product and update stock (WAC via inventory_batches)
      await upsertProductWithBatch(r);
    }

    return NextResponse.json({
      saved: rows.parsed.length,
      skipped: rows.errors.length,
      errors: rows.errors,
    });
  } catch (err) {
    console.error("[imports POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Excel parser (pure TypeScript, no Python dependency) ─────────────────────

type ParsedRow = {
  importDate: string; // YYYY-MM-DD
  oem: string;
  name: string;
  quantity: number;
  unit: string;
  unitPriceUsd: number;
  exchangeRate: number;
  transportCostGel: number;
  otherCostGel: number;
  totalUnitCostGel: number;
  suggestedRetailPriceGel: number;
};

function parseImportExcel(buf: Buffer): {
  parsed: ParsedRow[];
  errors: string[];
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx") as typeof import("xlsx");
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    blankrows: false,
  });

  const parsed: ParsedRow[] = [];
  const errors: string[] = [];
  let lastDate = toDateStr(new Date());

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    if (!row || row.every((c) => c == null || String(c).trim() === "")) continue;

    const [
      rawDate,
      rawOem,
      rawName,
      rawQty,
      rawUnit,
      rawPriceUsd,
      rawRate,
      rawTransport,
      rawOther,
    ] = [...row, null, null, null, null, null, null, null, null, null].slice(0, 9);

    const parsedDate = parseDate(rawDate);
    if (parsedDate) lastDate = parsedDate;
    const importDate = lastDate;

    const oem = sanitizeOem(rawOem);
    if (!oem) {
      errors.push(`სტრიქონი ${i + 1}: OEM კოდი ცარიელია`);
      continue;
    }

    const name = rawName != null ? String(rawName).trim() : "";
    if (!name) {
      errors.push(`სტრიქონი ${i + 1}: დასახელება ცარიელია`);
      continue;
    }

    const quantity = parseNum(rawQty);
    if (quantity === null || quantity <= 0) {
      errors.push(`სტრიქონი ${i + 1} (${oem}): არასწორი რაოდენობა`);
      continue;
    }

    const unit = rawUnit != null && String(rawUnit).trim() ? String(rawUnit).trim() : "ც";

    const unitPriceUsd = parseNum(rawPriceUsd);
    if (unitPriceUsd === null || unitPriceUsd < 0) {
      errors.push(`სტრიქონი ${i + 1} (${oem}): არასწორი ფასი`);
      continue;
    }

    const exchangeRate = parseNum(rawRate);
    if (exchangeRate === null || exchangeRate <= 0) {
      errors.push(`სტრიქონი ${i + 1} (${oem}): არასწორი კურსი`);
      continue;
    }

    const transportCostGel = Math.max(0, parseNum(rawTransport) ?? 0);
    const otherCostGel = Math.max(0, parseNum(rawOther) ?? 0);

    const totalUnitCostGel =
      Math.round((unitPriceUsd * exchangeRate + transportCostGel + otherCostGel) * 10000) / 10000;
    const suggestedRetailPriceGel = Math.round(totalUnitCostGel * 1.4 * 10000) / 10000;

    parsed.push({
      importDate,
      oem,
      name,
      quantity,
      unit,
      unitPriceUsd,
      exchangeRate,
      transportCostGel,
      otherCostGel,
      totalUnitCostGel,
      suggestedRetailPriceGel,
    });
  }

  return { parsed, errors };
}

function parseNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const s = String(v)
    .replace(/[^\d.,-]/g, "")
    .replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return toDateStr(v);
  const s = String(v).trim();
  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // dd.mm.yyyy or dd/mm/yyyy
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sanitizeOem(v: unknown): string {
  if (v == null) return "";
  // Excel may parse OEM as float (e.g. 8390132500.0) — strip decimal part
  let s = String(v).trim();
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
  return s.toUpperCase();
}

// ── Upsert product + inventory batch ─────────────────────────────────────────

async function upsertProductWithBatch(r: ParsedRow): Promise<void> {
  const existing = await queryOne<{ id: number }>(
    "SELECT id FROM products WHERE oem_code = $1",
    [r.oem],
  );

  let productId: number;

  if (existing) {
    productId = existing.id;
    await query(
      "UPDATE products SET name = $1, unit_price = $2, unit = $3 WHERE id = $4",
      [r.name, r.totalUnitCostGel, r.unit, productId],
    );
  } else {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO products (name, oem_code, current_stock, min_stock, unit_price, unit, created_at)
       VALUES ($1, $2, 0, 0, $3, $4, $5::date)
       RETURNING id`,
      [r.name, r.oem, r.totalUnitCostGel, r.unit, r.importDate],
    );
    if (!row) return;
    productId = row.id;
  }

  // Increment stock
  await query(
    "UPDATE products SET current_stock = current_stock + $1 WHERE id = $2",
    [r.quantity, productId],
  );

  // Insert inventory batch for WAC tracking
  await query(
    `INSERT INTO inventory_batches
       (product_id, quantity, remaining_quantity, unit_cost, received_at)
     VALUES ($1, $2, $2, $3, $4::date)`,
    [productId, r.quantity, r.totalUnitCostGel, r.importDate],
  );

  // Double-entry ledger: DR 1300 Inventory, CR 2100 AP
  const totalCost = r.quantity * r.totalUnitCostGel;
  const ref = `import:${r.oem}:${r.importDate}`;
  const desc = `Import receipt — ${r.name} (OEM ${r.oem})`;
  await query(
    `INSERT INTO ledger (transaction_date, account_code, debit_amount, credit_amount, description, reference_id)
     VALUES ($1::date, '1300', $2, 0, $3, $4)`,
    [r.importDate, totalCost, desc, ref],
  );
  await query(
    `INSERT INTO ledger (transaction_date, account_code, debit_amount, credit_amount, description, reference_id)
     VALUES ($1::date, '2100', 0, $2, $3, $4)`,
    [r.importDate, totalCost, desc, ref],
  );
}
