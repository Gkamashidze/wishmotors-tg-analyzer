import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { telegramMarkUpdated } from "@/lib/telegram";
import { formatTopicOrder } from "@/lib/formatters";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

interface OrderRecord {
  topic_id: number | null;
  topic_message_id: number | null;
  product_name: string | null;
  quantity_needed: number;
  priority: string;
  notes: string | null;
}

const VALID_STATUSES = new Set([
  "new", "processing", "ordered", "ready", "delivered", "cancelled", "fulfilled",
]);

const GROUP_ID = Number(process.env.GROUP_ID ?? "0");

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = await req.json() as { status?: unknown };
  const status = String(body.status ?? "");

  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const current = await queryOne<OrderRecord>(
    `SELECT o.topic_id, o.topic_message_id,
            p.name AS product_name,
            o.quantity_needed, o.priority, o.notes
     FROM orders o
     LEFT JOIN products p ON p.id = o.product_id
     WHERE o.id = $1`,
    [rowId],
  );

  if (!current) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await query("UPDATE orders SET status = $2 WHERE id = $1", [rowId, status]);

  if (current.topic_id && current.topic_message_id && GROUP_ID) {
    const newText = formatTopicOrder({
      productName: current.product_name ?? `#${rowId}`,
      qty: Number(current.quantity_needed),
      status,
      priority: current.priority,
      orderId: rowId,
      notes: current.notes,
    });
    void telegramMarkUpdated(GROUP_ID, current.topic_message_id, newText);
  }

  return NextResponse.json({ ok: true });
}
