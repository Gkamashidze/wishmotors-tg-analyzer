import "server-only";
import { queryOne, query } from "./db";
import type { SellerFilter } from "./queries";

export type FinancialMetricsData = {
  inventoryTurnoverRatio: number;
  aovGel: number;
  roiPct: number;
  gmroi: number;
  realtimeCashflowGel: number;
  totalInventoryValueGel: number;
};

export type ProductMetricRow = {
  productId: number;
  name: string;
  oemCode: string | null;
  revenueGel: number;
  cogsGel: number;
  roiPct: number;
  inventoryValueGel: number;
  turnoverRatio: number;
};

export async function getGlobalFinancialMetrics(
  from: Date,
  to: Date,
  sellerType: SellerFilter = "all",
): Promise<FinancialMetricsData> {
  const sellerParam = sellerType === "all" ? null : sellerType;

  const row = await queryOne<{
    revenue: string;
    cogs: string;
    sales_count: string;
    expenses: string;
    returns_total: string;
    inv_value: string;
    total_rev: string;
    total_exp: string;
  }>(
    `
    WITH
      sales_agg AS (
        SELECT
          COALESCE(SUM(unit_price * quantity), 0) AS revenue,
          COALESCE(SUM(cost_amount), 0)            AS cogs,
          COUNT(*)                                 AS sales_count
        FROM sales
        WHERE sold_at >= $1::timestamptz
          AND sold_at <  $2::timestamptz + INTERVAL '1 day'
          AND status != 'returned'
          AND ($3::text IS NULL OR seller_type = $3::text)
      ),
      exp_agg AS (
        SELECT COALESCE(SUM(amount), 0) AS expenses
        FROM expenses
        WHERE created_at >= $1::timestamptz
          AND created_at <  $2::timestamptz + INTERVAL '1 day'
      ),
      returns_agg AS (
        SELECT COALESCE(SUM(refund_amount), 0) AS returns_total
        FROM returns
        WHERE returned_at >= $1::timestamptz
          AND returned_at <  $2::timestamptz + INTERVAL '1 day'
      ),
      inv_val AS (
        SELECT COALESCE(SUM(remaining_quantity * unit_cost), 0) AS inv_value
        FROM inventory_batches
        WHERE remaining_quantity > 0
      ),
      alltime_sales AS (
        SELECT COALESCE(SUM(unit_price * quantity), 0) AS total_rev
        FROM sales
        WHERE status != 'returned'
          AND ($3::text IS NULL OR seller_type = $3::text)
      ),
      alltime_exp AS (
        SELECT COALESCE(SUM(amount), 0) AS total_exp FROM expenses
      )
    SELECT
      s.revenue, s.cogs, s.sales_count,
      e.expenses, r.returns_total,
      i.inv_value,
      at.total_rev, ae.total_exp
    FROM sales_agg s, exp_agg e, returns_agg r, inv_val i,
         alltime_sales at, alltime_exp ae
    `,
    [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10), sellerParam],
  );

  const revenue = Number(row?.revenue ?? 0);
  const cogs = Number(row?.cogs ?? 0);
  const salesCount = Number(row?.sales_count ?? 0);
  const expenses = Number(row?.expenses ?? 0);
  const returnsTotal = Number(row?.returns_total ?? 0);
  const invValue = Number(row?.inv_value ?? 0);
  const totalRev = Number(row?.total_rev ?? 0);
  const totalExp = Number(row?.total_exp ?? 0);

  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - expenses - returnsTotal;

  return {
    inventoryTurnoverRatio: invValue > 0 ? +(cogs / invValue).toFixed(4) : 0,
    aovGel: salesCount > 0 ? +(revenue / salesCount).toFixed(2) : 0,
    roiPct: cogs > 0 ? +(netProfit / cogs * 100).toFixed(2) : 0,
    gmroi: invValue > 0 ? +(grossProfit / invValue).toFixed(4) : 0,
    realtimeCashflowGel: +(totalRev - totalExp - invValue).toFixed(2),
    totalInventoryValueGel: +invValue.toFixed(2),
  };
}

export async function getProductMetrics(
  from: Date,
  to: Date,
  limit = 200,
): Promise<ProductMetricRow[]> {
  const rows = await query<{
    product_id: number;
    name: string;
    oem_code: string | null;
    revenue: string;
    cogs: string;
    inv_value: string;
  }>(
    `
    WITH prod_sales AS (
      SELECT
        p.id                                              AS product_id,
        COALESCE(p.name, 'უცნობი')                        AS name,
        p.oem_code,
        COALESCE(SUM(s.unit_price * s.quantity), 0)       AS revenue,
        COALESCE(SUM(s.cost_amount), 0)                   AS cogs
      FROM products p
      JOIN sales s ON s.product_id = p.id
        AND s.sold_at >= $1::timestamptz
        AND s.sold_at <  $2::timestamptz + INTERVAL '1 day'
        AND s.status != 'returned'
      GROUP BY p.id, p.name, p.oem_code
      HAVING COALESCE(SUM(s.cost_amount), 0) > 0
    ),
    prod_inv AS (
      SELECT
        product_id,
        COALESCE(SUM(remaining_quantity * unit_cost), 0)  AS inv_value
      FROM inventory_batches
      WHERE remaining_quantity > 0
      GROUP BY product_id
    )
    SELECT
      ps.product_id,
      ps.name,
      ps.oem_code,
      ps.revenue,
      ps.cogs,
      COALESCE(pi.inv_value, 0) AS inv_value
    FROM prod_sales ps
    LEFT JOIN prod_inv pi ON pi.product_id = ps.product_id
    ORDER BY ps.revenue DESC
    LIMIT $3
    `,
    [
      from.toISOString().slice(0, 10),
      to.toISOString().slice(0, 10),
      limit,
    ],
  );

  return rows.map((r) => {
    const rev = Number(r.revenue);
    const cogs = Number(r.cogs);
    const inv = Number(r.inv_value);
    const gross = rev - cogs;
    return {
      productId: r.product_id,
      name: r.name,
      oemCode: r.oem_code,
      revenueGel: +rev.toFixed(2),
      cogsGel: +cogs.toFixed(2),
      roiPct: cogs > 0 ? +(gross / cogs * 100).toFixed(2) : 0,
      inventoryValueGel: +inv.toFixed(2),
      turnoverRatio: inv > 0 ? +(cogs / inv).toFixed(4) : 0,
    };
  });
}
