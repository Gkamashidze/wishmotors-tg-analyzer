import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// ── POST /api/erp-imports/[id]/finalize ───────────────────────────────────────
// Routes each line item based on item_type + inventory_sub_type + accounting_category:
//   inventory + regular   → stock + WAC + ledger DR 1610.XX / CR 3110
//   inventory + small_val → stock + WAC + ledger DR 1690 / CR 3110
//   fixed_asset           → fixed_assets + ledger DR 2100 / CR 3110
//   consumable            → expenses + ledger DR 7200 / CR 3110
// Also auto-creates/updates accounting_partner for the supplier (creditor).

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
                ii.item_type, ii.recommended_price,
                COALESCE(ii.inventory_sub_type, 'regular') AS inventory_sub_type,
                COALESCE(ii.accounting_category, p.category, '') AS accounting_category
         FROM import_items ii
         JOIN products p ON p.id = ii.product_id
         WHERE ii.import_id = $1`,
        [importId],
      );
      const items = itemsRes.rows;
      if (items.length === 0) throw new Error("Import has no line items");

      const CATEGORY_ACCOUNT: Record<string, string> = {
        "ძრავი":                "1611",
        "გადაცემათა კოლოფი":   "1612",
        "სამუხრუჭე სისტემა":   "1613",
        "სარეზინო სისტემა":    "1614",
        "საჭე და მართვა":       "1615",
        "ელექტრიკა და სენსორები": "1616",
        "განათება":             "1617",
        "ფილტრები":             "1618",
        "გაგრილება":            "1619",
        "საწვავის სისტემა":     "1620",
        "სხეული":               "1621",
        "სხვადასხვა":           "1622",
      };

      const refBase    = `erp_import:${importId}`;
      const importDate = imp.date instanceof Date
        ? imp.date.toISOString().slice(0, 10)
        : String(imp.date).slice(0, 10);
      const invoiceNum = imp.invoice_number ?? `#${importId}`;

      for (const it of items) {
        const qty         = Number(it.quantity);
        const unitCost    = Number(it.landed_cost_per_unit_gel);
        const totalGel    = Number(it.total_price_gel);
        const totalLanded = unitCost * qty;
        const itemType    = (it.item_type as string) || "inventory";
        const subType     = (it.inventory_sub_type as string) || "regular";
        const category    = (it.accounting_category as string) || "";
        const itemRef     = `${refBase}:${it.product_id}`;
        const desc        = `${it.product_name}${it.oem_code ? ` (${it.oem_code})` : ""}`;

        // Stamp item_type on the product so products page filter works
        await client.query(
          "UPDATE products SET item_type = $1 WHERE id = $2",
          [itemType, it.product_id],
        );

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

          // ── Ledger: DR 1610.XX or 1690 / CR 3110 ────────────────────────────
          const drAccount  = subType === "small_value"
            ? "1690"
            : (CATEGORY_ACCOUNT[category] ?? "1610");
          const ledgerDesc = `Import receipt — ${desc}`;
          await client.query(
            `INSERT INTO ledger (transaction_date, account_code, debit_amount, credit_amount, description, reference_id)
             VALUES ($1::date,$2,$3,0,$4,$5)`,
            [importDate, drAccount, totalGel, ledgerDesc, refBase],
          );
          await client.query(
            `INSERT INTO ledger (transaction_date, account_code, debit_amount, credit_amount, description, reference_id)
             VALUES ($1::date,'3110',0,$2,$3,$4)`,
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

          // ── Ledger: DR 2100 Fixed Assets / CR 3110 Supplier Payable ──────────
          const ledgerDesc = `Fixed asset acquisition — ${desc} (ინვ.: ${invoiceNum})`;
          await client.query(
            `INSERT INTO ledger (transaction_date, account_code, debit_amount, credit_amount, description, reference_id)
             VALUES ($1::date,'2100',$2,0,$3,$4)`,
            [importDate, totalLanded, ledgerDesc, refBase],
          );
          await client.query(
            `INSERT INTO ledger (transaction_date, account_code, debit_amount, credit_amount, description, reference_id)
             VALUES ($1::date,'3110',0,$2,$3,$4)`,
            [importDate, totalLanded, ledgerDesc, refBase],
          );

        } else {
          // itemType === "consumable"
          // ── Expense record (is_paid=false — accrued AP) ───────────────────────
          const expDesc = `სახარჯი: ${desc} — ინვოისი: ${invoiceNum}`;
          await client.query(
            `INSERT INTO expenses
               (amount, description, category, payment_method,
                vat_amount, is_vat_included, source_reference, is_paid)
             VALUES ($1, $2, 'იმპორტი — სახარჯი', 'transfer', 0, false, $3, false)`,
            [totalLanded, expDesc, itemRef],
          );

          // ── Ledger: DR 7200 Operating Expenses / CR 3110 Supplier Payable ────
          const ledgerDesc = `Consumable expense — ${desc} (ინვ.: ${invoiceNum})`;
          await client.query(
            `INSERT INTO ledger (transaction_date, account_code, debit_amount, credit_amount, description, reference_id)
             VALUES ($1::date,'7200',$2,0,$3,$4)`,
            [importDate, totalLanded, ledgerDesc, refBase],
          );
          await client.query(
            `INSERT INTO ledger (transaction_date, account_code, debit_amount, credit_amount, description, reference_id)
             VALUES ($1::date,'3110',0,$2,$3,$4)`,
            [importDate, totalLanded, ledgerDesc, refBase],
          );
        }
      }

      // ── Auto-create / update accounting_partner for supplier ─────────────────
      const totalImportGel = items.reduce((s: number, it: { total_price_gel: string | number }) => s + Number(it.total_price_gel), 0);
      if (imp.supplier && totalImportGel > 0) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS accounting_partners (
            id         SERIAL PRIMARY KEY,
            name       TEXT NOT NULL,
            type       TEXT NOT NULL CHECK (type IN ('debtor','creditor')),
            phone      TEXT,
            note       TEXT,
            is_active  BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )`);
        await client.query(`
          CREATE TABLE IF NOT EXISTS accounting_partner_transactions (
            id              SERIAL PRIMARY KEY,
            partner_id      INTEGER NOT NULL REFERENCES accounting_partners(id) ON DELETE CASCADE,
            tx_type         TEXT NOT NULL CHECK (tx_type IN ('debit','credit')),
            amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
            description     TEXT,
            tx_date         DATE NOT NULL DEFAULT CURRENT_DATE,
            currency        TEXT NOT NULL DEFAULT 'GEL',
            original_amount NUMERIC(12,4),
            exchange_rate   NUMERIC(10,4) NOT NULL DEFAULT 1.0,
            created_at      TIMESTAMPTZ DEFAULT NOW()
          )`);

        // Upsert partner (find by name+type or create)
        const partnerRes = await client.query(
          `INSERT INTO accounting_partners (name, type, note)
           VALUES ($1, 'creditor', $2)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [imp.supplier, `იმპ. #${importId} — ${invoiceNum}`],
        );
        let partnerId: number | null = partnerRes.rows[0]?.id ?? null;
        if (!partnerId) {
          const existingRes = await client.query(
            `SELECT id FROM accounting_partners WHERE name = $1 AND type = 'creditor' AND is_active = true LIMIT 1`,
            [imp.supplier],
          );
          partnerId = existingRes.rows[0]?.id ?? null;
        }

        if (partnerId) {
          // Check if debit for this import reference already exists (idempotent)
          const dupRes = await client.query(
            `SELECT id FROM accounting_partner_transactions
             WHERE partner_id = $1 AND description LIKE $2 LIMIT 1`,
            [partnerId, `%erp_import:${importId}%`],
          );
          if (dupRes.rows.length === 0) {
            await client.query(
              `INSERT INTO accounting_partner_transactions
                 (partner_id, tx_type, amount, description, tx_date, currency, original_amount, exchange_rate)
               VALUES ($1, 'debit', $2, $3, $4::date, 'GEL', $2, 1.0)`,
              [
                partnerId,
                totalImportGel,
                `იმპ. #${importId} — ${invoiceNum} — ${imp.supplier}`,
                importDate,
              ],
            );
          }
        }
      }

      // VAT ledger: post positive input VAT (recoverable) for the import
      const importVat = Number(imp.total_vat_cost ?? 0);
      if (importVat > 0) {
        await client.query(
          `INSERT INTO vat_ledger (transaction_type, amount, reference_id, created_at)
           VALUES ('import_vat', $1, $2, $3::date)`,
          [importVat, `erp_import:${importId}`, importDate],
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
