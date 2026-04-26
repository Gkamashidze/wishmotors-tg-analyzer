import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import {
  getGlobalFinancialMetrics,
  type FinancialMetricsData,
} from "@/lib/financial-queries";
import type { SellerFilter } from "@/lib/queries";

export const dynamic = "force-dynamic";

export type FinancialMetricsResponse = FinancialMetricsData;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  const sellerTypeRaw = searchParams.get("sellerType") ?? "all";

  if (!fromStr || !toStr) {
    return NextResponse.json({ error: "from and to required" }, { status: 400 });
  }

  const from = new Date(fromStr);
  const to = new Date(toStr);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "invalid dates" }, { status: 400 });
  }

  const sellerType: SellerFilter =
    sellerTypeRaw === "llc" || sellerTypeRaw === "individual" ? sellerTypeRaw : "all";

  try {
    const metrics = await getGlobalFinancialMetrics(from, to, sellerType);
    return NextResponse.json(metrics);
  } catch (err) {
    console.error("[financial-metrics] error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
