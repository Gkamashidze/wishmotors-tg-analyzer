import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

export type ProfitLossResponse = {
  period: { from: string; to: string };
  revenue: {
    sales_revenue: number;
    total: number;
  };
  cost_of_goods_sold: {
    cogs: number;
    total: number;
  };
  gross_profit: number;
  gross_margin_pct: number;
  expenses: {
    category: string;
    amount: number;
  }[];
  total_expenses: number;
  operating_profit: number;
  net_profit: number;
  net_margin_pct: number;
};

// GET /api/accounting/profit-loss?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get("from");
  const toStr   = searchParams.get("to");

  if (!fromStr || !toStr) {
    return NextResponse.json(
      { error: "from and to query params are required" },
      { status: 400 },
    );
  }

  const from = new Date(fromStr);
  const to   = new Date(toStr + "T23:59:59.999Z");

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "invalid dates" }, { status: 400 });
  }

  if (to < from) {
    return NextResponse.json({ error: "'to' must be >= 'from'" }, { status: 400 });
  }

  const diffDays = (to.getTime() - from.getTime()) / 86_400_000;
  if (diffDays > 3660) {
    return NextResponse.json({ error: "date range cannot exceed 10 years" }, { status: 400 });
  }

  try {
    // Revenue from sales
    const revenueRow = await queryOne<{
      sales_revenue: string;
    }>(
      `SELECT COALESCE(SUM(quantity * unit_price), 0) AS sales_revenue
       FROM sales
       WHERE sold_at >= $1 AND sold_at <= $2`,
      [from.toISOString(), to.toISOString()],
    );

    // COGS from sales
    const cogsRow = await queryOne<{ cogs: string }>(
      `SELECT COALESCE(SUM(cost_amount), 0) AS cogs
       FROM sales
       WHERE sold_at >= $1 AND sold_at <= $2`,
      [from.toISOString(), to.toISOString()],
    );

    // Expenses by category
    const expenseRows = await query<{
      category: string;
      amount: string;
    }>(
      `SELECT
         COALESCE(NULLIF(category, ''), 'სხვა') AS category,
         SUM(amount) AS amount
       FROM expenses
       WHERE created_at >= $1 AND created_at <= $2
       GROUP BY COALESCE(NULLIF(category, ''), 'სხვა')
       ORDER BY SUM(amount) DESC`,
      [from.toISOString(), to.toISOString()],
    );

    const salesRevenue   = Number(revenueRow?.sales_revenue ?? 0);
    const cogs           = Number(cogsRow?.cogs ?? 0);
    const grossProfit    = salesRevenue - cogs;
    const grossMarginPct = salesRevenue > 0 ? (grossProfit / salesRevenue) * 100 : 0;

    const expenses = expenseRows.map((r) => ({
      category: r.category,
      amount:   Number(r.amount),
    }));
    const totalExpenses  = expenses.reduce((s, r) => s + r.amount, 0);
    const operatingProfit = grossProfit - totalExpenses;
    const netProfit       = operatingProfit;
    const netMarginPct    = salesRevenue > 0 ? (netProfit / salesRevenue) * 100 : 0;

    const result: ProfitLossResponse = {
      period: { from: fromStr, to: toStr },
      revenue: {
        sales_revenue: salesRevenue,
        total:         salesRevenue,
      },
      cost_of_goods_sold: {
        cogs,
        total: cogs,
      },
      gross_profit:     grossProfit,
      gross_margin_pct: grossMarginPct,
      expenses,
      total_expenses:   totalExpenses,
      operating_profit: operatingProfit,
      net_profit:       netProfit,
      net_margin_pct:   netMarginPct,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[profit-loss] GET error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
