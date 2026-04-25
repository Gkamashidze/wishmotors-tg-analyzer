import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

const DATE_RE    = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT = 100_000_000;
const MAX_DESC   = 500;

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numId = Number(id);
    if (!Number.isInteger(numId) || numId < 1) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const partner = await queryOne<{ id: number }>(
      "SELECT id FROM accounting_partners WHERE id = $1 AND is_active = true",
      [numId],
    );
    if (!partner) {
      return NextResponse.json({ error: "კონტრაგენტი ვერ მოიძებნა" }, { status: 404 });
    }

    const body = (await request.json()) as {
      tx_type?: string;
      amount?: number;
      description?: string;
      tx_date?: string;
      // Multi-currency fields
      currency?: string;
      original_amount?: number;   // foreign-currency amount (e.g. USD)
      exchange_rate?: number;     // rate used for this transaction
      payment_exchange_rate?: number; // today's rate (credit tx only, for FX diff calc)
    };

    if (body.tx_type !== "debit" && body.tx_type !== "credit") {
      return NextResponse.json(
        { error: "tx_type უნდა იყოს debit ან credit" },
        { status: 400 },
      );
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      return NextResponse.json({ error: "თანხა სავალდებულოა და მაქს. 100,000,000" }, { status: 400 });
    }

    if (body.tx_date && !DATE_RE.test(body.tx_date)) {
      return NextResponse.json({ error: "tx_date ფორმატი: YYYY-MM-DD" }, { status: 400 });
    }

    const defaultDesc  = body.tx_type === "credit" ? "გადახდა" : "ჩანაწერი";
    const description  = (body.description?.trim().slice(0, MAX_DESC)) ?? defaultDesc;
    const txDate       = body.tx_date ?? new Date().toISOString().slice(0, 10);
    const currency     = ["GEL", "USD", "EUR"].includes(body.currency ?? "") ? (body.currency ?? "GEL") : "GEL";
    const exchangeRate = Number(body.exchange_rate) > 0 ? Number(body.exchange_rate) : 1.0;

    // For debit: original_amount is the foreign amount (GEL amount = amount * rate already in `amount`)
    // For credit: original_amount = foreign amount being settled
    const originalAmount = body.original_amount != null
      ? Number(body.original_amount)
      : (currency !== "GEL" ? amount / exchangeRate : amount);

    // ── Insert the transaction ────────────────────────────────────────────────
    await query(
      `INSERT INTO accounting_partner_transactions
         (partner_id, tx_type, amount, description, tx_date, currency, original_amount, exchange_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [numId, body.tx_type, amount, description, txDate, currency, originalAmount, exchangeRate],
    );

    // ── FX gain / loss automation (credit only, foreign currency only) ────────
    if (body.tx_type === "credit" && currency !== "GEL") {
      const paymentRate = Number(body.payment_exchange_rate);
      if (paymentRate > 0) {
        // Fetch the original (most recent debit) exchange rate for this currency
        const origTx = await queryOne<{ exchange_rate: string }>(
          `SELECT exchange_rate
           FROM accounting_partner_transactions
           WHERE partner_id = $1
             AND tx_type    = 'debit'
             AND currency   = $2
           ORDER BY tx_date DESC, created_at DESC
           LIMIT 1`,
          [numId, currency],
        );

        const originalRate  = Number(origTx?.exchange_rate ?? paymentRate);
        const foreignPaid   = originalAmount;           // how much foreign currency was settled
        const fxDiff        = (paymentRate - originalRate) * foreignPaid;

        if (Math.abs(fxDiff) > 0.005) {
          const isLoss     = fxDiff > 0;
          const category   = isLoss ? "exchange_loss" : "exchange_gain";
          const fxAbsGel   = Math.abs(fxDiff);
          // Loss  → positive expense (GEL outflow)
          // Gain  → negative expense (task: "negative expense or income")
          const expenseAmt = isLoss ? fxAbsGel : -fxAbsGel;
          const fxDesc     = isLoss
            ? `სავალუტო ზარალი — ${foreignPaid.toFixed(4)} ${currency} × (${paymentRate} − ${originalRate})`
            : `სავალუტო მოგება — ${foreignPaid.toFixed(4)} ${currency} × (${originalRate} − ${paymentRate})`;

          await query(
            `INSERT INTO expenses
               (amount, description, category, payment_method, is_paid,
                currency, original_amount, exchange_rate)
             VALUES ($1, $2, $3, 'transfer', true, 'GEL', $1, 1.0)`,
            [expenseAmt, fxDesc, category],
          );
        }
      }
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("[partners/transaction] POST error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
