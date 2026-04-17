import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

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
