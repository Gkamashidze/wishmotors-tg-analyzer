import "server-only";
import { NextResponse } from "next/server";
import { getProductMetrics } from "@/lib/financial-queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const to = new Date();
  const from = new Date(Date.now() - 90 * 86400000);
  try {
    const rows = await getProductMetrics(from, to, 500);
    return NextResponse.json(rows);
  } catch (err) {
    console.error("[products/metrics] error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
