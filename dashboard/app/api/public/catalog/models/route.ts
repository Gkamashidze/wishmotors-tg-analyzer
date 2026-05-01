import { NextResponse } from "next/server";
import { getCatalogModels } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const models = await getCatalogModels();
    return NextResponse.json(
      { models },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (err) {
    console.error("[/api/public/catalog/models]", err);
    return NextResponse.json({ models: [] });
  }
}
