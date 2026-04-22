import "server-only";
import { query, queryOne } from "./db";

export type DashboardSummary = {
  totalSales: number;
  totalExpenses: number;
  totalCogs: number;
  grossProfit: number;
  netProfit: number;
  salesCount: number;
  pendingOrders: number;
  urgentOrders: number;
};

export async function getDashboardSummary(
  days: number = 30,
): Promise<DashboardSummary> {
  const row = await queryOne<{
    total_sales: string | null;
    total_cogs: string | null;
    total_expenses: string | null;
    sales_count: string | null;
    pending_orders: string | null;
    urgent_orders: string | null;
  }>(
    `
    WITH
      sales_agg AS (
        SELECT
          COALESCE(SUM(quantity * unit_price), 0) AS total_sales,
          COALESCE(SUM(cost_amount), 0) AS total_cogs,
          COUNT(*) AS sales_count
        FROM sales
        WHERE sold_at >= NOW() - ($1::int || ' days')::interval
          AND status != 'returned'
      ),
      exp_agg AS (
        SELECT COALESCE(SUM(amount), 0) AS total_expenses
        FROM expenses
        WHERE created_at >= NOW() - ($1::int || ' days')::interval
      ),
      ord_agg AS (
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending') AS pending_orders,
          COUNT(*) FILTER (WHERE status = 'pending' AND priority = 'urgent') AS urgent_orders
        FROM orders
      )
    SELECT
      sales_agg.total_sales,
      sales_agg.total_cogs,
      sales_agg.sales_count,
      exp_agg.total_expenses,
      ord_agg.pending_orders,
      ord_agg.urgent_orders
    FROM sales_agg, exp_agg, ord_agg
    `,
    [days],
  );

  const totalSales = Number(row?.total_sales ?? 0);
  const totalCogs = Number(row?.total_cogs ?? 0);
  const totalExpenses = Number(row?.total_expenses ?? 0);
  const grossProfit = totalSales - totalCogs;

  return {
    totalSales,
    totalCogs,
    totalExpenses,
    grossProfit,
    netProfit: grossProfit - totalExpenses,
    salesCount: Number(row?.sales_count ?? 0),
    pendingOrders: Number(row?.pending_orders ?? 0),
    urgentOrders: Number(row?.urgent_orders ?? 0),
  };
}

export type DailyPoint = {
  day: string;
  sales: number;
  expenses: number;
  profit: number;
};

export async function getDailySeries(days: number = 30): Promise<DailyPoint[]> {
  const rows = await query<{
    day: Date;
    sales: string | null;
    cogs: string | null;
    expenses: string | null;
  }>(
    `
    WITH day_series AS (
      SELECT generate_series(
        date_trunc('day', NOW()) - (($1::int - 1) || ' days')::interval,
        date_trunc('day', NOW()),
        '1 day'::interval
      ) AS day
    ),
    sales_per_day AS (
      SELECT
        date_trunc('day', sold_at) AS day,
        SUM(quantity * unit_price) AS sales,
        SUM(cost_amount) AS cogs
      FROM sales
      WHERE sold_at >= date_trunc('day', NOW()) - (($1::int - 1) || ' days')::interval
        AND status != 'returned'
      GROUP BY 1
    ),
    exp_per_day AS (
      SELECT date_trunc('day', created_at) AS day, SUM(amount) AS expenses
      FROM expenses
      WHERE created_at >= date_trunc('day', NOW()) - (($1::int - 1) || ' days')::interval
      GROUP BY 1
    )
    SELECT
      day_series.day AS day,
      COALESCE(s.sales, 0) AS sales,
      COALESCE(s.cogs, 0)  AS cogs,
      COALESCE(e.expenses, 0) AS expenses
    FROM day_series
    LEFT JOIN sales_per_day s ON s.day = day_series.day
    LEFT JOIN exp_per_day   e ON e.day = day_series.day
    ORDER BY day_series.day ASC
    `,
    [days],
  );

  return rows.map((r) => {
    const sales = Number(r.sales ?? 0);
    const cogs = Number(r.cogs ?? 0);
    const expenses = Number(r.expenses ?? 0);
    const day = r.day instanceof Date ? r.day : new Date(r.day);
    return {
      day: day.toISOString().slice(0, 10),
      sales,
      expenses,
      profit: sales - cogs - expenses,
    };
  });
}

