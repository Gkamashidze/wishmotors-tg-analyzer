import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import {
  getGlobalFinancialMetrics,
  type FinancialMetricsData,
} from "@/lib/financial-queries";

export const dynamic = "force-dynamic";

export type FinancialMetricsResponse = FinancialMetricsData;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");

  if (!fromStr || !toStr) {
    return NextResponse.json({ error: "from and to required" }, { status: 400 });
  }

  const from = new Date(fromStr);
  const to = new Date(toStr);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "invalid dates" }, { status: 400 });
  }

  try {
    const metrics = await getGlobalFinancialMetrics(from, to);
    return NextResponse.json(metrics);
  } catch (err) {
    console.error("[financial-metrics] error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
