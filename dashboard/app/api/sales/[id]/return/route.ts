import { NextRequest, NextResponse } from "next/server";
import { queryOne, withTransaction } from "@/lib/db";
import { telegramMarkCancelled } from "@/lib/telegram";
import { formatTopicSale } from "@/lib/formatters";

type Params = Promise<{ id: string }>;

const GROUP_ID = Number(process.env.GROUP_ID ?? "0");

interface SaleForReturn {
  product_id: number | null;
  quantity: number;
  unit_price: string;
  cost_amount: string;
  payment_method: string;
  topic_id: number | null;
  topic_message_id: number | null;
  product_name: string | null;
  customer_name: string | null;
  notes: string | null;
}

// POST /api/sales/:id/return
// Body: { refund_method: "cash" | "bank" }
//
// Atomically:
//   1. Inserts a row in `returns` with refund_method
//   2. Restores product stock
//   3. Restores inventory batch at original unit cost (so WAC stays correct)
//   4. Deletes the sale row
export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = await req.json() as Record<string, unknown>;
  const refundMethod = body.refund_method as string;
  if (refundMethod !== "cash" && refundMethod !== "bank") {
    return NextResponse.json({ error: "refund_method must be 'cash' or 'bank'" }, { status: 400 });
  }

  const sale = await queryOne<SaleForReturn>(
    `SELECT s.product_id, s.quantity, s.unit_price, s.cost_amount, s.payment_method,
            s.topic_id, s.topic_message_id,
            p.name AS product_name, s.customer_name, s.notes
     FROM sales s
     LEFT JOIN products p ON p.id = s.product_id
     WHERE s.id = $1`,
    [rowId],
  );

  if (!sale) {
    return NextResponse.json({ error: "sale not found" }, { status: 404 });
  }

  const qty = Number(sale.quantity);
  const unitPrice = Number(sale.unit_price);
  const costAmount = Number(sale.cost_amount);
  const refundAmount = +(unitPrice * qty).toFixed(2);
  const unitCost = qty > 0 ? +(costAmount / qty).toFixed(4) : 0;

  await withTransaction(async (client) => {
    // 1. Record the return with the chosen refund method
    await client.query(
      `INSERT INTO returns (sale_id, product_id, quantity, refund_amount, refund_method)
       VALUES ($1, $2, $3, $4, $5)`,
      [rowId, sale.product_id, qty, refundAmount, refundMethod],
    );

    if (sale.product_id !== null) {
      // 2. Restore product stock
      await client.query(
        `UPDATE products SET current_stock = current_stock + $1 WHERE id = $2`,
        [qty, sale.product_id],
      );

      // 3. Restore inventory batch at original unit cost so WAC stays consistent
      await client.query(
        `INSERT INTO inventory_batches (product_id, quantity, remaining_quantity, unit_cost, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [sale.product_id, qty, qty, unitCost, `Return of sale #${rowId}`],
      );
    }

    // 4. Delete the sale
    await client.query(`DELETE FROM sales WHERE id = $1`, [rowId]);
  });

  if (sale.topic_id && sale.topic_message_id && GROUP_ID) {
    const text = formatTopicSale({
      productName: sale.product_name ?? sale.notes ?? `#${rowId}`,
      qty,
      price: unitPrice,
      paymentMethod: sale.payment_method,
      saleId: rowId,
      customerName: sale.customer_name,
    });
    void telegramMarkCancelled(GROUP_ID, sale.topic_message_id, text);
  }

  return NextResponse.json({ ok: true });
}
