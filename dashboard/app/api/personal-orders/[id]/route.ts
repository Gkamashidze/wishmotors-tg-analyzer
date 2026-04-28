import { NextRequest, NextResponse } from "next/server";
import {
  getPersonalOrderById,
  updatePersonalOrder,
  deletePersonalOrder,
} from "@/lib/personal-orders-queries";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const order = await getPersonalOrderById(rowId);
  if (!order) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(order);
}

export async function PUT(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    const body = await req.json() as Record<string, unknown>;
    const allowed = [
      "customer_name", "customer_contact", "part_name", "oem_code",
      "cost_price", "transportation_cost", "vat_amount",
      "sale_price", "amount_paid", "status", "estimated_arrival", "notes",
    ];
    const data = Object.fromEntries(
      Object.entries(body).filter(([k]) => allowed.includes(k)),
    );
    await updatePersonalOrder(rowId, data as Parameters<typeof updatePersonalOrder>[1]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[personal-orders PUT]", err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await deletePersonalOrder(rowId);
  return NextResponse.json({ ok: true });
}
