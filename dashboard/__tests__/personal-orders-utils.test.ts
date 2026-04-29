import { describe, it, expect } from "vitest";
import { fmtPrice, fmtPriceRange, fmtGel, calcProfit } from "../lib/personal-orders-utils";
import type { PersonalOrderRow } from "../lib/personal-orders-queries";

describe("fmtPrice", () => {
  it("formats GEL with ₾ symbol", () => {
    expect(fmtPrice(100, "GEL")).toBe("₾100.00");
  });

  it("formats USD with $ symbol", () => {
    expect(fmtPrice(100, "USD")).toBe("$100.00");
  });

  it("returns — for null", () => {
    expect(fmtPrice(null, "GEL")).toBe("—");
    expect(fmtPrice(null, "USD")).toBe("—");
  });
});

describe("fmtPriceRange", () => {
  it("shows only max when min is null (GEL)", () => {
    expect(fmtPriceRange(null, 200, "GEL")).toBe("₾200.00");
  });

  it("shows only max when min is null (USD)", () => {
    expect(fmtPriceRange(null, 200, "USD")).toBe("$200.00");
  });

  it("shows range in GEL", () => {
    expect(fmtPriceRange(100, 200, "GEL")).toBe("₾100.00 – ₾200.00");
  });

  it("shows range in USD", () => {
    expect(fmtPriceRange(100, 200, "USD")).toBe("$100.00 – $200.00");
  });

  it("USD sale price must NOT show ₾ symbol", () => {
    const result = fmtPriceRange(null, 100, "USD");
    expect(result).not.toContain("₾");
    expect(result).toContain("$");
  });

  it("GEL sale price must NOT show $ symbol", () => {
    const result = fmtPriceRange(null, 100, "GEL");
    expect(result).not.toContain("$");
    expect(result).toContain("₾");
  });
});

describe("fmtGel", () => {
  it("always uses ₾", () => {
    expect(fmtGel(50)).toBe("₾50.00");
  });
});

describe("calcProfit", () => {
  const base: PersonalOrderRow = {
    id: 1,
    tracking_token: "tok",
    customer_name: "Test",
    customer_contact: null,
    part_name: "Part",
    oem_code: null,
    cost_price: null,
    transportation_cost: null,
    vat_amount: null,
    sale_price_min: null,
    sale_price: 200,
    sale_price_currency: "GEL",
    amount_paid: 0,
    amount_paid_currency: "GEL",
    status: "ordered",
    estimated_arrival: null,
    notes: null,
    created_at: "",
    updated_at: "",
    items: [],
    telegram_chat_id: null,
    telegram_message_id: null,
  };

  it("profit equals sale_price when no costs (GEL)", () => {
    expect(calcProfit(base)).toBe(200);
  });

  it("profit equals sale_price when no costs (USD)", () => {
    expect(calcProfit({ ...base, sale_price: 100, sale_price_currency: "USD" })).toBe(100);
  });

  it("deducts all costs", () => {
    expect(
      calcProfit({ ...base, sale_price: 200, cost_price: 50, transportation_cost: 20, vat_amount: 10 }),
    ).toBe(120);
  });
});

describe("amount_paid display currency", () => {
  it("USD amount_paid shows $ symbol", () => {
    expect(fmtPrice(50, "USD")).toBe("$50.00");
    expect(fmtPrice(50, "USD")).not.toContain("₾");
  });

  it("GEL amount_paid shows ₾ symbol", () => {
    expect(fmtPrice(50, "GEL")).toBe("₾50.00");
    expect(fmtPrice(50, "GEL")).not.toContain("$");
  });
});

describe("remaining display currency bug", () => {
  it("USD order remaining must use $ not ₾", () => {
    const salePrice = 100;
    const amountPaid = 0;
    const currency = "USD";
    const remaining = salePrice - amountPaid;
    const display = fmtPrice(remaining, currency);
    expect(display).toBe("$100.00");
    expect(display).not.toContain("₾");
  });

  it("GEL order remaining must use ₾ not $", () => {
    const salePrice = 100;
    const amountPaid = 0;
    const currency = "GEL";
    const remaining = salePrice - amountPaid;
    const display = fmtPrice(remaining, currency);
    expect(display).toBe("₾100.00");
    expect(display).not.toContain("$");
  });
});
