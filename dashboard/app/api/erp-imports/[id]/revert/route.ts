import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// ── POST /api/erp-imports/[id]/revert ─────────────────────────────────────────
// Safe rollback (inside a transaction):
//   1. Validate import is 'completed'
//   2. For each item: subtract stock, delete inventory_batch, delete ledger entries
//   3. Recalculate WAC per affected product
//   4. Set import status back to 'draft'

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const importId = Number(id);
  if (isNaN(importId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    await withTransaction(async (client) => {
      // Lock and validate
      const impRes = await client.query(
        "SELECT id, status FROM imports WHERE id = $1 FOR UPDATE",
        [importId],
      );
      const imp = impRes.rows[0];
      if (!imp) throw new Error("Import not found");
      if (imp.status !== "completed") throw new Error("Only completed imports can be reverted");

      // Gather items
      const itemsRes = await client.query(
        `SELECT product_id, quantity FROM import_items WHERE import_id = $1`,
        [importId],
      );
      const items = itemsRes.rows;

      const refBase = `erp_import:${importId}`;

      // Delete ledger entries for this import
      await client.query(
        "DELETE FROM ledger WHERE reference_id = $1",
        [refBase],
      );

      for (const it of items) {
        const qty = Number(it.quantity);

        // Subtract stock (floor at 0 to avoid negative)
        await client.query(
          `UPDATE products
           SET current_stock = GREATEST(0, current_stock - $1)
           WHERE id = $2`,
          [qty, it.product_id],
        );

        // Remove inventory batches created by this import
        await client.query(
          `DELETE FROM inventory_batches
           WHERE product_id = $1 AND reference = $2`,
          [it.product_id, `${refBase}:${it.product_id}`],
        );

        // Recalculate WAC from remaining batches
        const wacRes = await client.query(
          `SELECT SUM(remaining_quantity * unit_cost) / NULLIF(SUM(remaining_quantity), 0) AS wac
           FROM inventory_batches
           WHERE product_id = $1 AND remaining_quantity > 0`,
          [it.product_id],
        );
        const wac = Number(wacRes.rows[0]?.wac ?? 0);
        await client.query(
          "UPDATE products SET unit_price = $1 WHERE id = $2",
          [wac, it.product_id],
        );
      }

      // Set back to draft
      await client.query(
        "UPDATE imports SET status = 'draft', updated_at = NOW() WHERE id = $1",
        [importId],
      );
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[erp-imports/:id/revert]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
