import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const negativeOnly = searchParams.get("negativeStock") === "true";

  const rows = await query<{
    id: number;
    name: string;
    oem_code: string | null;
    current_stock: number;
    min_stock: number;
    unit_price: string;
    unit: string;
    created_at: Date;
  }>(
    `SELECT id, name, oem_code, current_stock, min_stock, unit_price, unit, created_at
     FROM products
     ${negativeOnly ? "WHERE current_stock < 0" : ""}
     ORDER BY name ASC, created_at DESC`,
  );

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      oemCode: r.oem_code,
      currentStock: r.current_stock,
      minStock: r.min_stock,
      unitPrice: Number(r.unit_price),
      unit: r.unit,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    })),
  );
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : null;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const existing = await query<{ id: number; name: string }>(
    "SELECT id, name FROM products WHERE LOWER(name) = LOWER($1) LIMIT 1",
    [name],
  );

  if (existing.length > 0) {
    return NextResponse.json({ id: existing[0].id, name: existing[0].name });
  }

  const created = await query<{ id: number; name: string }>(
    "INSERT INTO products (name) VALUES ($1) RETURNING id, name",
    [name],
  );

  return NextResponse.json({ id: created[0].id, name: created[0].name }, { status: 201 });
}
