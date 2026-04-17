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
  const { product_id, quantity_needed, status, priority, notes } = body;

  await query(
    `UPDATE orders SET
      product_id      = $2,
      quantity_needed = $3,
      status          = $4,
      priority        = $5,
      notes           = $6
    WHERE id = $1`,
    [rowId, product_id ?? null, quantity_needed, status, priority, notes ?? null],
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  await query("DELETE FROM orders WHERE id = $1", [rowId]);
  return NextResponse.json({ ok: true });
}
