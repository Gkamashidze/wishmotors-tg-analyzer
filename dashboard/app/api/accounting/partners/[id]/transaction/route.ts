import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;
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

    const defaultDesc = body.tx_type === "credit" ? "გადახდა" : "ჩანაწერი";
    const description = (body.description?.trim().slice(0, MAX_DESC)) ?? defaultDesc;

    await query(
      `INSERT INTO accounting_partner_transactions (partner_id, tx_type, amount, description, tx_date)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        numId,
        body.tx_type,
        amount,
        description,
        body.tx_date ?? new Date().toISOString().slice(0, 10),
      ],
    );

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("[partners/transaction] POST error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
