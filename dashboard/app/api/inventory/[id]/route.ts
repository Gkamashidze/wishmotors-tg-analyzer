import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { telegramMarkUpdated } from "@/lib/telegram";
import { formatTopicSale, formatTopicOrder } from "@/lib/formatters";

type Params = Promise<{ id: string }>;

const GROUP_ID = Number(process.env.GROUP_ID ?? "0");

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const { name, oem_code, current_stock, min_stock, unit_price, unit } = body;

  const prev = await queryOne<{ name: string }>(
    "SELECT name FROM products WHERE id = $1",
    [rowId],
  );

  await query(
    `UPDATE products SET
      name          = $2,
      oem_code      = $3,
      current_stock = $4,
      min_stock     = $5,
      unit_price    = $6,
      unit          = $7
    WHERE id = $1`,
    [rowId, name, oem_code ?? null, current_stock, min_stock, unit_price, unit],
  );

  if (prev && prev.name !== (name as string) && GROUP_ID) {
    const newName = name as string;
    void (async () => {
      const sales = await query<{
        id: number;
        topic_id: number;
        topic_message_id: number;
        quantity: number;
        unit_price: string;
        payment_method: string;
        customer_name: string | null;
      }>(
        `SELECT id, topic_id, topic_message_id, quantity, unit_price,
                payment_method, customer_name
         FROM sales
         WHERE product_id = $1
           AND topic_id IS NOT NULL AND topic_message_id IS NOT NULL`,
        [rowId],
      );
      for (const s of sales) {
        const text = formatTopicSale({
          productName: newName,
          qty: s.quantity,
          price: Number(s.unit_price),
          paymentMethod: s.payment_method,
          saleId: s.id,
          customerName: s.customer_name,
        });
        await telegramMarkUpdated(GROUP_ID, s.topic_message_id, text);
      }

      const orders = await query<{
        id: number;
        topic_id: number;
        topic_message_id: number;
        quantity_needed: number;
        status: string;
        priority: string;
        notes: string | null;
      }>(
        `SELECT id, topic_id, topic_message_id, quantity_needed,
                status, priority, notes
         FROM orders
         WHERE product_id = $1
           AND topic_id IS NOT NULL AND topic_message_id IS NOT NULL`,
        [rowId],
      );
      for (const o of orders) {
        const text = formatTopicOrder({
          productName: newName,
          qty: o.quantity_needed,
          status: o.status,
          priority: o.priority,
          orderId: o.id,
          notes: o.notes,
        });
        await telegramMarkUpdated(GROUP_ID, o.topic_message_id, text);
      }
    })();
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  await query("DELETE FROM products WHERE id = $1", [rowId]);
  return NextResponse.json({ ok: true });
}
