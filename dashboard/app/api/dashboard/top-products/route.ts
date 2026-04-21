import { NextRequest, NextResponse } from "next/server";
import {
  getTopSellingProducts,
  getTopProfitableProducts,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const limit = Math.min(Number(searchParams.get("limit") ?? 10), 50);

  const from = fromParam ? new Date(fromParam) : undefined;
  const to = toParam ? new Date(toParam) : undefined;

  const [topSelling, topProfitable] = await Promise.all([
    getTopSellingProducts(limit, from, to),
    getTopProfitableProducts(limit, from, to),
  ]);

  return NextResponse.json({ topSelling, topProfitable });
}