export type OrderRow = {
  id: number;
  productId: number | null;
  productName: string;       // always set — fallback: 'ძველი ჩანაწერი'
  oemCode: string | null;
  quantityNeeded: number;    // always set — fallback: 0
  status: string;
  priority: "urgent" | "low" | string;
  createdAt: string;         // always set — fallback: NOW()
  notes: string | null;
};

export async function getOrders(limit: number = 500): Promise<OrderRow[]> {
  let rows: {
    id: number;
    product_id: number | null;
    product_name: string | null;
    oem_code: string | null;
    quantity_needed: number | null;
    status: string;
    priority: string | null;
    created_at: Date;
    notes: string | null;
  }[];

  try {
    rows = await query(
      `
      SELECT
        o.id,
        o.product_id,
        COALESCE(p.name, NULLIF(o.part_name, ''), 'ძველი ჩანაწერი') AS product_name,
        COALESCE(o.oem_code, p.oem_code, '-')                        AS oem_code,
        COALESCE(o.quantity_needed, 0)                               AS quantity_needed,
        COALESCE(o.status, 'pending')                                AS status,
        CASE WHEN o.priority = 'urgent' THEN 'urgent' ELSE 'low' END AS priority,
        COALESCE(o.created_at, NOW())                                AS created_at,
        o.notes
      FROM orders o
      LEFT JOIN products p ON p.id = o.product_id
      ORDER BY
        CASE COALESCE(o.status, 'pending') WHEN 'pending' THEN 0 ELSE 1 END,
        CASE COALESCE(o.priority, 'low') WHEN 'urgent' THEN 0 ELSE 1 END,
        o.created_at DESC NULLS LAST
      LIMIT $1
      `,
      [limit],
    );
  } catch (err) {
    console.error("[getOrders] query failed:", err);
    throw new Error(
      `შეკვეთების წამოღება ვერ მოხერხდა: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id ?? null,
    // SQL already guarantees a non-null, non-empty string; keep as-is for display.
    productName: r.product_name ?? "ძველი ჩანაწერი",
    oemCode: r.oem_code && r.oem_code !== "-" ? r.oem_code : null,
    quantityNeeded: Number(r.quantity_needed ?? 0),
    status: r.status ?? "pending",
    priority: (r.priority === "urgent" ? "urgent" : "low") as OrderRow["priority"],
    createdAt: r.created_at
      ? r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at)
      : new Date().toISOString(),
    notes: r.notes ?? null,
  }));
}

// ─── Sales ────────────────────────────────────────────────────────────────────

export type SaleRow = {
  id: number;
  productId: number | null;
  productName: string | null;
  quantity: number;
  unitPrice: number;
  costAmount: number;
  paymentMethod: string;
  sellerType: string;
  customerName: string | null;
  soldAt: string;
  notes: string | null;
  receiptPrinted: boolean;
  vatAmount: number;
  isVatIncluded: boolean;
  status: string;
};

export async function getSales(limit: number = 500): Promise<SaleRow[]> {
  const rows = await query<{
    id: number;
    product_id: number | null;
    product_name: string | null;
    quantity: number;
    unit_price: string;
    cost_amount: string;
    payment_method: string;
    seller_type: string;
    customer_name: string | null;
    sold_at: Date;
    notes: string | null;
    receipt_printed: boolean;
    vat_amount: string;
    is_vat_included: boolean;
    status: string;
  }>(
    `
    SELECT
      s.id,
      s.product_id,
      p.name        AS product_name,
      s.quantity,
      s.unit_price,
      s.cost_amount,
      s.payment_method,
      s.seller_type,
      s.customer_name,
      s.sold_at,
      s.notes,
      s.receipt_printed,
      s.vat_amount,
      s.is_vat_included,
      s.status
    FROM sales s
    LEFT JOIN products p ON p.id = s.product_id
    ORDER BY s.sold_at DESC
    LIMIT $1
    `,
    [limit],
  );

  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    productName: r.product_name,
    quantity: r.quantity,
    unitPrice: Number(r.unit_price),
    costAmount: Number(r.cost_amount),
    paymentMethod: r.payment_method,
    sellerType: r.seller_type,
    customerName: r.customer_name,
    soldAt:
      r.sold_at instanceof Date
        ? r.sold_at.toISOString()
        : String(r.sold_at),
    notes: r.notes,
    receiptPrinted: r.receipt_printed,
    vatAmount: Number(r.vat_amount),
    isVatIncluded: r.is_vat_included,
    status: r.status ?? "active",
  }));
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

export type ExpenseRow = {
  id: number;
  amount: number;
  description: string | null;
  category: string | null;
  paymentMethod: string;
  createdAt: string;
  vatAmount: number;
  isVatIncluded: boolean;
};

export async function getExpenses(limit: number = 500): Promise<ExpenseRow[]> {
  const rows = await query<{
    id: number;
    amount: string;
    description: string | null;
    category: string | null;
    payment_method: string;
    created_at: Date;
    vat_amount: string;
    is_vat_included: boolean;
  }>(
    `
    SELECT id, amount, description, category, payment_method, created_at,
           vat_amount, is_vat_included
    FROM expenses
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit],
  );

  return rows.map((r) => ({
    id: r.id,
    amount: Number(r.amount),
    description: r.description,
    category: r.category,
    paymentMethod: r.payment_method,
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
    vatAmount: Number(r.vat_amount),
    isVatIncluded: r.is_vat_included,
  }));
}

