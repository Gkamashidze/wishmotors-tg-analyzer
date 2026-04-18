import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

export type PartnerType = "debtor" | "creditor";

export type PartnerRow = {
  id: number;
  name: string;
  type: PartnerType;
  phone: string | null;
  note: string | null;
  is_active: boolean;
  opening_balance: number;
  paid_amount: number;
  remaining: number;
  created_at: string;
};

async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS accounting_partners (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL CHECK (type IN ('debtor','creditor')),
      phone      TEXT,
      note       TEXT,
      is_active  BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS accounting_partner_transactions (
      id          SERIAL PRIMARY KEY,
      partner_id  INTEGER NOT NULL REFERENCES accounting_partners(id) ON DELETE CASCADE,
      tx_type     TEXT NOT NULL CHECK (tx_type IN ('debit','credit')),
      amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      description TEXT,
      tx_date     DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function GET(request: Request) {
  await ensureTables();

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  const params: (string | boolean)[] = [true];
  let whereClause = "WHERE p.is_active = $1";

  if (type === "debtor" || type === "creditor") {
    params.push(type);
    whereClause += ` AND p.type = $${params.length}`;
  }

  const rows = await query<PartnerRow>(`
    SELECT
      p.id, p.name, p.type, p.phone, p.note, p.is_active, p.created_at,
      COALESCE(SUM(CASE WHEN t.tx_type = 'debit'  THEN t.amount ELSE 0         END), 0)::float AS opening_balance,
      COALESCE(SUM(CASE WHEN t.tx_type = 'credit' THEN t.amount ELSE 0         END), 0)::float AS paid_amount,
      COALESCE(SUM(CASE WHEN t.tx_type = 'debit'  THEN t.amount ELSE -t.amount END), 0)::float AS remaining
    FROM accounting_partners p
    LEFT JOIN accounting_partner_transactions t ON t.partner_id = p.id
    ${whereClause}
    GROUP BY p.id
    ORDER BY p.name
  `, params as string[]);

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  await ensureTables();

  const body = (await request.json()) as {
    name?: string;
    type?: string;
    phone?: string;
    note?: string;
    initial_amount?: number;
    initial_description?: string;
    initial_date?: string;
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "სახელი სავალდებულოა" }, { status: 400 });
  }
  if (body.type !== "debtor" && body.type !== "creditor") {
    return NextResponse.json({ error: "ტიპი უნდა იყოს debtor ან creditor" }, { status: 400 });
  }

  const partner = await queryOne<{ id: number }>(
    `INSERT INTO accounting_partners (name, type, phone, note)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [body.name.trim(), body.type, body.phone ?? null, body.note ?? null],
  );

  if (!partner) {
    return NextResponse.json({ error: "შეცდომა" }, { status: 500 });
  }

  if (body.initial_amount && body.initial_amount > 0) {
    await query(
      `INSERT INTO accounting_partner_transactions (partner_id, tx_type, amount, description, tx_date)
       VALUES ($1, 'debit', $2, $3, $4)`,
      [
        partner.id,
        body.initial_amount,
        body.initial_description ?? "საწყისი ნაშთი",
        body.initial_date ?? new Date().toISOString().slice(0, 10),
      ],
    );
  }

  return NextResponse.json({ id: partner.id }, { status: 201 });
}
