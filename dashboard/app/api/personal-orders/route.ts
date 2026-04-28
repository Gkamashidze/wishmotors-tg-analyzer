import { NextRequest, NextResponse } from "next/server";
import {
  getPersonalOrders,
  createPersonalOrder,
} from "@/lib/personal-orders-queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const orders = await getPersonalOrders();
    return NextResponse.json(orders);
  } catch (err) {
    console.error("[personal-orders GET]", err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { customer_name, part_name, sale_price } = body;

    if (!customer_name || typeof customer_name !== "string") {
      return NextResponse.json({ error: "customer_name required" }, { status: 400 });
    }
    if (!part_name || typeof part_name !== "string") {
      return NextResponse.json({ error: "part_name required" }, { status: 400 });
    }
    if (!sale_price || typeof sale_price !== "number" || sale_price <= 0) {
      return NextResponse.json({ error: "sale_price must be a positive number" }, { status: 400 });
    }

    const order = await createPersonalOrder({
      customer_name: customer_name.trim(),
      customer_contact: typeof body.customer_contact === "string" ? body.customer_contact.trim() || null : null,
      part_name: part_name.trim(),
      oem_code: typeof body.oem_code === "string" ? body.oem_code.trim().toUpperCase() || null : null,
      cost_price: typeof body.cost_price === "number" ? body.cost_price : null,
      transportation_cost: typeof body.transportation_cost === "number" ? body.transportation_cost : null,
      vat_amount: typeof body.vat_amount === "number" ? body.vat_amount : null,
      sale_price_min: typeof body.sale_price_min === "number" ? body.sale_price_min : null,
      sale_price,
      estimated_arrival: typeof body.estimated_arrival === "string" ? body.estimated_arrival || null : null,
      notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
    });

    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    console.error("[personal-orders POST]", err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}
