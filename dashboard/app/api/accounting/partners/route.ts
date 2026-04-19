import "server-only";
import { type NextRequest, NextResponse } from "next/server";
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STR = 500;
const MAX_AMOUNT = 100_000_000;

export async function GET(request: NextRequest) {
  try {
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
  } catch (err) {
    console.error("[partners] GET error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
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

    const name = body.name?.trim() ?? "";
    if (!name || name.length > MAX_STR) {
      return NextResponse.json({ error: "სახელი სავალდებულოა (მაქს. 500 სიმბოლო)" }, { status: 400 });
    }
    if (body.type !== "debtor" && body.type !== "creditor") {
      return NextResponse.json({ error: "ტიპი უნდა იყოს debtor ან creditor" }, { status: 400 });
    }

    const phone = body.phone?.trim().slice(0, 50) ?? null;
    const note  = body.note?.trim().slice(0, MAX_STR) ?? null;

    if (body.initial_amount !== undefined) {
      const amt = Number(body.initial_amount);
      if (!Number.isFinite(amt) || amt < 0 || amt > MAX_AMOUNT) {
        return NextResponse.json({ error: "არასწორი საწყისი თანხა" }, { status: 400 });
      }
    }
    if (body.initial_date && !DATE_RE.test(body.initial_date)) {
      return NextResponse.json({ error: "initial_date ფორმატი: YYYY-MM-DD" }, { status: 400 });
    }

    const partner = await queryOne<{ id: number }>(
      `INSERT INTO accounting_partners (name, type, phone, note)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [name, body.type, phone, note],
    );

    if (!partner) {
      return NextResponse.json({ error: "server error" }, { status: 500 });
    }

    if (body.initial_amount && body.initial_amount > 0) {
      const desc = body.initial_description?.trim().slice(0, MAX_STR) ?? "საწყისი ნაშთი";
      await query(
        `INSERT INTO accounting_partner_transactions (partner_id, tx_type, amount, description, tx_date)
         VALUES ($1, 'debit', $2, $3, $4)`,
        [
          partner.id,
          body.initial_amount,
          desc,
          body.initial_date ?? new Date().toISOString().slice(0, 10),
        ],
      );
    }

    return NextResponse.json({ id: partner.id }, { status: 201 });
  } catch (err) {
    console.error("[partners] POST error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
