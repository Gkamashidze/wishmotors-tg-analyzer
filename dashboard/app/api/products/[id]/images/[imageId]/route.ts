import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

type Params = Promise<{ id: string; imageId: string }>;

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  const { id, imageId } = await params;
  const productId = Number(id);
  const imgId = Number(imageId);
  if (!Number.isFinite(productId) || !Number.isFinite(imgId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await query(
    `DELETE FROM product_images WHERE id = $1 AND product_id = $2`,
    [imgId, productId],
  );
  return NextResponse.json({ ok: true });
}
