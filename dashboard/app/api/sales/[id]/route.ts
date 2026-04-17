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
  const {
    product_id,
    quantity,
    unit_price,
    cost_amount,
    payment_method,
    seller_type,
    customer_name,
    sold_at,
    notes,
  } = body;

  await query(
    `UPDATE sales SET
      product_id    = $2,
      quantity      = $3,
      unit_price    = $4,
      cost_amount   = $5,
      payment_method = $6,
      seller_type   = $7,
      customer_name = $8,
      sold_at       = $9,
      notes         = $10
    WHERE id = $1`,
    [rowId, product_id ?? null, quantity, unit_price, cost_amount, payment_method, seller_type, customer_name ?? null, sold_at, notes ?? null],
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  await query("DELETE FROM sales WHERE id = $1", [rowId]);
  return NextResponse.json({ ok: true });
}
