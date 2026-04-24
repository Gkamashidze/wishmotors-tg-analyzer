import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// ── POST /api/erp-imports/[id]/finalize ───────────────────────────────────────
// Atomically:
//   1. Validate import is a draft with items
//   2. For each item: add stock, create inventory_batch, post ledger (DR 1300 / CR 2100)
//   3. Mark import as 'completed'

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const importId = Number(id);
  if (isNaN(importId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    await withTransaction(async (client) => {
      // Lock and validate
      const impRes = await client.query(
        `SELECT id, date, supplier, exchange_rate,
                total_transport_cost, total_terminal_cost,
                total_agency_cost, total_vat_cost, status
         FROM imports WHERE id = $1 FOR UPDATE`,
        [importId],
      );
      const imp = impRes.rows[0];
      if (!imp) throw new Error("Import not found");
      if (imp.status !== "draft") throw new Error("Import is already completed");

      const itemsRes = await client.query(
        `SELECT ii.product_id, p.name AS product_name, p.oem_code,
                ii.quantity, ii.unit, ii.landed_cost_per_unit_gel, ii.total_price_gel
         FROM import_items ii
         JOIN products p ON p.id = ii.product_id
         WHERE ii.import_id = $1`,
        [importId],
      );
      const items = itemsRes.rows;
      if (items.length === 0) throw new Error("Import has no line items");

      const refBase    = `erp_import:${importId}`;
      const importDate = imp.date instanceof Date
        ? imp.date.toISOString().slice(0, 10)
        : String(imp.date).slice(0, 10);

      for (const it of items) {
        const qty       = Number(it.quantity);
        const unitCost  = Number(it.landed_cost_per_unit_gel);
        const totalCost = Number(it.total_price_gel);

        // Add stock
        await client.query(
          "UPDATE products SET current_stock = current_stock + $1 WHERE id = $2",
          [qty, it.product_id],
        );

        // Insert inventory batch (for WAC)
        await client.query(
          `INSERT INTO inventory_batches
             (product_id, quantity, remaining_quantity, unit_cost, received_at, supplier, reference)
           VALUES ($1, $2, $2, $3, $4::date, $5, $6)`,
          [
            it.product_id,
            qty,
            unitCost,
            importDate,
            imp.supplier,
            `${refBase}:${it.product_id}`,
          ],
        );

        // Recalculate WAC and update product unit_price
        const wacRes = await client.query(
          `SELECT SUM(remaining_quantity * unit_cost) / NULLIF(SUM(remaining_quantity), 0) AS wac
           FROM inventory_batches
           WHERE product_id = $1 AND remaining_quantity > 0`,
          [it.product_id],
        );
        const wac = Number(wacRes.rows[0]?.wac ?? unitCost);
        await client.query(
          "UPDATE products SET unit_price = $1 WHERE id = $2",
          [wac, it.product_id],
        );

        // Double-entry ledger: DR 1300 Inventory / CR 2100 Accounts Payable
        const desc = `Import receipt — ${it.product_name} (${it.oem_code ?? "no OEM"})`;
        await client.query(
          `INSERT INTO ledger (transaction_date, account_code, debit_amount, credit_amount, description, reference_id)
           VALUES ($1::date,'1300',$2,0,$3,$4)`,
          [importDate, totalCost, desc, refBase],
        );
        await client.query(
          `INSERT INTO ledger (transaction_date, account_code, debit_amount, credit_amount, description, reference_id)
           VALUES ($1::date,'2100',0,$2,$3,$4)`,
          [importDate, totalCost, desc, refBase],
        );
      }

      // Mark completed
      await client.query(
        "UPDATE imports SET status = 'completed', updated_at = NOW() WHERE id = $1",
        [importId],
      );
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[erp-imports/:id/finalize]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
