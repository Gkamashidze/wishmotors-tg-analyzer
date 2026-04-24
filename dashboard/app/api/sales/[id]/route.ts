import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, withTransaction } from "@/lib/db";
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

interface CurrentSaleState extends SaleRecord {
  old_product_id: number | null;
  old_qty: number;
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
    oem_code,
    product_name,
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

  const newQty = Number(quantity);
  const oemStr = typeof oem_code === "string" ? oem_code.trim() : "";
  const nameStr = typeof product_name === "string" ? product_name.trim() : "";

  type TelegramPayload = { topicId: number; msgId: number; text: string };

  const telegramPayload = await withTransaction(async (client): Promise<TelegramPayload | null> => {
    // 1. Fetch the current sale along with old product info
    const row = await client.query<CurrentSaleState>(
      `SELECT s.product_id  AS old_product_id,
              s.quantity     AS old_qty,
              s.topic_id,
              s.topic_message_id,
              p.name         AS product_name,
              s.unit_price,
              s.payment_method,
              s.customer_name,
              s.notes
       FROM sales s
       LEFT JOIN products p ON p.id = s.product_id
       WHERE s.id = $1`,
      [rowId],
    );

    const sale = row.rows[0];
    if (!sale) throw new Error("not found");

    const oldProductId: number | null = sale.old_product_id;
    const oldQty: number = Number(sale.old_qty);

    // 2. Resolve the new product
    //    Priority: if oem_code provided → find or create by OEM; else use product_id from body.
    let newProductId: number | null = product_id != null ? Number(product_id) : null;

    if (oemStr) {
      const byOem = await client.query<{ id: number }>(
        "SELECT id FROM products WHERE oem_code = $1 LIMIT 1",
        [oemStr],
      );

      if (byOem.rows.length > 0) {
        newProductId = byOem.rows[0].id;
      } else {
        // OEM not found — auto-create the product so stock can be tracked
        const newName = nameStr || oemStr;
        const created = await client.query<{ id: number }>(
          `INSERT INTO products (name, oem_code, current_stock, min_stock, unit_price, unit)
           VALUES ($1, $2, 0, 20, 0, 'ცალი')
           RETURNING id`,
          [newName, oemStr],
        );
        newProductId = created.rows[0].id;
      }
    }

    // 3. Apply stock adjustments inside the same transaction
    const productChanged = newProductId !== oldProductId;

    if (productChanged) {
      // Restore full quantity back to the original product
      if (oldProductId != null) {
        await client.query(
          "UPDATE products SET current_stock = current_stock + $1 WHERE id = $2",
          [oldQty, oldProductId],
        );
      }
      // Deduct the new quantity from the newly selected product
      if (newProductId != null) {
        await client.query(
          "UPDATE products SET current_stock = current_stock - $1 WHERE id = $2",
          [newQty, newProductId],
        );
      }
    } else if (newProductId != null && newQty !== oldQty) {
      // Same product, only quantity changed — apply the delta
      const delta = newQty - oldQty;
      await client.query(
        "UPDATE products SET current_stock = current_stock - $1 WHERE id = $2",
        [delta, newProductId],
      );
    }

    // 4. Update the sale record
    await client.query(
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
        newProductId ?? null,
        newQty,
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

    // 5. Build Telegram sync payload — fired after COMMIT to avoid holding the connection
    if (sale.topic_id && sale.topic_message_id && GROUP_ID) {
      const newText = buildSaleText(sale, rowId, {
        quantity: newQty,
        unit_price: String(unit_price),
        payment_method: String(payment_method),
        customer_name: (customer_name as string | null) ?? null,
        notes: (notes as string | null) ?? null,
      });
      return { topicId: sale.topic_id, msgId: sale.topic_message_id, text: newText };
    }
    return null;
  });

  if (telegramPayload) {
    void telegramMarkUpdated(GROUP_ID, telegramPayload.msgId, telegramPayload.text);
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
