import "server-only";
import { query } from "@/lib/db";

export type ItemType = "inventory" | "fixed_asset" | "consumable";

export type ImportItemPayload = {
  productId:              number;
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
        it.productId,
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
