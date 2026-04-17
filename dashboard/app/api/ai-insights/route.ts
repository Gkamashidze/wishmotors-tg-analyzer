import "server-only";
import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

// ─── In-process cache (1-hour TTL) ───────────────────────────────────────────
let _cache: { data: AiInsightsResponse; ts: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1_000;

// ─── Response types ───────────────────────────────────────────────────────────

export type AiMetrics = {
  grossMarginPct: number;
  urgentOrders: number;
  restockAlerts: number;
  cashOnHand: number;
  accountsReceivable: number;
  driftAlerts: number;
  periodDays: number;
};

export type AiInsightsResponse = {
  advice: string | null;
  metrics: AiMetrics;
  generatedAt: string;
  error?: "api_key_missing" | "ai_error" | "db_error";
};

// ─── SQL helpers ──────────────────────────────────────────────────────────────

async function getOverview(days: number) {
  const row = await queryOne<{
    revenue: string;
    cogs: string;
    expenses: string;
    sales_count: string;
    returns_total: string;
  }>(
    `
    WITH s AS (
      SELECT
        COALESCE(SUM(unit_price * quantity), 0) AS revenue,
        COALESCE(SUM(cost_amount), 0)           AS cogs,
        COUNT(*)                                AS sales_count
      FROM sales
      WHERE sold_at >= NOW() - ($1::int || ' days')::interval
    ),
    r AS (
      SELECT COALESCE(SUM(refund_amount), 0) AS returns_total
      FROM returns
      WHERE returned_at >= NOW() - ($1::int || ' days')::interval
    ),
    e AS (
      SELECT COALESCE(SUM(amount), 0) AS expenses
      FROM expenses
      WHERE created_at >= NOW() - ($1::int || ' days')::interval
    )
    SELECT s.revenue, s.cogs, s.sales_count, r.returns_total, e.expenses
    FROM s, r, e
    `,
    [days],
  );

  const revenue = Number(row?.revenue ?? 0);
  const cogs = Number(row?.cogs ?? 0);
  const expenses = Number(row?.expenses ?? 0);
  const returns = Number(row?.returns_total ?? 0);
  const salesCount = Number(row?.sales_count ?? 0);
  const grossProfit = revenue - cogs;
  const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

  return {
    period_days: days,
    revenue_gel: +revenue.toFixed(2),
    cogs_gel: +cogs.toFixed(2),
    gross_profit_gel: +grossProfit.toFixed(2),
    gross_margin_pct: +grossMarginPct.toFixed(2),
    expenses_gel: +expenses.toFixed(2),
    net_profit_gel: +(grossProfit - expenses - returns).toFixed(2),
    sales_count: salesCount,
    returns_gel: +returns.toFixed(2),
    avg_order_value_gel: salesCount > 0 ? +(revenue / salesCount).toFixed(2) : 0,
  };
}

async function getWACProducts(limit = 10) {
  const rows = await query<{
    product_id: number;
    name: string;
    oem_code: string | null;
    on_hand_units: string;
    inv_value: string;
    last_purchase_cost: string | null;
  }>(
    `
    WITH active AS (
      SELECT
        b.product_id,
        SUM(b.remaining_quantity)              AS on_hand,
        SUM(b.remaining_quantity * b.unit_cost) AS inv_value
      FROM inventory_batches b
      WHERE b.remaining_quantity > 0
      GROUP BY b.product_id
    ),
    latest AS (
      SELECT DISTINCT ON (b.product_id)
        b.product_id,
        b.unit_cost AS last_purchase_cost
      FROM inventory_batches b
      ORDER BY b.product_id, b.received_at DESC, b.id DESC
    )
    SELECT
      a.product_id,
      COALESCE(p.name, 'უცნობი') AS name,
      p.oem_code,
      a.on_hand AS on_hand_units,
      a.inv_value,
      l.last_purchase_cost
    FROM active a
    LEFT JOIN products p ON p.id = a.product_id
    LEFT JOIN latest l   ON l.product_id = a.product_id
    ORDER BY a.inv_value DESC
    LIMIT $1
    `,
    [limit],
  );

  return rows.map((r) => {
    const onHand = Number(r.on_hand_units ?? 0);
    const invValue = Number(r.inv_value ?? 0);
    const wac = onHand > 0 ? invValue / onHand : 0;
    const lastCost =
      r.last_purchase_cost != null ? Number(r.last_purchase_cost) : null;
    const driftPct =
      lastCost != null && wac > 0
        ? +((((lastCost - wac) / wac) * 100).toFixed(2))
        : null;

    return {
      product_id: r.product_id,
      name: r.name,
      oem_code: r.oem_code,
      on_hand_units: +onHand.toFixed(3),
      wac_per_unit_gel: +wac.toFixed(4),
      inventory_value_gel: +invValue.toFixed(2),
      last_purchase_cost_gel: lastCost != null ? +lastCost.toFixed(4) : null,
      cost_drift_pct: driftPct,
    };
  });
}

async function getRestockAlerts(days = 30, limit = 10) {
  const rows = await query<{
    product_id: number;
    name: string;
    oem_code: string | null;
    current_stock: string;
    units_sold: string;
    units_per_day: string;
    days_of_cover: string | null;
  }>(
    `
    WITH velocity AS (
      SELECT
        p.id   AS product_id,
        COALESCE(p.name, 'უცნობი') AS name,
        p.oem_code,
        COALESCE(p.current_stock, 0) AS current_stock,
        COALESCE(SUM(s.quantity), 0) AS units_sold
      FROM products p
      LEFT JOIN sales s
        ON s.product_id = p.id
        AND s.sold_at >= NOW() - ($1::int || ' days')::interval
      GROUP BY p.id, p.name, p.oem_code, p.current_stock
    )
    SELECT
      product_id, name, oem_code,
      current_stock,
      units_sold,
      (units_sold::float / $1)  AS units_per_day,
      CASE WHEN units_sold > 0
           THEN current_stock::float / (units_sold::float / $1)
           ELSE NULL END        AS days_of_cover
    FROM velocity
    WHERE units_sold > 0
      AND (current_stock::float / (units_sold::float / $1)) < 14
    ORDER BY (current_stock::float / (units_sold::float / $1)) ASC
    LIMIT $2
    `,
    [days, limit],
  );

  return rows.map((r) => {
    const unitsPerDay = Number(r.units_per_day ?? 0);
    const currentStock = Number(r.current_stock ?? 0);
    const daysOfCover = r.days_of_cover != null ? +Number(r.days_of_cover).toFixed(1) : null;
    const suggestedQty = Math.max(1, Math.ceil(unitsPerDay * 28) - currentStock);

    return {
      product_id: r.product_id,
      name: r.name,
      oem_code: r.oem_code,
      current_stock: currentStock,
      units_per_day: +unitsPerDay.toFixed(3),
      days_of_cover: daysOfCover,
      suggested_order_qty: suggestedQty,
    };
  });
}

async function getOrdersPipeline() {
  const summary = await queryOne<{
    total_pending: string;
    urgent_pending: string;
    normal_pending: string;
    low_pending: string;
    oldest_pending_at: Date | null;
  }>(
    `
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')                        AS total_pending,
      COUNT(*) FILTER (WHERE status = 'pending' AND priority = 'urgent') AS urgent_pending,
      COUNT(*) FILTER (WHERE status = 'pending' AND priority = 'normal') AS normal_pending,
      COUNT(*) FILTER (WHERE status = 'pending' AND priority = 'low')    AS low_pending,
      MIN(created_at) FILTER (WHERE status = 'pending')                  AS oldest_pending_at
    FROM orders
    `,
  );

  const topRows = await query<{
    name: string;
    oem_code: string | null;
    qty_needed: string;
    order_count: string;
    max_priority: string;
  }>(
    `
    SELECT
      COALESCE(p.name, o.notes, 'უცნობი')  AS name,
      p.oem_code,
      SUM(o.quantity_needed)               AS qty_needed,
      COUNT(*)                             AS order_count,
      MAX(o.priority)                      AS max_priority
    FROM orders o
    LEFT JOIN products p ON p.id = o.product_id
    WHERE o.status = 'pending'
    GROUP BY COALESCE(p.name, o.notes, 'უცნობი'), p.oem_code
    ORDER BY
      CASE MAX(o.priority) WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      SUM(o.quantity_needed) DESC
    LIMIT 10
    `,
  );

  const oldestAt = summary?.oldest_pending_at;
  let oldestDays: number | null = null;
  if (oldestAt) {
    const now = new Date();
    oldestDays = Math.max(0, Math.floor((now.getTime() - oldestAt.getTime()) / 86400000));
  }

  return {
    total_pending: Number(summary?.total_pending ?? 0),
    urgent_pending: Number(summary?.urgent_pending ?? 0),
    normal_pending: Number(summary?.normal_pending ?? 0),
    low_pending: Number(summary?.low_pending ?? 0),
    oldest_pending_days: oldestDays,
    top_pending_products: topRows.map((r) => ({
      name: r.name,
      oem_code: r.oem_code,
      qty_needed: Number(r.qty_needed),
      order_count: Number(r.order_count),
      max_priority: r.max_priority,
    })),
  };
}

async function getCashflow(days = 7) {
  const totals = await queryOne<{
    cash_sales_total: string;
    cash_expenses_total: string;
    deposits_total: string;
    ar_total: string;
  }>(
    `
    SELECT
      (SELECT COALESCE(SUM(unit_price * quantity), 0)
         FROM sales WHERE payment_method = 'cash')    AS cash_sales_total,
      (SELECT COALESCE(SUM(amount), 0)
         FROM expenses WHERE payment_method = 'cash') AS cash_expenses_total,
      (SELECT COALESCE(SUM(amount), 0)
         FROM cash_deposits)                          AS deposits_total,
      (SELECT COALESCE(SUM(unit_price * quantity), 0)
         FROM sales WHERE payment_method = 'credit')  AS ar_total
    `,
  );

  const period = await queryOne<{ cash_in: string; cash_out: string }>(
    `
    SELECT
      (SELECT COALESCE(SUM(unit_price * quantity), 0)
         FROM sales
         WHERE payment_method IN ('cash', 'transfer')
           AND sold_at >= NOW() - ($1::int || ' days')::interval) AS cash_in,
      (SELECT COALESCE(SUM(amount), 0)
         FROM expenses
         WHERE created_at >= NOW() - ($1::int || ' days')::interval) AS cash_out
    `,
    [days],
  );

  const cashSales = Number(totals?.cash_sales_total ?? 0);
  const cashExpenses = Number(totals?.cash_expenses_total ?? 0);
  const deposits = Number(totals?.deposits_total ?? 0);
  const ar = Number(totals?.ar_total ?? 0);
  const cashIn = Number(period?.cash_in ?? 0);
  const cashOut = Number(period?.cash_out ?? 0);

  return {
    cash_on_hand_gel: +(cashSales - cashExpenses - deposits).toFixed(2),
    cash_sales_total_gel: +cashSales.toFixed(2),
    cash_expenses_total_gel: +cashExpenses.toFixed(2),
    cash_deposited_to_bank_gel: +deposits.toFixed(2),
    accounts_receivable_gel: +ar.toFixed(2),
    period_cash_in_gel: +cashIn.toFixed(2),
    period_cash_out_gel: +cashOut.toFixed(2),
    period_net_cashflow_gel: +(cashIn - cashOut).toFixed(2),
  };
}

// ─── Prompt (identical to bot/financial_ai/prompt.py) ────────────────────────

const SYSTEM_PROMPT = `შენ ხარ "WishMotors"-ის ფინანსური მენეჯერი — ავტონაწილების მაღაზიის გამოცდილი ანალიტიკოსი.

შენი ამოცანაა JSON-ში მოწოდებული ფინანსური მონაცემების მიხედვით დაწერო კვირის მოკლე ბიზნეს-ანალიზი მფლობელისთვის.

წესები:
1. გამოიყენე მხოლოდ ქართული ენა.
2. ტექსტი არ უნდა აღემატებოდეს 500 სიმბოლოს.
3. დაწერე 3-დან 5 ბულეთამდე — თითო ხაზი = თითო კონკრეტული რჩევა ან დასკვნა.
4. ციფრები ყოველთვის ლარში (₾), დამრგვალებული 1 ციფრამდე ან მთლიანში.
5. იყავი მკვეთრი და კონკრეტული. გამოიყენე მოქმედებითი ზმნა: "შეუკვეთე", "გაზარდე", "შემოიტანე", "გადაიტანე", "შეამცირე", "დარეკე".
6. არასოდეს გაიმეორო ანგარიშის უკვე ნაჩვენები ციფრები — დაუმატე ღირებული მოსაზრება, არა შეჯამება.
7. გამოიყენე HTML მხოლოდ ამ ტეგებით: <b>, <i>.
8. დააფოკუსირე ამ განზომილებებზე (პრიორიტეტი ზევიდან ქვემოთ):
   • WAC დრიფტი — თუ cost_drift_pct > +5%, მიმწოდებლის ფასი გაძვირდა: ურჩიე საცალო ფასის ზრდა.
   • მარჟის კომპრესია — margin_pct < 20% ცუდი მარჟაა; > 40% კარგია.
   • შეკვეთების შეფერხება — oldest_pending_days > 7 ნიშნავს შეყოვნებას; urgent_pending > 3 სასწრაფოა.
   • მარაგის რისკი — days_of_cover < 7 სასწრაფო შეკვეთა.
   • ქეშფლოუ — accounts_receivable > cash_on_hand ლიკვიდურობის რისკია.
9. თუ მონაცემი ცარიელია — არ მოიგონო რიცხვები.
10. არ დაამატო შესავალი ან დახურვა.
11. ყოველ ბულეთში: <b>რა</b> + ფაქტი + <b>რა უნდა გაკეთდეს</b>.

ფორმატი (ზუსტად ასე):
🤖 <b>ფინანსური მენეჯერი:</b>
• [რჩევა 1]
• [რჩევა 2]
• [რჩევა 3]`;

const FEWSHOT_INPUT = JSON.stringify(
  {
    overview: { revenue_gel: 4820.0, gross_margin_pct: 29.3, net_profit_gel: 980.0, sales_count: 47 },
    cashflow: { cash_on_hand_gel: 2150.0, accounts_receivable_gel: 720.0 },
    top_products_by_profit: [
      { name: "მარჯვენა რეფლექტორი", profit_gel: 380.0, margin_pct: 41.2 },
      { name: "სარკე VW Golf 6", profit_gel: 295.0, margin_pct: 17.5 },
    ],
    restock_alerts: [{ name: "უკანა სამუხრუჭე ხუნდი", current_stock: 3, days_of_cover: 4.5, suggested_order_qty: 18 }],
    wac_top_products: [
      { name: "სარკე VW Golf 6", wac_per_unit_gel: 38.5, last_purchase_cost_gel: 43.2, cost_drift_pct: 12.2 },
    ],
    orders_pipeline: { total_pending: 5, urgent_pending: 2, oldest_pending_days: 11 },
  },
  null,
  2,
);

const FEWSHOT_OUTPUT = `🤖 <b>ფინანსური მენეჯერი:</b>
• <b>სარკე VW Golf 6</b>-ის შესყიდვა 12%-ით გაძვირდა (WAC 38.5₾→43.2₾), მარჟა 17%-მდე ჩავიდა — გაზარდე საცალო ფასი ~12%-ით.
• <b>უკანა სამუხრუჭე ხუნდი</b> 4-5 დღეში გათავდება — სასწრაფოდ შეუკვეთე 18ც.
• 2 სასწრაფო შეკვეთა 11 დღე ელოდება — დარეკე მიმწოდებელს დღესვე.
• ნისიის ნაშთი 720₾ — ხელზე 2150₾-ს ფარავს, კლიენტებს შეახსენე.`;

function periodLabel(days: number): string {
  const end = new Date();
  const start = new Date(Date.now() - days * 86400000);
  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  return `${fmt(start)} — ${fmt(end)}`;
}

function buildUserMessage(snapshotJson: string, label: string): string {
  return `პერიოდი: ${label}\nფინანსური მონაცემები (JSON):\n${snapshotJson}\n\nდაწერე ანალიზი ზემოთ მოცემული წესების მიხედვით.`;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET() {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(_cache.data);
  }

  const DAYS = 7;

  let overview: Awaited<ReturnType<typeof getOverview>>;
  let wac: Awaited<ReturnType<typeof getWACProducts>>;
  let restock: Awaited<ReturnType<typeof getRestockAlerts>>;
  let orders: Awaited<ReturnType<typeof getOrdersPipeline>>;
  let cashflow: Awaited<ReturnType<typeof getCashflow>>;

  try {
    [overview, wac, restock, orders, cashflow] = await Promise.all([
      getOverview(DAYS),
      getWACProducts(10),
      getRestockAlerts(30, 10),
      getOrdersPipeline(),
      getCashflow(DAYS),
    ]);
  } catch (err) {
    console.error("[ai-insights] DB error:", err);
    return NextResponse.json(
      {
        advice: null,
        metrics: {
          grossMarginPct: 0,
          urgentOrders: 0,
          restockAlerts: 0,
          cashOnHand: 0,
          accountsReceivable: 0,
          driftAlerts: 0,
          periodDays: DAYS,
        },
        generatedAt: new Date().toISOString(),
        error: "db_error",
      } satisfies AiInsightsResponse,
      { status: 500 },
    );
  }

  const metrics: AiMetrics = {
    grossMarginPct: overview.gross_margin_pct,
    urgentOrders: orders.urgent_pending,
    restockAlerts: restock.length,
    cashOnHand: cashflow.cash_on_hand_gel,
    accountsReceivable: cashflow.accounts_receivable_gel,
    driftAlerts: wac.filter((w) => Math.abs(w.cost_drift_pct ?? 0) > 5).length,
    periodDays: DAYS,
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const result: AiInsightsResponse = {
      advice: null,
      metrics,
      generatedAt: new Date().toISOString(),
      error: "api_key_missing",
    };
    _cache = { data: result, ts: Date.now() };
    return NextResponse.json(result);
  }

  const snapshot = {
    overview,
    wac_top_products: wac,
    restock_alerts: restock,
    orders_pipeline: orders,
    cashflow,
  };

  try {
    const client = new Anthropic({ apiKey, timeout: 30_000 });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: buildUserMessage(FEWSHOT_INPUT, "მაგალითი — წინა კვირა") },
        { role: "assistant", content: FEWSHOT_OUTPUT },
        { role: "user", content: buildUserMessage(JSON.stringify(snapshot, null, 2), periodLabel(DAYS)) },
      ],
    });

    let advice: string | null = null;
    for (const block of msg.content) {
      if (block.type === "text") {
        advice = block.text.trim().slice(0, 1200);
        break;
      }
    }

    const result: AiInsightsResponse = {
      advice,
      metrics,
      generatedAt: new Date().toISOString(),
    };
    _cache = { data: result, ts: Date.now() };
    return NextResponse.json(result);
  } catch (err) {
    console.error("[ai-insights] Anthropic error:", err);
    const result: AiInsightsResponse = {
      advice: null,
      metrics,
      generatedAt: new Date().toISOString(),
      error: "ai_error",
    };
    return NextResponse.json(result);
  }
}
