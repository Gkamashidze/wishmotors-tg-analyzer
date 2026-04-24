import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// ── POST /api/erp-imports/[id]/finalize ───────────────────────────────────────
// Routes each line item based on item_type:
//   inventory    → add stock + inventory_batch + WAC + ledger DR 1300 / CR 2100
//   fixed_asset  → insert into fixed_assets + ledger DR 1600 / CR 2100
//   consumable   → insert into expenses + ledger DR 6100 / CR 2100

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const importId = Number(id);
  if (isNaN(importId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    await withTransaction(async (client) => {
      // Lock and validate
      const impRes = await client.query(
        `SELECT id, date, supplier, invoice_number, exchange_rate,
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
                ii.quantity, ii.unit, ii.landed_cost_per_unit_gel, ii.total_price_gel,
                ii.item_type, ii.recommended_price
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
      const invoiceNum = imp.invoice_number ?? `#${importId}`;

      for (const it of items) {
        const qty        = Number(it.quantity);
        const unitCost   = Number(it.landed_cost_per_unit_gel);
        const totalGel   = Number(it.total_price_gel);
        const totalLanded = unitCost * qty;
        const itemType   = (it.item_type as string) || "inventory";
        const itemRef    = `${refBase}:${it.product_id}`;
        const desc       = `${it.product_name}${it.oem_code ? ` (${it.oem_code})` : ""}`;

        if (itemType === "inventory") {
          // ── Add stock ────────────────────────────────────────────────────────
          await client.query(
            "UPDATE products SET current_stock = current_stock + $1 WHERE id = $2",
            [qty, it.product_id],
          );

          // ── Inventory batch (for WAC) ────────────────────────────────────────
          await client.query(
            `INSERT INTO inventory_batches
               (product_id, quantity, remaining_quantity, unit_cost, received_at, supplier, reference)
             VALUES ($1, $2, $2, $3, $4::date, $5, $6)`,
            [it.product_id, qty, unitCost, importDate, imp.supplier, itemRef],
          );

          // ── Recalculate WAC ──────────────────────────────────────────────────
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

          // ── Recommended price (only when set by the import form) ─────────────
          const recPrice = it.recommended_price != null ? Number(it.recommended_price) : null;
          if (recPrice !== null && recPrice > 0) {
            await client.query(
              "UPDATE products SET recommended_price = $1 WHERE id = $2",
              [recPrice, it.product_id],
            );
          }

          // ── Ledger: DR 1300 Inventory / CR 2100 Accounts Payable ─────────────
          const ledgerDesc = `Import receipt — ${desc}`;
          await client.query(
            `INSERT INTO ledger (transaction_date, account_code, debit_amount, credit_amount, description, reference_id)
             VALUES ($1::date,'1300',$2,0,$3,$4)`,
            [importDate, totalGel, ledgerDesc, refBase],
          );
          await client.query(
            `INSERT INTO ledger (transaction_date, account_code, debit_amount, credit_amount, description, reference_id)
             VALUES ($1::date,'2100',0,$2,$3,$4)`,
            [importDate, totalGel, ledgerDesc, refBase],
          );

        } else if (itemType === "fixed_asset") {
          // ── Fixed Asset registry ─────────────────────────────────────────────
          await client.query(
            `INSERT INTO fixed_assets
               (import_id, product_id, name, acquisition_date, acquisition_cost_gel, quantity, reference)
             VALUES ($1, $2, $3, $4::date, $5, $6, $7)`,
            [importId, it.product_id, it.product_name, importDate, totalLanded, qty, itemRef],
          );

          // ── Ledger: DR 1600 Fixed Assets / CR 2100 Accounts Payable ──────────
          const ledgerDesc = `Fixed asset acquisition — ${desc} (ინვ.: ${invoiceNum})`;
          await client.query(
            `INSERT INTO ledger (transaction_date, account_code, debit_amount, credit_amount, description, reference_id)
             VALUES ($1::date,'1600',$2,0,$3,$4)`,
            [importDate, totalLanded, ledgerDesc, refBase],
          );
          await client.query(
            `INSERT INTO ledger (transaction_date, account_code, debit_amount, credit_amount, description, reference_id)
             VALUES ($1::date,'2100',0,$2,$3,$4)`,
            [importDate, totalLanded, ledgerDesc, refBase],
          );

        } else {
          // itemType === "consumable"
          // ── Expense record ───────────────────────────────────────────────────
          const expDesc = `სახარჯი: ${desc} — ინვოისი: ${invoiceNum}`;
          await client.query(
            `INSERT INTO expenses
               (amount, description, category, payment_method,
                vat_amount, is_vat_included, source_reference)
             VALUES ($1, $2, 'იმპორტი — სახარჯი', 'transfer', 0, false, $3)`,
            [totalLanded, expDesc, itemRef],
          );

          // ── Ledger: DR 6100 Operating Expenses / CR 2100 Accounts Payable ────
          const ledgerDesc = `Consumable expense — ${desc} (ინვ.: ${invoiceNum})`;
          await client.query(
            `INSERT INTO ledger (transaction_date, account_code, debit_amount, credit_amount, description, reference_id)
             VALUES ($1::date,'6100',$2,0,$3,$4)`,
            [importDate, totalLanded, ledgerDesc, refBase],
          );
          await client.query(
            `INSERT INTO ledger (transaction_date, account_code, debit_amount, credit_amount, description, reference_id)
             VALUES ($1::date,'2100',0,$2,$3,$4)`,
            [importDate, totalLanded, ledgerDesc, refBase],
          );
        }
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
