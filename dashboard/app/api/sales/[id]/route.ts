import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { telegramMarkCancelled, telegramMarkUpdated } from "@/lib/telegram";
import { formatTopicSale } from "@/lib/formatters";

type Params = Promise<{ id: string }>;

interface SaleRecord {
  topic_id: number | null;
  topic_message_id: number | null;
  product_name: string | null;
  quantity: number;
  unit_price: string;
  payment_method: string;
  customer_name: string | null;
  notes: string | null;
}

const GROUP_ID = Number(process.env.GROUP_ID ?? "0");

async function fetchSale(rowId: number): Promise<SaleRecord | null> {
  return queryOne<SaleRecord>(
    `SELECT s.topic_id, s.topic_message_id,
            p.name AS product_name,
            s.quantity, s.unit_price, s.payment_method,
            s.customer_name, s.notes
     FROM sales s
     LEFT JOIN products p ON p.id = s.product_id
     WHERE s.id = $1`,
    [rowId],
  );
}

function buildSaleText(sale: SaleRecord, saleId: number, overrides?: Partial<SaleRecord>): string {
  const s = { ...sale, ...overrides };
  return formatTopicSale({
    productName: s.product_name ?? s.notes ?? `#${saleId}`,
    qty: Number(s.quantity),
    price: Number(s.unit_price),
    paymentMethod: s.payment_method,
    saleId,
    customerName: s.customer_name,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = await req.json() as Record<string, unknown>;
  const {
    product_id,
    quantity,
    unit_price,
    cost_amount,
    payment_method,
    seller_type,
    customer_name,
    sold_at,
    notes,
    vat_amount,
    is_vat_included,
  } = body;

  const current = await fetchSale(rowId);

  await query(
    `UPDATE sales SET
      product_id      = $2,
      quantity        = $3,
      unit_price      = $4,
      cost_amount     = $5,
      payment_method  = $6,
      seller_type     = $7,
      customer_name   = $8,
      sold_at         = $9,
      notes           = $10,
      vat_amount      = $11,
      is_vat_included = $12
    WHERE id = $1`,
    [
      rowId,
      product_id ?? null,
      quantity,
      unit_price,
      cost_amount,
      payment_method,
      seller_type,
      customer_name ?? null,
      sold_at,
      notes ?? null,
      vat_amount ?? 0,
      is_vat_included ?? false,
    ],
  );

  if (current?.topic_id && current.topic_message_id && GROUP_ID) {
    const newText = buildSaleText(current, rowId, {
      quantity: Number(quantity),
      unit_price: String(unit_price),
      payment_method: String(payment_method),
      customer_name: (customer_name as string | null) ?? null,
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

  const current = await fetchSale(rowId);

  await query("DELETE FROM sales WHERE id = $1", [rowId]);

  if (current?.topic_id && current.topic_message_id && GROUP_ID) {
    const originalText = buildSaleText(current, rowId);
    void telegramMarkCancelled(GROUP_ID, current.topic_message_id, originalText);
  }

  return NextResponse.json({ ok: true });
}
