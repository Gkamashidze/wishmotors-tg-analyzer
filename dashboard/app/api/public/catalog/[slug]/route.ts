import { NextRequest, NextResponse } from "next/server";
import { getPublicProduct } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const { slug } = await params;

  try {
    const product = await getPublicProduct(slug);
    if (!product) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(product, { headers: CACHE_HEADERS });
  } catch (err) {
    console.error("[api/public/catalog/slug] GET error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
