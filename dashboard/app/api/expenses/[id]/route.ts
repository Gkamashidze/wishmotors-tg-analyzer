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
  const { amount, description, category, payment_method, created_at } = body;

  await query(
    `UPDATE expenses SET
      amount         = $2,
      description    = $3,
      category       = $4,
      payment_method = $5,
      created_at     = $6
    WHERE id = $1`,
    [rowId, amount, description ?? null, category ?? null, payment_method, created_at],
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  await query("DELETE FROM expenses WHERE id = $1", [rowId]);
  return NextResponse.json({ ok: true });
}
