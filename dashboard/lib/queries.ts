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
  productName: string | null;
  oemCode: string | null;
  quantityNeeded: number;
  status: string;
  priority: "urgent" | "normal" | "low" | string;
  createdAt: string;
  notes: string | null;
};

export async function getOrders(limit: number = 500): Promise<OrderRow[]> {
  const rows = await query<{
    id: number;
    product_id: number | null;
    product_name: string | null;
    oem_code: string | null;
    quantity_needed: number;
    status: string;
    priority: string;
    created_at: Date;
    notes: string | null;
  }>(
    `
    SELECT
      o.id,
      o.product_id,
      p.name      AS product_name,
      p.oem_code  AS oem_code,
      o.quantity_needed,
      o.status,
      o.priority,
      o.created_at,
      o.notes
    FROM orders o
    LEFT JOIN products p ON p.id = o.product_id
    ORDER BY
      CASE o.status WHEN 'pending' THEN 0 ELSE 1 END,
      CASE o.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      o.created_at DESC
    LIMIT $1
    `,
    [limit],
  );

  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    productName: r.product_name,
    oemCode: r.oem_code,
    quantityNeeded: r.quantity_needed,
    status: r.status,
    priority: r.priority,
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
    notes: r.notes,
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
      s.receipt_printed
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
};

export async function getExpenses(limit: number = 500): Promise<ExpenseRow[]> {
  const rows = await query<{
    id: number;
    amount: string;
    description: string | null;
    category: string | null;
    payment_method: string;
    created_at: Date;
  }>(
    `
    SELECT id, amount, description, category, payment_method, created_at
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
    ORDER BY name ASC
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
