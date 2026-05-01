import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

type Params = Promise<{ id: string }>;

const SLUG_RE = /^[a-z0-9-]+$/;

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isFinite(productId) || productId <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  // is_published
  if ("is_published" in body) {
    if (typeof body.is_published !== "boolean") {
      return NextResponse.json(
        { error: "is_published must be a boolean" },
        { status: 400 },
      );
    }
    values.push(body.is_published);
    updates.push(`is_published = $${values.length}`);
  }

  // slug
  if ("slug" in body) {
    const slug = body.slug;
    if (typeof slug !== "string" || !slug.trim()) {
      return NextResponse.json(
        { error: "slug must be a non-empty string" },
        { status: 400 },
      );
    }
    const trimmed = slug.trim();
    if (!SLUG_RE.test(trimmed)) {
      return NextResponse.json(
        { error: "slug must match /^[a-z0-9-]+$/" },
        { status: 400 },
      );
    }
    if (trimmed.length > 200) {
      return NextResponse.json(
        { error: "slug must be at most 200 characters" },
        { status: 400 },
      );
    }
    const conflict = await queryOne<{ id: number }>(
      "SELECT id FROM products WHERE slug = $1 AND id != $2",
      [trimmed, productId],
    );
    if (conflict) {
      return NextResponse.json(
        { error: "slug already in use by another product" },
        { status: 409 },
      );
    }
    values.push(trimmed);
    updates.push(`slug = $${values.length}`);
  }

  // description
  if ("description" in body) {
    const desc = body.description;
    if (desc !== null && typeof desc !== "string") {
      return NextResponse.json(
        { error: "description must be a string or null" },
        { status: 400 },
      );
    }
    values.push(typeof desc === "string" ? desc.trim() || null : null);
    updates.push(`description = $${values.length}`);
  }

  // image_url
  if ("image_url" in body) {
    const url = body.image_url;
    if (url !== null && typeof url !== "string") {
      return NextResponse.json(
        { error: "image_url must be a string or null" },
        { status: 400 },
      );
    }
    values.push(typeof url === "string" ? url.trim() || null : null);
    updates.push(`image_url = $${values.length}`);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  values.push(productId);
  const sql = `UPDATE products SET ${updates.join(", ")} WHERE id = $${values.length}
    RETURNING id, name, slug, is_published, description, image_url,
              unit_price, oem_code, unit, category, current_stock, min_stock, created_at`;

  try {
    const rows = await query<{
      id: number;
      name: string;
      slug: string | null;
      is_published: boolean;
      description: string | null;
      image_url: string | null;
      unit_price: string;
      oem_code: string | null;
      unit: string;
      category: string | null;
      current_stock: number;
      min_stock: number;
      created_at: Date;
    }>(sql, values);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "product not found" },
        { status: 404 },
      );
    }

    const r = rows[0];
    return NextResponse.json({
      id: r.id,
      name: r.name,
      slug: r.slug,
      isPublished: r.is_published,
      description: r.description,
      imageUrl: r.image_url,
      unitPrice: Number(r.unit_price),
      oemCode: r.oem_code,
      unit: r.unit,
      category: r.category,
      currentStock: r.current_stock,
      minStock: r.min_stock,
      createdAt:
        r.created_at instanceof Date
          ? r.created_at.toISOString()
          : String(r.created_at),
    });
  } catch (err) {
    console.error("[products/publish] POST error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
