import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isFinite(productId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const rows = await query<{ id: number; url: string; position: number }>(
    `SELECT id, url, position FROM product_images
     WHERE product_id = $1 ORDER BY position ASC, id ASC`,
    [productId],
  );
  return NextResponse.json({ images: rows });
}

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isFinite(productId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: { url?: unknown };
  try {
    body = (await req.json()) as { url?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  const row = await queryOne<{ id: number; url: string; position: number }>(
    `INSERT INTO product_images (product_id, url, position)
     SELECT $1, $2, COALESCE(MAX(position), -1) + 1
     FROM product_images WHERE product_id = $1
     RETURNING id, url, position`,
    [productId, url],
  );
  return NextResponse.json({ image: row });
}
