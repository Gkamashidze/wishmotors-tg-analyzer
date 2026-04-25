import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { query, withTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";

export type DebtorSale = {
  id: number;
  product_name: string;
  oem_code: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;
  sold_at: string;
  client_name: string | null;
  customer_name: string | null;
  notes: string | null;
};

export type DebtorGroup = {
  client_name: string;
  total_debt: number;
  sales: DebtorSale[];
};

// ---------------------------------------------------------------------------
// GET /api/debtors
// Returns all outstanding debt sales grouped by client_name, with totals.
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const rows = await query<{
      id: number;
      product_name: string;
      oem_code: string | null;
      quantity: number;
      unit_price: string;
      total_amount: string;
      sold_at: string;
      client_name: string | null;
      customer_name: string | null;
      notes: string | null;
    }>(`
      SELECT
        s.id,
        COALESCE(p.name, s.notes, 'უცნობი პროდუქტი') AS product_name,
        p.oem_code,
        s.quantity,
        s.unit_price,
        ROUND(s.quantity * s.unit_price, 2)           AS total_amount,
        s.sold_at,
        s.client_name,
        s.customer_name,
        s.notes
      FROM sales s
      LEFT JOIN products p ON p.id = s.product_id
      WHERE s.payment_status = 'debt'
        AND s.status != 'returned'
      ORDER BY
        COALESCE(s.client_name, s.customer_name, ''),
        s.sold_at DESC
    `);

    // Group sales by client_name
    const groupMap = new Map<string, DebtorGroup>();

    for (const row of rows) {
      const key = row.client_name || row.customer_name || "უცნობი კლიენტი";
      if (!groupMap.has(key)) {
        groupMap.set(key, { client_name: key, total_debt: 0, sales: [] });
      }
      const group = groupMap.get(key)!;
      const sale: DebtorSale = {
        id: row.id,
        product_name: row.product_name,
        oem_code: row.oem_code,
        quantity: Number(row.quantity),
        unit_price: Number(row.unit_price),
        total_amount: Number(row.total_amount),
        sold_at: row.sold_at,
        client_name: row.client_name,
        customer_name: row.customer_name,
        notes: row.notes,
      };
      group.sales.push(sale);
      group.total_debt = Number((group.total_debt + sale.total_amount).toFixed(2));
    }

    const groups = Array.from(groupMap.values()).sort(
      (a, b) => b.total_debt - a.total_debt,
    );

    return NextResponse.json(groups);
  } catch (err) {
    console.error("[debtors] GET error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/debtors
// Body: { sale_id: number; payment_method: "cash" | "transfer" }
// Marks the sale as paid, posts AR settlement ledger entry (DR Cash CR AR).
// The amount is then reflected in the Cash/Bank balance widget automatically.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sale_id, payment_method } = body as {
      sale_id: number;
      payment_method: string;
    };

    if (!sale_id || !["cash", "transfer"].includes(payment_method)) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const debitAccount = payment_method === "cash" ? "1100" : "1200";

    await withTransaction(async (client) => {
      // Lock and fetch the sale
      const { rows } = await client.query(
        `SELECT id, unit_price, quantity, client_name, customer_name
         FROM sales
         WHERE id = $1 AND payment_method = 'credit' AND payment_status = 'debt'
         FOR UPDATE`,
        [sale_id],
      );

      if (rows.length === 0) {
        throw new Error("sale_not_found");
      }

      const sale = rows[0];
      const total = Number((Number(sale.unit_price) * Number(sale.quantity)).toFixed(2));
      const label = sale.client_name || sale.customer_name || `Sale #${sale_id}`;
      const description = `ვალის ამოღება #${sale_id} — ${label}`;
      const reference = `payment:${sale_id}`;

      // Update sale: mark as paid, switch payment method so balance is correct
      await client.query(
        `UPDATE sales
         SET payment_method = $1, payment_status = 'paid'
         WHERE id = $2`,
        [payment_method, sale_id],
      );

      // Post AR settlement: DR Cash/Bank  CR 1400 (AR)
      await client.query(
        `INSERT INTO ledger (account_code, debit_amount, credit_amount, description, reference_id)
         VALUES ($1, $2, 0, $3, $4)`,
        [debitAccount, total, description, reference],
      );
      await client.query(
        `INSERT INTO ledger (account_code, debit_amount, credit_amount, description, reference_id)
         VALUES ('1400', 0, $1, $2, $3)`,
        [total, description, reference],
      );
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "sale_not_found") {
      return NextResponse.json(
        { error: "sale not found or already paid" },
        { status: 404 },
      );
    }
    console.error("[debtors] POST error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
