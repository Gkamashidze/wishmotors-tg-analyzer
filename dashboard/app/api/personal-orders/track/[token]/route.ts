import { NextRequest, NextResponse } from "next/server";
import { getPersonalOrderByToken } from "@/lib/personal-orders-queries";

export const dynamic = "force-dynamic";

type Params = Promise<{ token: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const { token } = await params;
  if (!token || !/^[0-9a-f]{32}$/i.test(token)) {
    return NextResponse.json({ error: "invalid token" }, { status: 400 });
  }
  const order = await getPersonalOrderByToken(token);
  if (!order) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(order);
}
