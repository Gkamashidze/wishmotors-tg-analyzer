import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isFinite(productId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const [sales, orders] = await Promise.all([
    query<{
      id: number;
      quantity: number;
      unit_price: string;
      payment_method: string;
      customer_name: string | null;
      sold_at: Date;
      notes: string | null;
      topic_id: number | null;
      topic_message_id: number | null;
    }>(
      `SELECT id, quantity, unit_price, payment_method, customer_name,
              sold_at, notes, topic_id, topic_message_id
       FROM sales
       WHERE product_id = $1
       ORDER BY sold_at DESC`,
      [productId],
    ),
    query<{
      id: number;
      quantity_needed: number;
      status: string;
      priority: string;
      created_at: Date;
      notes: string | null;
      topic_id: number | null;
      topic_message_id: number | null;
    }>(
      `SELECT id, quantity_needed, status, priority, created_at,
              notes, topic_id, topic_message_id
       FROM orders
       WHERE product_id = $1
       ORDER BY created_at DESC`,
      [productId],
    ),
  ]);

  return NextResponse.json({
    sales: sales.map((r) => ({
      id: r.id,
      quantity: r.quantity,
      unitPrice: Number(r.unit_price),
      paymentMethod: r.payment_method,
      customerName: r.customer_name,
      soldAt: r.sold_at instanceof Date ? r.sold_at.toISOString() : String(r.sold_at),
      notes: r.notes,
      topicId: r.topic_id,
      topicMessageId: r.topic_message_id,
    })),
    orders: orders.map((r) => ({
      id: r.id,
      quantityNeeded: r.quantity_needed,
      status: r.status,
      priority: r.priority,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      notes: r.notes,
      topicId: r.topic_id,
      topicMessageId: r.topic_message_id,
    })),
  });
}
