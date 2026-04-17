import { type NextRequest, NextResponse } from "next/server";
import { getDashboardSummaryRange } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
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
    const summary = await getDashboardSummaryRange(from, to);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("dashboard/summary error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
