import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

type Params = Promise<{ id: string }>;

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = await req.json() as Record<string, unknown>;
  const { name, oem_code, current_stock, min_stock, unit_price, unit } = body;

  await query(
    `UPDATE products SET
      name          = $2,
      oem_code      = $3,
      current_stock = $4,
      min_stock     = $5,
      unit_price    = $6,
      unit          = $7
    WHERE id = $1`,
    [rowId, name, oem_code ?? null, current_stock, min_stock, unit_price, unit],
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  await query("DELETE FROM products WHERE id = $1", [rowId]);
  return NextResponse.json({ ok: true });
}
