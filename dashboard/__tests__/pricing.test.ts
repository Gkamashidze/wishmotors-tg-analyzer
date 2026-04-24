import { describe, it, expect } from "vitest";
import { calcRecommendedPrice } from "../lib/utils";

describe("calcRecommendedPrice", () => {
  it("applies 28% buffer and margin correctly", () => {
    // landedCost=100, margin=30%
    // buffered = 100 * 1.28 = 128
    // price    = 128 / (1 - 0.30) = 128 / 0.70 ≈ 182.857…
    const result = calcRecommendedPrice(100, 30);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(182.857, 2);
  });

  it("returns null when landedCost is zero", () => {
    expect(calcRecommendedPrice(0, 30)).toBeNull();
  });

  it("returns null when landedCost is negative", () => {
    expect(calcRecommendedPrice(-50, 30)).toBeNull();
  });

  it("clamps margin at 99 to avoid division by zero", () => {
    const result = calcRecommendedPrice(100, 100);
    expect(result).not.toBeNull();
    // clamped to 99 → 128 / (1 - 0.99) = 128 / 0.01 = 12800
    expect(result!).toBeCloseTo(12800, 1);
  });

  it("clamps negative margin to 0", () => {
    // margin 0 → 128 / 1.00 = 128
    const result = calcRecommendedPrice(100, -10);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(128, 5);
  });

  it("works with 0% margin (price equals buffered cost)", () => {
    const result = calcRecommendedPrice(200, 0);
    expect(result).not.toBeNull();
    // 200 * 1.28 / 1.00 = 256
    expect(result!).toBeCloseTo(256, 5);
  });

  it("works with 50% margin", () => {
    // 100 * 1.28 / 0.50 = 256
    const result = calcRecommendedPrice(100, 50);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(256, 5);
  });

  it("handles fractional landed costs", () => {
    const result = calcRecommendedPrice(73.45, 30);
    expect(result).not.toBeNull();
    // 73.45 * 1.28 / 0.70 ≈ 134.24
    expect(result!).toBeCloseTo(73.45 * 1.28 / 0.70, 4);
  });
});