// ─── Products (Inventory) ─────────────────────────────────────────────────────

export type ProductRow = {
  id: number;
  name: string;
  oemCode: string | null;
  currentStock: number;
  minStock: number;
  unitPrice: number;
  unit: string;
  createdAt: string;
};

export async function getDashboardSummaryRange(
  from: Date,
  to: Date,
): Promise<DashboardSummary> {
  const row = await queryOne<{
    total_sales: string | null;
    total_cogs: string | null;
    total_expenses: string | null;
    sales_count: string | null;
    pending_orders: string | null;
    urgent_orders: string | null;
  }>(
    `
    WITH
      sales_agg AS (
        SELECT
          COALESCE(SUM(quantity * unit_price), 0) AS total_sales,
          COALESCE(SUM(cost_amount), 0)           AS total_cogs,
          COUNT(*)                                 AS sales_count
        FROM sales
        WHERE sold_at >= $1::timestamptz
          AND sold_at <  $2::timestamptz + INTERVAL '1 day'
          AND status != 'returned'
      ),
      exp_agg AS (
        SELECT COALESCE(SUM(amount), 0) AS total_expenses
        FROM expenses
        WHERE created_at >= $1::timestamptz
          AND created_at <  $2::timestamptz + INTERVAL '1 day'
      ),
      ord_agg AS (
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')                          AS pending_orders,
          COUNT(*) FILTER (WHERE status = 'pending' AND priority = 'urgent')  AS urgent_orders
        FROM orders
      )
    SELECT
      sales_agg.total_sales,
      sales_agg.total_cogs,
      sales_agg.sales_count,
      exp_agg.total_expenses,
      ord_agg.pending_orders,
      ord_agg.urgent_orders
    FROM sales_agg, exp_agg, ord_agg
    `,
    [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)],
  );

  const totalSales = Number(row?.total_sales ?? 0);
  const totalCogs = Number(row?.total_cogs ?? 0);
  const totalExpenses = Number(row?.total_expenses ?? 0);
  const grossProfit = totalSales - totalCogs;

  return {
    totalSales,
    totalCogs,
    totalExpenses,
    grossProfit,
    netProfit: grossProfit - totalExpenses,
    salesCount: Number(row?.sales_count ?? 0),
    pendingOrders: Number(row?.pending_orders ?? 0),
    urgentOrders: Number(row?.urgent_orders ?? 0),
  };
}

