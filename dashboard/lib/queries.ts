import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import { query, queryOne } from "./db";

export type SellerFilter = "all" | "llc" | "individual";

export type DashboardSummary = {
  totalSales: number;
  totalExpenses: number;
  totalCogs: number;
  grossProfit: number;
  netProfit: number;
  salesCount: number;
  pendingOrders: number;
  urgentOrders: number;
  ordersNew: number;
  ordersProcessing: number;
  ordersOrdered: number;
  ordersReady: number;
  ordersDelivered: number;
  ordersCancelled: number;
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
    orders_new: string | null;
    orders_processing: string | null;
    orders_ordered: string | null;
    orders_ready: string | null;
    orders_delivered: string | null;
    orders_cancelled: string | null;
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
          AND seller_type = 'llc'
      ),
      exp_agg AS (
        SELECT COALESCE(SUM(amount), 0) AS total_expenses
        FROM expenses
        WHERE created_at >= NOW() - ($1::int || ' days')::interval
      ),
      ord_agg AS (
        SELECT
          COUNT(*) FILTER (WHERE status IN ('new', 'processing'))                          AS pending_orders,
          COUNT(*) FILTER (WHERE status IN ('new', 'processing') AND priority = 'urgent')  AS urgent_orders,
          COUNT(*) FILTER (WHERE status = 'new')                                           AS orders_new,
          COUNT(*) FILTER (WHERE status = 'processing')                                    AS orders_processing,
          COUNT(*) FILTER (WHERE status = 'ordered')                                       AS orders_ordered,
          COUNT(*) FILTER (WHERE status = 'ready')                                         AS orders_ready,
          COUNT(*) FILTER (WHERE status = 'delivered')                                     AS orders_delivered,
          COUNT(*) FILTER (WHERE status = 'cancelled')                                     AS orders_cancelled
        FROM orders
      )
    SELECT
      sales_agg.total_sales,
      sales_agg.total_cogs,
      sales_agg.sales_count,
      exp_agg.total_expenses,
      ord_agg.pending_orders,
      ord_agg.urgent_orders,
      ord_agg.orders_new,
      ord_agg.orders_processing,
      ord_agg.orders_ordered,
      ord_agg.orders_ready,
      ord_agg.orders_delivered,
      ord_agg.orders_cancelled
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
    ordersNew: Number(row?.orders_new ?? 0),
    ordersProcessing: Number(row?.orders_processing ?? 0),
    ordersOrdered: Number(row?.orders_ordered ?? 0),
    ordersReady: Number(row?.orders_ready ?? 0),
    ordersDelivered: Number(row?.orders_delivered ?? 0),
    ordersCancelled: Number(row?.orders_cancelled ?? 0),
  };
}

export type DailyPoint = {
  day: string;
  sales: number;
  expenses: number;
  profit: number;
};

export async function getDailySeries(
  days: number = 30,
  sellerType: SellerFilter = "all",
): Promise<DailyPoint[]> {
  const sellerParam = sellerType === "all" ? null : sellerType;

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
        AND ($2::text IS NULL OR seller_type = $2::text)
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
    [days, sellerParam],
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
  quantityOrdered: number;   // how many placed with supplier (0 = not yet ordered)
  status: string;
  priority: "urgent" | "low" | string;
  createdAt: string;         // always set — fallback: NOW()
  notes: string | null;
};

