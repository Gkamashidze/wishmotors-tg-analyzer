import { type NextRequest, NextResponse } from "next/server";
import { getDashboardSummaryRange, type SellerFilter } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
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
    const summary = await getDashboardSummaryRange(from, to, sellerType);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("dashboard/summary error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