// ─── Imports history ──────────────────────────────────────────────────────────

export type ImportHistoryRow = {
  id: number;
  importDate: string;
  oem: string;
  name: string;
  quantity: number;
  unit: string;
  unitPriceUsd: number;
  exchangeRate: number;
  transportCostGel: number;
  otherCostGel: number;
  totalUnitCostGel: number;
  suggestedRetailPriceGel: number;
  createdAt: string;
};

export async function getImportsHistory(
  limit: number = 1000,
): Promise<ImportHistoryRow[]> {
  let rows: {
    id: number;
    import_date: Date;
    oem: string;
    name: string;
    quantity: string;
    unit: string;
    unit_price_usd: string;
    exchange_rate: string;
    transport_cost_gel: string;
    other_cost_gel: string;
    total_unit_cost_gel: string;
    suggested_retail_price_gel: string;
    created_at: Date;
  }[];

  try {
    rows = await query(
      `SELECT id, import_date, oem, name, quantity, unit,
              unit_price_usd, exchange_rate,
              transport_cost_gel, other_cost_gel,
              total_unit_cost_gel, suggested_retail_price_gel,
              created_at
       FROM imports_history
       ORDER BY import_date DESC, created_at DESC
       LIMIT $1`,
      [limit],
    );
  } catch (err) {
    // Table may not exist yet on older deployments — return empty list gracefully.
    console.error("[getImportsHistory] query failed:", err);
    return [];
  }

  return rows.map((r) => ({
    id: r.id,
    importDate:
      r.import_date instanceof Date
        ? r.import_date.toISOString().slice(0, 10)
        : String(r.import_date).slice(0, 10),
    oem: r.oem,
    name: r.name,
    quantity: Number(r.quantity),
    unit: r.unit,
    unitPriceUsd: Number(r.unit_price_usd),
    exchangeRate: Number(r.exchange_rate),
    transportCostGel: Number(r.transport_cost_gel),
    otherCostGel: Number(r.other_cost_gel),
    totalUnitCostGel: Number(r.total_unit_cost_gel),
    suggestedRetailPriceGel: Number(r.suggested_retail_price_gel),
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
  }));
}

// ─── Top Products Analytics ───────────────────────────────────────────────────

export type TopProductRow = {
  productId: number | null;
  productName: string;
  oemCode: string | null;
  totalQuantity: number;
  totalRevenue: number;
  totalProfit: number;
};

export async function getTopSellingProducts(
  limit: number = 10,
  from?: Date,
  to?: Date,
): Promise<TopProductRow[]> {
  const hasRange = from && to;

  let rows: {
    product_id: number | null;
    product_name: string;
    oem_code: string | null;
    total_quantity: string;
    total_revenue: string;
    total_profit: string;
  }[];

  try {
    rows = await query(
      hasRange
        ? `
          SELECT
            s.product_id,
            COALESCE(p.name, 'უცნობი პროდუქტი') AS product_name,
            p.oem_code,
            SUM(s.quantity)                        AS total_quantity,
            SUM(s.quantity * s.unit_price)         AS total_revenue,
            SUM(s.quantity * s.unit_price - COALESCE(s.cost_amount, 0)) AS total_profit
          FROM sales s
          LEFT JOIN products p ON p.id = s.product_id
          WHERE s.sold_at >= $2::timestamptz
            AND s.sold_at <  $3::timestamptz + INTERVAL '1 day'
            AND s.status != 'returned'
          GROUP BY s.product_id, p.name, p.oem_code
          ORDER BY total_quantity DESC
          LIMIT $1
          `
        : `
          SELECT
            s.product_id,
            COALESCE(p.name, 'უცნობი პროდუქტი') AS product_name,
            p.oem_code,
            SUM(s.quantity)                        AS total_quantity,
            SUM(s.quantity * s.unit_price)         AS total_revenue,
            SUM(s.quantity * s.unit_price - COALESCE(s.cost_amount, 0)) AS total_profit
          FROM sales s
          LEFT JOIN products p ON p.id = s.product_id
          WHERE s.status != 'returned'
          GROUP BY s.product_id, p.name, p.oem_code
          ORDER BY total_quantity DESC
          LIMIT $1
          `,
      hasRange
        ? [limit, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)]
        : [limit],
    );
  } catch (err) {
    console.error("[getTopSellingProducts] query failed:", err);
    return [];
  }

  return rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name ?? "უცნობი პროდუქტი",
    oemCode: r.oem_code,
    totalQuantity: Number(r.total_quantity ?? 0),
    totalRevenue: Number(r.total_revenue ?? 0),
    totalProfit: Number(r.total_profit ?? 0),
  }));
}

