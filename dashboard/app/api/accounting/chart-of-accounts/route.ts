import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export type ChartOfAccount = {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  description: string | null;
  is_active: boolean;
  created_at: string;
};

const SEED_ACCOUNTS = [
  { code: "1100", name: "სალარო", type: "asset",     description: "ნაღდი ფული სალაროში" },
  { code: "1200", name: "ბანკი / გადარიცხვა", type: "asset", description: "საბანკო ანგარიში" },
  { code: "1400", name: "დებიტორები (ნისიები)", type: "asset", description: "კლიენტებისგან მისაღები თანხები" },
  { code: "1600", name: "საქონლის მარაგი", type: "asset", description: "საწყობში არსებული საქონელი" },
  { code: "2100", name: "კრედიტორები", type: "liability", description: "მომწოდებლებზე გადასახდელი" },
  { code: "3100", name: "კაპიტალი", type: "equity", description: "მფლობელის კაპიტალი" },
  { code: "6100", name: "გაყიდვების შემოსავალი", type: "revenue", description: "საქონლის რეალიზაციით მიღებული შემოსავალი" },
  { code: "7100", name: "გაყიდვების თვითღირებულება", type: "expense", description: "COGS — გაყიდული საქონლის ღირებულება" },
  { code: "7200", name: "ოპერაციული ხარჯები", type: "expense", description: "ყოველდღიური საოპერაციო ხარჯები" },
  { code: "7300", name: "ადმინისტრაციული ხარჯები", type: "expense", description: "ადმინ. და საოფისე ხარჯები" },
  { code: "7400", name: "სხვა ხარჯები", type: "expense", description: "სხვა კლასიფიცირებული ხარჯები" },
] as const;

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS chart_of_accounts (
      id          SERIAL PRIMARY KEY,
      code        TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
      description TEXT,
      is_active   BOOLEAN NOT NULL DEFAULT TRUE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  for (const acc of SEED_ACCOUNTS) {
    await queryOne(
      `INSERT INTO chart_of_accounts (code, name, type, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO NOTHING`,
      [acc.code, acc.name, acc.type, acc.description],
    );
  }
}

// GET /api/accounting/chart-of-accounts
export async function GET() {
  try {
    await ensureTable();

    const rows = await query<ChartOfAccount>(
      `SELECT id, code, name, type, description, is_active, created_at
       FROM chart_of_accounts
       ORDER BY code`,
    );

    return NextResponse.json(rows);
  } catch (err) {
    console.error("[chart-of-accounts] GET error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

// POST /api/accounting/chart-of-accounts
// Body: { code, name, type, description? }
export async function POST(req: NextRequest) {
  try {
    await ensureTable();

    const body = await req.json();
    const { code, name, type, description } = body as {
      code: string;
      name: string;
      type: string;
      description?: string;
    };

    if (!code || !name || !type) {
      return NextResponse.json(
        { error: "code, name, type are required" },
        { status: 400 },
      );
    }

    const VALID_TYPES: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];
    if (!VALID_TYPES.includes(type as AccountType)) {
      return NextResponse.json({ error: "invalid type" }, { status: 400 });
    }

    const existing = await queryOne(
      `SELECT id FROM chart_of_accounts WHERE code = $1`,
      [code.trim()],
    );
    if (existing) {
      return NextResponse.json(
        { error: "ანგარიშის კოდი უკვე არსებობს" },
        { status: 409 },
      );
    }

    const row = await queryOne<ChartOfAccount>(
      `INSERT INTO chart_of_accounts (code, name, type, description)
       VALUES ($1, $2, $3, $4)
       RETURNING id, code, name, type, description, is_active, created_at`,
      [code.trim(), name.trim(), type, description?.trim() ?? null],
    );

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    console.error("[chart-of-accounts] POST error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