export async function getOrders(limit: number = 2000): Promise<OrderRow[]> {
  noStore();
  let rows: {
    id: number;
    product_id: number | null;
    product_name: string | null;
    oem_code: string | null;
    quantity_needed: number;
    quantity_ordered: number;
    status: string;
    priority: string;
    created_at: Date;
    notes: string | null;
  }[];

  try {
    rows = await query(
      `
      SELECT
        o.id,
        o.product_id,
        COALESCE(p.name, o.part_name) AS product_name,
        o.oem_code,
        o.quantity_needed,
        o.quantity_ordered,
        o.status,
        CASE WHEN o.priority = 'urgent' THEN 'urgent' ELSE 'low' END AS priority,
        o.created_at,
        o.notes
      FROM orders o
      LEFT JOIN products p ON p.id = o.product_id
      ORDER BY
        CASE o.status WHEN 'new' THEN 0 WHEN 'processing' THEN 1 ELSE 2 END,
        CASE o.priority WHEN 'urgent' THEN 0 ELSE 1 END,
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
    productName: r.product_name ?? "ძველი ჩანაწერი",
    oemCode: r.oem_code !== "-" ? r.oem_code : null,
    quantityNeeded: Number(r.quantity_needed),
    quantityOrdered: Number(r.quantity_ordered ?? 0),
    status: r.status,
    priority: (r.priority === "urgent" ? "urgent" : "low") as OrderRow["priority"],
    createdAt: r.created_at instanceof Date
      ? r.created_at.toISOString()
      : String(r.created_at),
    notes: r.notes ?? null,
  }));
}

// ─── Sales ────────────────────────────────────────────────────────────────────

export type SaleRow = {
  id: number;
  productId: number | null;
  productName: string | null;
  oemCode: string | null;
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
    oem_code: string | null;
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
      p.oem_code    AS oem_code,
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
    oemCode: r.oem_code,
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
  isPaid: boolean;
  isNonCash: boolean;
  currency: string;
  originalAmount: number | null;
  exchangeRate: number;
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
    is_paid: boolean;
    is_non_cash: boolean;
    currency: string;
    original_amount: string | null;
    exchange_rate: string;
  }>(
    `
    SELECT id, amount, description, category, payment_method, created_at,
           vat_amount, is_vat_included, is_paid, is_non_cash,
           COALESCE(currency, 'GEL')          AS currency,
           original_amount,
           COALESCE(exchange_rate, 1.0)        AS exchange_rate
    FROM expenses
    ORDER BY is_paid ASC, created_at DESC
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
    isPaid: r.is_paid,
    isNonCash: r.is_non_cash,
    currency: r.currency ?? "GEL",
    originalAmount: r.original_amount != null ? Number(r.original_amount) : null,
    exchangeRate: Number(r.exchange_rate ?? 1),
  }));
}

// ─── Expenses by Category ────────────────────────────────────────────────────

export type ExpenseCategoryRow = {
  category: string;
  total: number;
};

export async function getExpensesByCategory(): Promise<ExpenseCategoryRow[]> {
  const rows = await query<{ category: string; total: string }>(
    `SELECT COALESCE(NULLIF(TRIM(category), ''), 'general') AS category,
            SUM(amount) AS total
     FROM expenses
     WHERE is_paid = TRUE AND is_non_cash = FALSE
     GROUP BY 1
     ORDER BY total DESC`,
    [],
  );
  return rows.map((r) => ({ category: r.category, total: Number(r.total) }));
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
  category: string | null;
  compatibilityNotes: string | null;
  compatCount: number;
  createdAt: string;
};

export type CompatibilityRow = {
  id: number;
  model: string;
  drive: string | null;
  engine: string | null;
  fuelType: string | null;
  yearFrom: number | null;
  yearTo: number | null;
};

