import { type NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export type PartnerTransaction = {
  id: number;
  partner_id: number;
  tx_type: "debit" | "credit";
  amount: number;
  description: string | null;
  tx_date: string;
  created_at: string;
  currency: string;
  original_amount: number | null;
  exchange_rate: number;
};

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const numId = Number(id);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const partner = await queryOne<{ id: number; name: string; type: string }>(
    "SELECT * FROM accounting_partners WHERE id = $1",
    [numId],
  );
  if (!partner) return NextResponse.json({ error: "ვერ მოიძებნა" }, { status: 404 });

  const transactions = await query<PartnerTransaction>(
    `SELECT * FROM accounting_partner_transactions
     WHERE partner_id = $1
     ORDER BY tx_date DESC, created_at DESC`,
    [numId],
  );

  return NextResponse.json({ partner, transactions });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const numId = Number(id);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = (await request.json()) as {
    name?: string;
    phone?: string;
    note?: string;
  };

  await query(
    `UPDATE accounting_partners
     SET
       name  = COALESCE($2, name),
       phone = COALESCE($3, phone),
       note  = COALESCE($4, note)
     WHERE id = $1`,
    [numId, body.name ?? null, body.phone ?? null, body.note ?? null],
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const numId = Number(id);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  await query("UPDATE accounting_partners SET is_active = false WHERE id = $1", [numId]);

  return NextResponse.json({ ok: true });
}
