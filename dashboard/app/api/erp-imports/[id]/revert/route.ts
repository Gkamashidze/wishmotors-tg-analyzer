import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// ── POST /api/erp-imports/[id]/revert ─────────────────────────────────────────
// Safe rollback — reverses all 3 item types:
//   inventory    → subtract stock, delete inventory_batch, recalculate WAC
//   fixed_asset  → delete fixed_assets row
//   consumable   → delete expenses row (by source_reference)
// + always deletes ledger entries for this import

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

      // Gather items with their type
      const itemsRes = await client.query(
        `SELECT product_id, quantity, item_type
         FROM import_items WHERE import_id = $1`,
        [importId],
      );
      const items = itemsRes.rows;

      const refBase = `erp_import:${importId}`;

      // Delete all ledger entries for this import (covers all item types)
      await client.query(
        "DELETE FROM ledger WHERE reference_id = $1",
        [refBase],
      );

      for (const it of items) {
        const qty      = Number(it.quantity);
        const itemType = (it.item_type as string) || "inventory";
        const itemRef  = `${refBase}:${it.product_id}`;

        if (itemType === "inventory") {
          // Subtract stock (floor at 0)
          await client.query(
            `UPDATE products
             SET current_stock = GREATEST(0, current_stock - $1)
             WHERE id = $2`,
            [qty, it.product_id],
          );

          // Remove inventory batch created by this import
          await client.query(
            `DELETE FROM inventory_batches
             WHERE product_id = $1 AND reference = $2`,
            [it.product_id, itemRef],
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

        } else if (itemType === "fixed_asset") {
          // Remove fixed asset entry created by this import
          await client.query(
            "DELETE FROM fixed_assets WHERE reference = $1",
            [itemRef],
          );

        } else {
          // consumable — remove generated expense record
          await client.query(
            "DELETE FROM expenses WHERE source_reference = $1",
            [itemRef],
          );
        }
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
