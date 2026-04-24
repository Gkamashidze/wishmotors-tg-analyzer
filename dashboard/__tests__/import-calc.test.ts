import { describe, it, expect } from "vitest";
import { calcLanded } from "../lib/import-calc";

// Sample: one item, qty=10, price=$5, weight=2kg, rate=2.7
// totalGel = 10 * 5 * 2.7 = 135
// transport=20 (by weight, sole item → full share) → aTransport=20
// terminal=10 (by value, sole item → full share)   → aTerminal=10
// agency=5   (by value)                             → aAgency=5
// vat=30     (by value — should be EXCLUDED from landed cost)
//
// landedCostPerUnit = (135 + 20 + 10 + 5) / 10 = 170 / 10 = 17.00
// allocatedVat = 30 (tracked but NOT in landed cost)

const SINGLE_ITEM = [{ quantity: "10", unitPriceUsd: "5", weight: "2" }];

describe("calcLanded — VAT exclusion", () => {
  it("excludes allocated VAT from landedCostPerUnit", () => {
    const [line] = calcLanded(SINGLE_ITEM, 2.7, 20, 10, 5, 30);

    // landedCostPerUnit must NOT include aVat=30
    expect(line.landedCostPerUnit).toBeCloseTo(17.0, 5);
  });

  it("still tracks allocatedVat for display", () => {
    const [line] = calcLanded(SINGLE_ITEM, 2.7, 20, 10, 5, 30);

    expect(line.allocatedVat).toBeCloseTo(30, 5);
  });

  it("landedCostPerUnit equals zero VAT case when vatCost is zero", () => {
    const [withVat]    = calcLanded(SINGLE_ITEM, 2.7, 20, 10, 5, 30);
    const [withoutVat] = calcLanded(SINGLE_ITEM, 2.7, 20, 10, 5, 0);

    // Both should produce the same landedCostPerUnit (VAT has no effect)
    expect(withVat.landedCostPerUnit).toBeCloseTo(withoutVat.landedCostPerUnit, 5);
  });

  it("base GEL values and other allocations are unaffected by VAT", () => {
    const [line] = calcLanded(SINGLE_ITEM, 2.7, 20, 10, 5, 30);

    expect(line.totalPriceGel).toBeCloseTo(135, 5);
    expect(line.allocatedTransport).toBeCloseTo(20, 5);
    expect(line.allocatedTerminal).toBeCloseTo(10, 5);
    expect(line.allocatedAgency).toBeCloseTo(5, 5);
  });

  it("splits transport by weight and value costs by GEL value across two items", () => {
    const items = [
      { quantity: "5", unitPriceUsd: "10", weight: "3" },  // gel=135, weight=3
      { quantity: "2", unitPriceUsd: "20", weight: "1" },  // gel=108, weight=1
    ];
    const rate = 2.7;
    // totalGel = 135 + 108 = 243, totalWeight = 4
    // transport=40: item0 = 40*(3/4)=30, item1 = 40*(1/4)=10
    // terminal=20:  item0 = 20*(135/243)≈11.11, item1 = 20*(108/243)≈8.89
    // agency=10:    item0 = 10*(135/243)≈5.556, item1 = 10*(108/243)≈4.444
    // vat=50:       item0 = 50*(135/243)≈27.78 — EXCLUDED from landed cost

    const [l0, l1] = calcLanded(items, rate, 40, 20, 10, 50);

    // item0 landedCostPerUnit = (135 + 30 + 11.111 + 5.556) / 5
    expect(l0.landedCostPerUnit).toBeCloseTo((135 + 30 + 20 * (135 / 243) + 10 * (135 / 243)) / 5, 4);

    // item1 landedCostPerUnit = (108 + 10 + 8.889 + 4.444) / 2
    expect(l1.landedCostPerUnit).toBeCloseTo((108 + 10 + 20 * (108 / 243) + 10 * (108 / 243)) / 2, 4);

    // VAT is tracked but not in landed cost
    expect(l0.allocatedVat).toBeCloseTo(50 * (135 / 243), 4);
    expect(l1.allocatedVat).toBeCloseTo(50 * (108 / 243), 4);
  });

  it("handles zero quantity gracefully", () => {
    const [line] = calcLanded(
      [{ quantity: "0", unitPriceUsd: "10", weight: "2" }],
      2.7, 20, 10, 5, 30,
    );

    expect(line.landedCostPerUnit).toBe(0);
  });

  it("handles empty vatCost — result identical to no VAT call", () => {
    const [line] = calcLanded(SINGLE_ITEM, 2.7, 20, 10, 5, 0);

    // (135 + 20 + 10 + 5) / 10 = 17.00
    expect(line.landedCostPerUnit).toBeCloseTo(17.0, 5);
    expect(line.allocatedVat).toBeCloseTo(0, 5);
  });
});
