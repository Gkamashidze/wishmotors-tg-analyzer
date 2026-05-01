import { type NextRequest, NextResponse } from "next/server";
import { getCatalogEnginesByModel, getCatalogYearRangeByModel } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const model = req.nextUrl.searchParams.get("model");
  if (!model) {
    return NextResponse.json({ engines: [], yearRange: null });
  }
  try {
    const [engines, yearRange] = await Promise.all([
      getCatalogEnginesByModel(model),
      getCatalogYearRangeByModel(model),
    ]);
    return NextResponse.json(
      { engines, yearRange },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (err) {
    console.error("[/api/public/catalog/engines]", err);
    return NextResponse.json({ engines: [], yearRange: null });
  }
}
