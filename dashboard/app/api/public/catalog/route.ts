import { NextRequest, NextResponse } from "next/server";
import { getPublicCatalog } from "@/lib/queries";
import { query as dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const category = searchParams.get("category")?.trim() || undefined;
  const search = searchParams.get("search")?.trim() || undefined;
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit = Math.min(48, Math.max(1, Number(searchParams.get("limit") ?? 24)));

  try {
    const result = await getPublicCatalog({ category, search, page, limit });

    if (result.total === 0 && search) {
      dbQuery(
        "INSERT INTO lost_searches (query, source, results_count) VALUES ($1, 'catalog', 0)",
        [search],
      ).catch(() => {});
    }

    return NextResponse.json(result, { headers: CACHE_HEADERS });
  } catch (err) {
    console.error("[api/public/catalog] GET error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
