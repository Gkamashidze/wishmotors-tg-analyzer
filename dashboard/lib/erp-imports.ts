import "server-only";
import { query } from "@/lib/db";

export type ItemType = "inventory" | "fixed_asset" | "consumable";

export type ImportItemPayload = {
  productId:              number;
  newProductOem?:         string;
  newProductName?:        string;
  quantity:               number;
  unit:                   string;
  unitPriceUsd:           number;
  weight:                 number;
  totalPriceUsd:          number;
  totalPriceGel:          number;
  allocatedTransportCost: number;
  allocatedTerminalCost:  number;
  allocatedAgencyCost:    number;
  allocatedVatCost:       number;
  landedCostPerUnitGel:   number;
  itemType:               ItemType;
};

export async function upsertItems(
  importId: number,
  items: ImportItemPayload[],
): Promise<void> {
  await query("DELETE FROM import_items WHERE import_id = $1", [importId]);
  for (const it of items) {
    let productId = it.productId;

    // Auto-create product when OEM not yet in DB (inline creation flow)
    if (productId === 0 && it.newProductOem && it.newProductName) {
      const created = await query<{ id: number }>(
        `INSERT INTO products (name, oem_code, current_stock, min_stock, unit_price, unit)
         VALUES ($1, $2, 0, 0, 0, 'ცალი')
         ON CONFLICT (oem_code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [it.newProductName.trim(), it.newProductOem.trim()],
      );
      productId = created[0]?.id ?? 0;
    }

    if (!productId) continue;

    await query(
      `INSERT INTO import_items
         (import_id, product_id, quantity, unit, unit_price_usd, weight,
          total_price_usd, total_price_gel,
          allocated_transport_cost, allocated_terminal_cost,
          allocated_agency_cost, allocated_vat_cost,
          landed_cost_per_unit_gel, item_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        importId,
        productId,
        it.quantity,
        it.unit || "ცალი",
        it.unitPriceUsd,
        it.weight || 0,
        it.totalPriceUsd,
        it.totalPriceGel,
        it.allocatedTransportCost,
        it.allocatedTerminalCost,
        it.allocatedAgencyCost,
        it.allocatedVatCost,
        it.landedCostPerUnitGel,
        it.itemType || "inventory",
      ],
    );
  }
}
