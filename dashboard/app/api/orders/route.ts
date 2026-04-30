import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { product_id, part_name, oem_code, quantity_needed, priority, notes } = body;

  const qty = Number(quantity_needed);
  if (!Number.isFinite(qty) || qty < 1) {
    return NextResponse.json({ error: "quantity_needed must be >= 1" }, { status: 400 });
  }

  const productIdNum = product_id ? Number(product_id) : null;
  const partNameStr = part_name ? String(part_name).trim() : "";

  if (!productIdNum && !partNameStr) {
    return NextResponse.json(
      { error: "product_id ან part_name სავალდებულოა" },
      { status: 400 },
    );
  }

  const row = await queryOne<{ id: number }>(
    `INSERT INTO orders (product_id, part_name, oem_code, quantity_needed, priority, status, notes)
     VALUES ($1, $2, $3, $4, $5, 'new', $6)
     RETURNING id`,
    [
      productIdNum,
      partNameStr,
      oem_code ? String(oem_code).trim() : null,
      qty,
      priority === "urgent" ? "urgent" : "low",
      notes ? String(notes).trim() : null,
    ],
  );

  return NextResponse.json({ ok: true, id: row?.id }, { status: 201 });
}
