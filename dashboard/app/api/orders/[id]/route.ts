import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { telegramMarkCancelled, telegramMarkUpdated } from "@/lib/telegram";
import { formatTopicOrder } from "@/lib/formatters";

type Params = Promise<{ id: string }>;

interface OrderRecord {
  topic_id: number | null;
  topic_message_id: number | null;
  product_name: string | null;
  quantity_needed: number;
  status: string;
  priority: string;
  notes: string | null;
}

const GROUP_ID = Number(process.env.GROUP_ID ?? "0");

async function fetchOrder(rowId: number): Promise<OrderRecord | null> {
  return queryOne<OrderRecord>(
    `SELECT o.topic_id, o.topic_message_id,
            p.name AS product_name,
            o.quantity_needed, o.status, o.priority, o.notes
     FROM orders o
     LEFT JOIN products p ON p.id = o.product_id
     WHERE o.id = $1`,
    [rowId],
  );
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = await req.json() as Record<string, unknown>;
  const { product_id, quantity_needed, status, priority, notes, oem_code } = body;

  const current = await fetchOrder(rowId);

  await query(
    `UPDATE orders SET
      product_id      = $2,
      quantity_needed = $3,
      status          = $4,
      priority        = $5,
      notes           = $6,
      oem_code        = $7
    WHERE id = $1`,
    [rowId, product_id ?? null, quantity_needed, status, priority, notes ?? null, oem_code ?? null],
  );

  if (current?.topic_id && current.topic_message_id && GROUP_ID) {
    const newText = formatTopicOrder({
      productName: current.product_name ?? `#${rowId}`,
      qty: Number(quantity_needed),
      status: String(status),
      priority: String(priority),
      orderId: rowId,
      notes: (notes as string | null) ?? null,
    });
    void telegramMarkUpdated(GROUP_ID, current.topic_message_id, newText);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const current = await fetchOrder(rowId);

  await query("DELETE FROM orders WHERE id = $1", [rowId]);

  if (current?.topic_id && current.topic_message_id && GROUP_ID) {
    const originalText = formatTopicOrder({
      productName: current.product_name ?? `#${rowId}`,
      qty: Number(current.quantity_needed),
      status: current.status,
      priority: current.priority,
      orderId: rowId,
      notes: current.notes,
    });
    void telegramMarkCancelled(GROUP_ID, current.topic_message_id, originalText);
  }

  return NextResponse.json({ ok: true });
}
