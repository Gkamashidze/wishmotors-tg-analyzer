import { describe, it, expect } from "vitest";
import {
  formatTopicSale,
  formatTopicExpense,
  formatTopicOrder,
} from "../lib/formatters";

describe("formatTopicSale", () => {
  it("formats a regular cash sale", () => {
    const result = formatTopicSale({
      productName: "ზეთი 5W-30",
      qty: 2,
      price: 45.5,
      paymentMethod: "cash",
      saleId: 101,
    });
    expect(result).toContain("ზეთი 5W-30");
    expect(result).toContain("2ც × 45.50₾");
    expect(result).toContain("91.00₾");
    expect(result).toContain("ხელზე 💵");
    expect(result).toContain("#101");
  });

  it("formats a credit (nisia) sale with customer", () => {
    const result = formatTopicSale({
      productName: "ფილტრი",
      qty: 3,
      price: 20.0,
      paymentMethod: "credit",
      saleId: 55,
      customerName: "გიორგი",
    });
    expect(result).toContain("ნისია");
    expect(result).toContain("გიორგი");
    expect(result).toContain("60.00₾");
    expect(result).toContain("#55");
  });

  it("formats a transfer sale", () => {
    const result = formatTopicSale({
      productName: "ზეთი",
      qty: 1,
      price: 100.0,
      paymentMethod: "transfer",
      saleId: 7,
    });
    expect(result).toContain("დარიცხა 🏦");
  });

  it("escapes HTML in product name", () => {
    const result = formatTopicSale({
      productName: '<script>alert("xss")</script>',
      qty: 1,
      price: 10,
      paymentMethod: "cash",
      saleId: 1,
    });
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("includes customer name in non-credit sale", () => {
    const result = formatTopicSale({
      productName: "ნაწილი",
      qty: 1,
      price: 50,
      paymentMethod: "cash",
      saleId: 9,
      customerName: "ლუკა",
    });
    expect(result).toContain("👤");
    expect(result).toContain("ლუკა");
  });
});

describe("formatTopicExpense", () => {
  it("formats an expense with known category", () => {
    const result = formatTopicExpense({
      amount: 150.0,
      category: "fuel",
      description: "ბენზინი",
      expenseId: 22,
    });
    expect(result).toContain("⛽ საწვავი");
    expect(result).toContain("ბენზინი");
    expect(result).toContain("150.00₾");
    expect(result).toContain("#22");
  });

  it("falls back to სხვა for unknown category", () => {
    const result = formatTopicExpense({
      amount: 50.0,
      category: "unknown_cat",
      expenseId: 5,
    });
    expect(result).toContain("📝 სხვა");
  });

  it("handles null category and description", () => {
    const result = formatTopicExpense({
      amount: 200.0,
      category: null,
      description: null,
      expenseId: 3,
    });
    expect(result).toContain("200.00₾");
    expect(result).toContain("#3");
  });

  it("escapes HTML in description", () => {
    const result = formatTopicExpense({
      amount: 10,
      description: '<b>bold</b>',
      expenseId: 1,
    });
    expect(result).not.toContain("<b>bold</b>");
    expect(result).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });
});

describe("formatTopicOrder", () => {
  it("formats a pending urgent order", () => {
    const result = formatTopicOrder({
      productName: "ფილტრი",
      qty: 10,
      status: "pending",
      priority: "urgent",
      orderId: 33,
    });
    expect(result).toContain("ფილტრი");
    expect(result).toContain("10ც");
    expect(result).toContain("⏳ მოლოდინშია");
    expect(result).toContain("🔴 სასწრაფო");
    expect(result).toContain("#33");
  });

  it("formats a fulfilled low-priority order with notes", () => {
    const result = formatTopicOrder({
      productName: "ზეთი",
      qty: 5,
      status: "fulfilled",
      priority: "low",
      orderId: 12,
      notes: "კომპლექტი",
    });
    expect(result).toContain("✅ შესრულდა");
    expect(result).toContain("🟢 დაბალი");
    expect(result).toContain("კომპლექტი");
  });

  it("escapes HTML in product name", () => {
    const result = formatTopicOrder({
      productName: "<b>Product</b>",
      qty: 1,
      status: "pending",
      priority: "normal",
      orderId: 1,
    });
    expect(result).not.toContain("<b>Product</b>");
    expect(result).toContain("&lt;b&gt;Product&lt;/b&gt;");
  });
});