export async function getDashboardSummaryRange(
  from: Date,
  to: Date,
  sellerType: SellerFilter = "all",
): Promise<DashboardSummary> {
  const sellerParam = sellerType === "all" ? null : sellerType;

  const row = await queryOne<{
    total_sales: string | null;
    total_cogs: string | null;
    total_expenses: string | null;
    sales_count: string | null;
    pending_orders: string | null;
    urgent_orders: string | null;
    orders_new: string | null;
    orders_processing: string | null;
    orders_ordered: string | null;
    orders_ready: string | null;
    orders_delivered: string | null;
    orders_cancelled: string | null;
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
          AND ($3::text IS NULL OR seller_type = $3::text)
      ),
      exp_agg AS (
        SELECT COALESCE(SUM(amount), 0) AS total_expenses
        FROM expenses
        WHERE created_at >= $1::timestamptz
          AND created_at <  $2::timestamptz + INTERVAL '1 day'
      ),
      ord_agg AS (
        SELECT
          COUNT(*) FILTER (WHERE status IN ('new', 'processing'))                          AS pending_orders,
          COUNT(*) FILTER (WHERE status IN ('new', 'processing') AND priority = 'urgent')  AS urgent_orders,
          COUNT(*) FILTER (WHERE status = 'new')                                           AS orders_new,
          COUNT(*) FILTER (WHERE status = 'processing')                                    AS orders_processing,
          COUNT(*) FILTER (WHERE status = 'ordered')                                       AS orders_ordered,
          COUNT(*) FILTER (WHERE status = 'ready')                                         AS orders_ready,
          COUNT(*) FILTER (WHERE status = 'delivered')                                     AS orders_delivered,
          COUNT(*) FILTER (WHERE status = 'cancelled')                                     AS orders_cancelled
        FROM orders
      )
    SELECT
      sales_agg.total_sales,
      sales_agg.total_cogs,
      sales_agg.sales_count,
      exp_agg.total_expenses,
      ord_agg.pending_orders,
      ord_agg.urgent_orders,
      ord_agg.orders_new,
      ord_agg.orders_processing,
      ord_agg.orders_ordered,
      ord_agg.orders_ready,
      ord_agg.orders_delivered,
      ord_agg.orders_cancelled
    FROM sales_agg, exp_agg, ord_agg
    `,
    [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10), sellerParam],
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
    ordersNew: Number(row?.orders_new ?? 0),
    ordersProcessing: Number(row?.orders_processing ?? 0),
    ordersOrdered: Number(row?.orders_ordered ?? 0),
    ordersReady: Number(row?.orders_ready ?? 0),
    ordersDelivered: Number(row?.orders_delivered ?? 0),
    ordersCancelled: Number(row?.orders_cancelled ?? 0),
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
            AND s.seller_type = 'llc'
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
            AND s.seller_type = 'llc'
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
            AND s.seller_type = 'llc'
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
            AND s.seller_type = 'llc'
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
    category: string | null;
    compatibility_notes: string | null;
    compat_count: string;
    created_at: Date;
  }>(
    `
    WITH cc AS (
      SELECT product_id, COUNT(*) AS cnt FROM product_compatibility GROUP BY product_id
    )
    SELECT p.id, p.name, p.oem_code, p.current_stock, p.min_stock, p.unit_price, p.unit,
           p.category, p.compatibility_notes, p.created_at,
           COALESCE(cc.cnt, 0) AS compat_count
    FROM products p
    LEFT JOIN cc ON cc.product_id = p.id
    ORDER BY p.name ASC, p.created_at DESC
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
    category: r.category,
    compatibilityNotes: r.compatibility_notes,
    compatCount: Number(r.compat_count),
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
  }));
}

export { PRODUCTS_PAGE_SIZE } from "./constants";
import { PRODUCTS_PAGE_SIZE } from "./constants";

// ─── Public catalog types ─────────────────────────────────────────────────────

export type PublicProductItem = {
  id: number;
  slug: string;
  name: string;
  oemCode: string | null;
  category: string | null;
  currentStock: number;
  price: number;
  imageUrl: string | null;
  compatibility: CompatibilityRow[];
};

export type PublicCatalogResult = {
  items: PublicProductItem[];
  total: number;
  page: number;
  totalPages: number;
};

export type PublicProductDetail = {
  id: number;
  slug: string;
  name: string;
  oemCode: string | null;
  category: string | null;
  currentStock: number;
  unit: string;
  price: number;
  imageUrl: string | null;
  description: string | null;
  compatibilityNotes: string | null;
  compatibility: CompatibilityRow[];
};

