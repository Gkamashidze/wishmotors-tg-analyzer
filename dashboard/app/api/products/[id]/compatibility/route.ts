import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isFinite(productId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const rows = await query<{
    id: number;
    model: string;
    drive: string | null;
    engine: string | null;
    fuel_type: string | null;
    year_from: number | null;
    year_to: number | null;
  }>(
    `SELECT id, model, drive, engine, fuel_type, year_from, year_to
     FROM product_compatibility
     WHERE product_id = $1
     ORDER BY model, year_from`,
    [productId],
  );

  return NextResponse.json(rows.map((r) => ({
    id: r.id,
    model: r.model,
    drive: r.drive,
    engine: r.engine,
    fuelType: r.fuel_type,
    yearFrom: r.year_from,
    yearTo: r.year_to,
  })));
}

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isFinite(productId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) {
    return NextResponse.json({ error: "მოდელი სავალდებულოა" }, { status: 400 });
  }

  const drive = typeof body.drive === "string" && body.drive ? body.drive : null;
  const engine = typeof body.engine === "string" && body.engine.trim() ? body.engine.trim() : null;
  const fuelType = typeof body.fuel_type === "string" && body.fuel_type ? body.fuel_type : null;
  const yearFrom = body.year_from ? Number(body.year_from) : null;
  const yearTo = body.year_to ? Number(body.year_to) : null;

  const [row] = await query<{
    id: number;
    model: string;
    drive: string | null;
    engine: string | null;
    fuel_type: string | null;
    year_from: number | null;
    year_to: number | null;
  }>(
    `INSERT INTO product_compatibility (product_id, model, drive, engine, fuel_type, year_from, year_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, model, drive, engine, fuel_type, year_from, year_to`,
    [productId, model, drive, engine, fuelType, yearFrom, yearTo],
  );

  return NextResponse.json({
    id: row.id,
    model: row.model,
    drive: row.drive,
    engine: row.engine,
    fuelType: row.fuel_type,
    yearFrom: row.year_from,
    yearTo: row.year_to,
  }, { status: 201 });
}