export async function getTopProfitableProducts(
  limit: number = 10,
  from?: Date,
  to?: Date,
): Promise<TopProductRow[]> {
  const hasRange = from && to;

  let rows: {
    product_id: number | null;
    product_name: string;
    oem_code: string | null;
    total_quantity: string;
    total_revenue: string;
    total_profit: string;
  }[];

  try {
    rows = await query(
      hasRange
        ? `
          SELECT
            s.product_id,
            COALESCE(p.name, 'უცნობი პროდუქტი') AS product_name,
            p.oem_code,
            SUM(s.quantity)                        AS total_quantity,
            SUM(s.quantity * s.unit_price)         AS total_revenue,
            SUM(s.quantity * s.unit_price - COALESCE(s.cost_amount, 0)) AS total_profit
          FROM sales s
          LEFT JOIN products p ON p.id = s.product_id
          WHERE s.sold_at >= $2::timestamptz
            AND s.sold_at <  $3::timestamptz + INTERVAL '1 day'
            AND s.status != 'returned'
          GROUP BY s.product_id, p.name, p.oem_code
          ORDER BY total_profit DESC
          LIMIT $1
          `
        : `
          SELECT
            s.product_id,
            COALESCE(p.name, 'უცნობი პროდუქტი') AS product_name,
            p.oem_code,
            SUM(s.quantity)                        AS total_quantity,
            SUM(s.quantity * s.unit_price)         AS total_revenue,
            SUM(s.quantity * s.unit_price - COALESCE(s.cost_amount, 0)) AS total_profit
          FROM sales s
          LEFT JOIN products p ON p.id = s.product_id
          WHERE s.status != 'returned'
          GROUP BY s.product_id, p.name, p.oem_code
          ORDER BY total_profit DESC
          LIMIT $1
          `,
      hasRange
        ? [limit, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)]
        : [limit],
    );
  } catch (err) {
    console.error("[getTopProfitableProducts] query failed:", err);
    return [];
  }

  return rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name ?? "უცნობი პროდუქტი",
    oemCode: r.oem_code,
    totalQuantity: Number(r.total_quantity ?? 0),
    totalRevenue: Number(r.total_revenue ?? 0),
    totalProfit: Number(r.total_profit ?? 0),
  }));
}

export async function getProducts(): Promise<ProductRow[]> {
  const rows = await query<{
    id: number;
    name: string;
    oem_code: string | null;
    current_stock: number;
    min_stock: number;
    unit_price: string;
    unit: string;
    created_at: Date;
  }>(
    `
    SELECT id, name, oem_code, current_stock, min_stock, unit_price, unit, created_at
    FROM products
    ORDER BY name ASC, created_at DESC
`,
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    oemCode: r.oem_code,
    currentStock: r.current_stock,
    minStock: r.min_stock,
    unitPrice: Number(r.unit_price),
    unit: r.unit,
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
  }));
}
