import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

type Params = Promise<{ id: string; compatId: string }>;

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  const { id, compatId } = await params;
  const productId = Number(id);
  const compatibilityId = Number(compatId);
  if (!Number.isFinite(productId) || !Number.isFinite(compatibilityId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  await query(
    "DELETE FROM product_compatibility WHERE id = $1 AND product_id = $2",
    [compatibilityId, productId],
  );

  return NextResponse.json({ ok: true });
}
