import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export type ImportHistoryEntry = {
  importId: number;
  date: string;
  supplier: string;
  unitPriceUsd: number;
  exchangeRate: number;
  landedCostPerUnitGel: number | null;
  quantity: number;
  unit: string;
};

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const productId = Number(id);
  if (isNaN(productId) || productId <= 0) {
    return NextResponse.json({ error: "Invalid product id" }, { status: 400 });
  }

  const rows = await query<{
    import_id: number;
    date: Date;
    supplier: string;
    unit_price_usd: string;
    exchange_rate: string;
    landed_cost_per_unit_gel: string | null;
    quantity: string;
    unit: string;
  }>(
    `SELECT
       ii.import_id,
       i.date,
       i.supplier,
       ii.unit_price_usd,
       i.exchange_rate,
       ii.landed_cost_per_unit_gel,
       ii.quantity,
       ii.unit
     FROM import_items ii
     JOIN imports i ON i.id = ii.import_id
     WHERE ii.product_id = $1
       AND i.status = 'completed'
     ORDER BY i.date DESC, i.id DESC
     LIMIT 12`,
    [productId],
  );

  const data: ImportHistoryEntry[] = rows.map((r) => ({
    importId:            r.import_id,
    date:                (r.date instanceof Date ? r.date.toISOString() : String(r.date)).slice(0, 10),
    supplier:            r.supplier,
    unitPriceUsd:        Number(r.unit_price_usd),
    exchangeRate:        Number(r.exchange_rate),
    landedCostPerUnitGel: r.landed_cost_per_unit_gel != null ? Number(r.landed_cost_per_unit_gel) : null,
    quantity:            Number(r.quantity),
    unit:                r.unit,
  }));

  return NextResponse.json(data);
}
