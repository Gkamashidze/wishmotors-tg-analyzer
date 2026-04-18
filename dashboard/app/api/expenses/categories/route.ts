import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  const rows = await query<{ category: string }>(
    `SELECT DISTINCT category
     FROM expenses
     WHERE category IS NOT NULL AND category <> ''
     ORDER BY category ASC`,
    [],
  );

  return NextResponse.json(rows.map((r) => r.category));
}