export async function getPublicCatalog(filters: {
  category?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<PublicCatalogResult> {
  noStore();

  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(48, Math.max(1, filters.limit ?? 24));
  const offset = (page - 1) * limit;

  const params: unknown[] = [limit, offset];
  const conditions: string[] = ["p.is_published = TRUE"];

  if (filters.category) {
    params.push(filters.category);
    conditions.push(`p.category = $${params.length}`);
  }

  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(p.name ILIKE $${params.length} OR p.oem_code ILIKE $${params.length})`,
    );
  }

  const rows = await query<{
    id: number;
    slug: string;
    name: string;
    oem_code: string | null;
    category: string | null;
    current_stock: number;
    display_price: string;
    image_url: string | null;
    compatibility: CompatibilityRow[];
    total_count: string;
  }>(
    `SELECT
       p.id,
       p.slug,
       p.name,
       p.oem_code,
       p.category,
       p.current_stock,
       COALESCE(p.recommended_price, p.unit_price) AS display_price,
       p.image_url,
       COALESCE(
         json_agg(
           json_build_object(
             'id',       pc.id,
             'model',    pc.model,
             'drive',    pc.drive,
             'engine',   pc.engine,
             'fuelType', pc.fuel_type,
             'yearFrom', pc.year_from,
             'yearTo',   pc.year_to
           ) ORDER BY pc.model
         ) FILTER (WHERE pc.id IS NOT NULL),
         '[]'::json
       ) AS compatibility,
       COUNT(*) OVER() AS total_count
     FROM products p
     LEFT JOIN product_compatibility pc ON pc.product_id = p.id
     WHERE ${conditions.join(" AND ")}
     GROUP BY p.id
     ORDER BY p.name ASC
     LIMIT $1 OFFSET $2`,
    params,
  );

  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  return {
    items: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      oemCode: r.oem_code,
      category: r.category,
      currentStock: r.current_stock,
      price: Number(r.display_price),
      imageUrl: r.image_url,
      compatibility: r.compatibility ?? [],
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getPublicProduct(
  slug: string,
): Promise<PublicProductDetail | null> {
  noStore();

  const row = await queryOne<{
    id: number;
    slug: string;
    name: string;
    oem_code: string | null;
    category: string | null;
    current_stock: number;
    unit: string;
    display_price: string;
    image_url: string | null;
    description: string | null;
    compatibility_notes: string | null;
    compatibility: CompatibilityRow[];
  }>(
    `SELECT
       p.id,
       p.slug,
       p.name,
       p.oem_code,
       p.category,
       p.current_stock,
       p.unit,
       COALESCE(p.recommended_price, p.unit_price) AS display_price,
       p.image_url,
       p.description,
       p.compatibility_notes,
       COALESCE(
         json_agg(
           json_build_object(
             'id',       pc.id,
             'model',    pc.model,
             'drive',    pc.drive,
             'engine',   pc.engine,
             'fuelType', pc.fuel_type,
             'yearFrom', pc.year_from,
             'yearTo',   pc.year_to
           ) ORDER BY pc.model
         ) FILTER (WHERE pc.id IS NOT NULL),
         '[]'::json
       ) AS compatibility
     FROM products p
     LEFT JOIN product_compatibility pc ON pc.product_id = p.id
     WHERE p.slug = $1
       AND p.is_published = TRUE
     GROUP BY p.id`,
    [slug],
  );

  if (!row) return null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    oemCode: row.oem_code,
    category: row.category,
    currentStock: row.current_stock,
    unit: row.unit,
    price: Number(row.display_price),
    imageUrl: row.image_url,
    description: row.description,
    compatibilityNotes: row.compatibility_notes,
    compatibility: row.compatibility ?? [],
  };
}

export async function getPublicCategories(): Promise<string[]> {
  noStore();
  const rows = await query<{ category: string }>(
    `SELECT DISTINCT category
     FROM products
     WHERE is_published = TRUE
       AND current_stock > 0
       AND category IS NOT NULL
     ORDER BY category ASC`,
  );
  return rows.map((r) => r.category);
}

export async function getProductsPaged(
  page: number,
  limit: number = PRODUCTS_PAGE_SIZE,
  search?: string,
): Promise<{ rows: ProductRow[]; total: number }> {
  const offset = (Math.max(1, page) - 1) * limit;
  const q = search?.trim() ?? "";
  const params: unknown[] = q
    ? [limit, offset, `%${q}%`]
    : [limit, offset];
  const whereClause = q
    ? `WHERE p.name ILIKE $3 OR p.oem_code ILIKE $3 OR p.category ILIKE $3 OR p.compatibility_notes ILIKE $3`
    : "";
  const rows = await query<{
    id: number;
    name: string;
    oem_code: string | null;
    current_stock: number;
    min_stock: number;
    unit_price: string;
    unit: string;
    category: string | null;
    compatibility_notes: string | null;
    compat_count: string;
    created_at: Date;
    total_count: string;
  }>(
    `WITH cc AS (
       SELECT product_id, COUNT(*) AS cnt FROM product_compatibility GROUP BY product_id
     )
     SELECT p.id, p.name, p.oem_code, p.current_stock, p.min_stock, p.unit_price, p.unit,
            p.category, p.compatibility_notes, p.created_at,
            COALESCE(cc.cnt, 0) AS compat_count,
            COUNT(*) OVER() AS total_count
     FROM products p
     LEFT JOIN cc ON cc.product_id = p.id
     ${whereClause}
     ORDER BY p.name ASC, p.created_at DESC
     LIMIT $1 OFFSET $2`,
    params,
  );

  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      oemCode: r.oem_code,
      currentStock: r.current_stock,
      minStock: r.min_stock,
      unitPrice: Number(r.unit_price),
      unit: r.unit,
      category: r.category,
      compatibilityNotes: r.compatibility_notes,
      compatCount: Number(r.compat_count),
      createdAt:
        r.created_at instanceof Date
          ? r.created_at.toISOString()
          : String(r.created_at),
    })),
    total,
  };
}
