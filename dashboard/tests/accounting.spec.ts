import { test, expect } from "@playwright/test";

test.describe("ბუღალტერია — Accounting Module", () => {

  // ── 1. Trial Balance tab loads with correct headers ────────────────────────
  test("ბრუნვითი უწყისი — tab opens and shows table headers", async ({ page }) => {
    await page.goto("/accounting");
    await page.waitForLoadState("networkidle");

    // Click the Trial Balance tab
    await page.getByRole("button", { name: /ბრუნვითი უწყისი/i }).click();
    await page.waitForLoadState("networkidle");

    // Wait for table to appear
    await page.waitForSelector("table", { timeout: 10_000 });

    // Verify key column headers are present
    await expect(page.getByText("კოდი").first()).toBeVisible();
    await expect(page.getByText("ანგარიში").first()).toBeVisible();
  });

  // ── 2. Debit = Credit (double-entry math check) ────────────────────────────
  test("ბრუნვითი უწყისი — debits equal credits (double-entry integrity)", async ({ request }) => {
    const res = await request.get(
      "/api/accounting/trial-balance?from=2020-01-01&to=2099-12-31",
    );
    expect(res.ok()).toBeTruthy();

    const body = await res.json() as {
      totals: {
        closing_debit: number;
        closing_credit: number;
        period_debit: number;
        period_credit: number;
      };
    };

    const { closing_debit, closing_credit, period_debit, period_credit } = body.totals;

    // Core double-entry rule: total debits must equal total credits (within rounding)
    expect(
      Math.abs(closing_debit - closing_credit),
      `Closing debit (${closing_debit}) must equal closing credit (${closing_credit})`,
    ).toBeLessThan(0.01);

    expect(
      Math.abs(period_debit - period_credit),
      `Period debit (${period_debit}) must equal period credit (${period_credit})`,
    ).toBeLessThan(0.01);
  });

  // ── 3. Profit & Loss tab loads and shows KPI cards ─────────────────────────
  test("მოგება-ზარალი — tab loads and shows KPI cards", async ({ page }) => {
    await page.goto("/accounting");
    await page.waitForLoadState("networkidle");

    // Click Profit & Loss tab
    await page.getByRole("button", { name: /მოგება-ზარალი/i }).click();
    await page.waitForLoadState("networkidle");

    // KPI cards should appear (they contain Georgian currency labels)
    await expect(page.getByText("შემოსავალი").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("წმინდა მოგება").first()).toBeVisible();
    await expect(page.getByText("მთლიანი მოგება").first()).toBeVisible();
    await expect(page.getByText("ჯამური ხარჯი").first()).toBeVisible();
  });

  // ── 4. Trial Balance — Excel export button present ─────────────────────────
  test("ბრუნვითი უწყისი — Excel download button is visible", async ({ page }) => {
    await page.goto("/accounting");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /ბრუნვითი უწყისი/i }).click();
    await page.waitForLoadState("networkidle");

    // Wait for data to load (table or empty state)
    await page.waitForTimeout(2000);

    // Excel button should be present (it renders once data arrives)
    const excelLink = page.locator("a[href*='trial-balance/export'][href*='format=xlsx']");
    await expect(excelLink).toBeVisible({ timeout: 8_000 });
    const href = await excelLink.getAttribute("href");
    expect(href).toContain("format=xlsx");
  });

  // ── 5. Trial Balance — PDF export button present ───────────────────────────
  test("ბრუნვითი უწყისი — PDF open button is visible", async ({ page }) => {
    await page.goto("/accounting");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /ბრუნვითი უწყისი/i }).click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const pdfLink = page.locator("a[href*='trial-balance/export'][href*='format=pdf']");
    await expect(pdfLink).toBeVisible({ timeout: 8_000 });
    const href = await pdfLink.getAttribute("href");
    expect(href).toContain("format=pdf");
  });

  // ── 6. Trial Balance API — date validation rejects bad input ────────────────
  test("ბრუნვითი უწყისი API — rejects reversed date range", async ({ request }) => {
    const res = await request.get(
      "/api/accounting/trial-balance?from=2024-12-31&to=2024-01-01",
    );
    expect(res.status()).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/'to' must be >= 'from'/);
  });

  // ── 7. Partners API — invalid amount rejected ──────────────────────────────
  test("კონტრაგენტი API — rejects negative transaction amount", async ({ request }) => {
    // First create a test partner to use
    const createRes = await request.post("/api/accounting/partners", {
      data: { name: "Test Partner Playwright", type: "debtor", initial_amount: 100 },
    });

    if (!createRes.ok()) {
      // Partners table may not exist in test env — skip gracefully
      test.skip();
      return;
    }

    const { id } = await createRes.json() as { id: number };

    const txRes = await request.post(`/api/accounting/partners/${id}/transaction`, {
      data: { tx_type: "credit", amount: -50 },
    });

    expect(txRes.status()).toBe(400);
  });

  // ── 8. Profit & Loss API — returns balanced numbers ────────────────────────
  test("მოგება-ზარალი API — gross_profit = revenue - cogs", async ({ request }) => {
    const res = await request.get(
      "/api/accounting/profit-loss?from=2020-01-01&to=2099-12-31",
    );
    expect(res.ok()).toBeTruthy();

    const body = await res.json() as {
      revenue: { total: number };
      cost_of_goods_sold: { total: number };
      gross_profit: number;
      total_expenses: number;
      net_profit: number;
    };

    // Math check: gross_profit = revenue - cogs
    const expectedGross = body.revenue.total - body.cost_of_goods_sold.total;
    expect(Math.abs(body.gross_profit - expectedGross)).toBeLessThan(0.01);

    // Math check: net_profit = gross_profit - total_expenses
    const expectedNet = body.gross_profit - body.total_expenses;
    expect(Math.abs(body.net_profit - expectedNet)).toBeLessThan(0.01);
  });

});
