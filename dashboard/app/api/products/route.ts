import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { PRODUCTS_PAGE_SIZE } from "@/lib/constants";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const negativeOnly = searchParams.get("negativeStock") === "true";
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? PRODUCTS_PAGE_SIZE)));
  const offset = (page - 1) * limit;

  const rows = await query<{
    id: number;
    name: string;
    oem_code: string | null;
    current_stock: number;
    min_stock: number;
    unit_price: string;
    unit: string;
    category: string | null;
    compatibility_notes: string | null;
    created_at: Date;
    total_count: string;
  }>(
    `SELECT id, name, oem_code, current_stock, min_stock, unit_price, unit,
            category, compatibility_notes, created_at,
            COUNT(*) OVER() AS total_count
     FROM products
     ${negativeOnly ? "WHERE current_stock < 0" : ""}
     ORDER BY name ASC, created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      oemCode: r.oem_code,
      currentStock: r.current_stock,
      minStock: r.min_stock,
      unitPrice: Number(r.unit_price),
      unit: r.unit,
      category: r.category,
      compatibilityNotes: r.compatibility_notes,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    })),
    total,
    page,
    limit,
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : null;

  if (!name) {
    return NextResponse.json({ error: "სახელი სავალდებულოა" }, { status: 400 });
  }

  const oemCode = typeof body.oem_code === "string" ? body.oem_code.trim() || null : null;
  const unit = typeof body.unit === "string" && body.unit.trim() ? body.unit.trim() : "ცალი";
  const unitPrice = Number(body.unit_price ?? 0);
  const currentStock = Number(body.current_stock ?? 0);
  const minStock = Number(body.min_stock ?? 0);
  const category = typeof body.category === "string" ? body.category.trim() || null : null;
  const compatibilityNotes = typeof body.compatibility_notes === "string" ? body.compatibility_notes.trim() || null : null;

  if (oemCode) {
    const existing = await query<{ id: number }>(
      "SELECT id FROM products WHERE oem_code = $1 LIMIT 1",
      [oemCode],
    );
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "ამ OEM კოდით პროდუქტი უკვე არსებობს" },
        { status: 409 },
      );
    }
  }

  const created = await query<{ id: number; name: string }>(
    `INSERT INTO products (name, oem_code, unit, unit_price, current_stock, min_stock, category, compatibility_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, name`,
    [name, oemCode, unit, unitPrice, currentStock, minStock, category, compatibilityNotes],
  );

  return NextResponse.json({ id: created[0].id, name: created[0].name }, { status: 201 });
}
