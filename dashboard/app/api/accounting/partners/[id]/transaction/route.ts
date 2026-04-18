import { type NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const numId = Number(id);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

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
  if (!body.amount || body.amount <= 0) {
    return NextResponse.json({ error: "თანხა სავალდებულოა" }, { status: 400 });
  }

  const defaultDesc = body.tx_type === "credit" ? "გადახდა" : "ჩანაწერი";

  await query(
    `INSERT INTO accounting_partner_transactions (partner_id, tx_type, amount, description, tx_date)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      numId,
      body.tx_type,
      body.amount,
      body.description ?? defaultDesc,
      body.tx_date ?? new Date().toISOString().slice(0, 10),
    ],
  );

  return NextResponse.json({ ok: true }, { status: 201 });
}
