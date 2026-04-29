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
    const { customer_name, sale_price } = body;

    if (!customer_name || typeof customer_name !== "string") {
      return NextResponse.json({ error: "customer_name required" }, { status: 400 });
    }
    if (!sale_price || typeof sale_price !== "number" || sale_price <= 0) {
      return NextResponse.json({ error: "sale_price must be a positive number" }, { status: 400 });
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const items = (rawItems as { part_name?: unknown; oem_code?: unknown }[])
      .filter((i) => typeof i.part_name === "string" && i.part_name.trim())
      .map((i) => ({
        part_name: (i.part_name as string).trim(),
        oem_code: typeof i.oem_code === "string" ? i.oem_code.trim().toUpperCase() || null : null,
      }));

    if (!items.length) {
      return NextResponse.json({ error: "at least one item required" }, { status: 400 });
    }

    const order = await createPersonalOrder({
      customer_name: customer_name.trim(),
      customer_contact: typeof body.customer_contact === "string" ? body.customer_contact.trim() || null : null,
      items,
      cost_price: typeof body.cost_price === "number" ? body.cost_price : null,
      transportation_cost: typeof body.transportation_cost === "number" ? body.transportation_cost : null,
      vat_amount: typeof body.vat_amount === "number" ? body.vat_amount : null,
      sale_price_min: typeof body.sale_price_min === "number" ? body.sale_price_min : null,
      sale_price,
      sale_price_currency: body.sale_price_currency === "USD" ? "USD" : "GEL",
      estimated_arrival: typeof body.estimated_arrival === "string" ? body.estimated_arrival || null : null,
      notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
    });

    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    console.error("[personal-orders POST]", err);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
}
