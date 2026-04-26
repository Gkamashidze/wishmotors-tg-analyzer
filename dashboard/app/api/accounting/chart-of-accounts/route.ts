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
  parent_id: number | null;
  is_active: boolean;
  created_at: string;
};

const SEED_ACCOUNTS = [
  // Current assets — cash & receivables
  { code: "1100", name: "სალარო",                          type: "asset",     description: "ნაღდი ფული სალაროში",                           parentCode: null },
  { code: "1200", name: "ბანკი / გადარიცხვა",              type: "asset",     description: "საბანკო ანგარიში",                               parentCode: null },
  { code: "1400", name: "დებიტორები (ნისიები)",             type: "asset",     description: "კლიენტებისგან მისაღები თანხები",                 parentCode: null },
  // Inventory — 1610 parent + 12 sub-accounts + 1690 small-value
  { code: "1610", name: "საქონლის მარაგი",                  type: "asset",     description: "საწყობში არსებული საქონელი",                     parentCode: null },
  { code: "1611", name: "ძრავი",                            type: "asset",     description: "ძრავის კომპონენტები",                            parentCode: "1610" },
  { code: "1612", name: "გადაცემათა კოლოფი",               type: "asset",     description: "გადაცემათა კოლოფის ნაწილები",                    parentCode: "1610" },
  { code: "1613", name: "სამუხრუჭე სისტემა",               type: "asset",     description: "სამუხრუჭე სისტემის ნაწილები",                    parentCode: "1610" },
  { code: "1614", name: "სარეზინო სისტემა",                type: "asset",     description: "სარეზინო სისტემის ნაწილები",                     parentCode: "1610" },
  { code: "1615", name: "საჭე და მართვა",                  type: "asset",     description: "საჭისა და მართვის კომპონენტები",                  parentCode: "1610" },
  { code: "1616", name: "ელექტრიკა და სენსორები",           type: "asset",     description: "ელექტრონული კომპონენტები და სენსორები",           parentCode: "1610" },
  { code: "1617", name: "განათება",                         type: "asset",     description: "განათების კომპონენტები",                          parentCode: "1610" },
  { code: "1618", name: "ფილტრები",                         type: "asset",     description: "ფილტრები",                                        parentCode: "1610" },
  { code: "1619", name: "გაგრილება",                        type: "asset",     description: "გაგრილების სისტემის ნაწილები",                    parentCode: "1610" },
  { code: "1620", name: "საწვავის სისტემა",                 type: "asset",     description: "საწვავის სისტემის კომპონენტები",                  parentCode: "1610" },
  { code: "1621", name: "სხეული",                           type: "asset",     description: "სხეულის ნაწილები",                                parentCode: "1610" },
  { code: "1622", name: "სხვადასხვა",                       type: "asset",     description: "სხვა სასაქონლო მარაგი",                          parentCode: "1610" },
  { code: "1690", name: "მცირეფასიანი ნივთები",            type: "asset",     description: "მცირეფასიანი ინვენტარი (immediately expensed)",   parentCode: null },
  // Fixed assets
  { code: "2100", name: "ძირითადი საშუალებები",             type: "asset",     description: "გრძელვადიანი ძირითადი საშუალებები",               parentCode: null },
  // Equity
  { code: "3100", name: "კაპიტალი",                         type: "equity",    description: "მფლობელის კაპიტალი",                             parentCode: null },
  // Liabilities — supplier payables & VAT
  { code: "3110", name: "კრედიტორები (ადგილობრივი)",        type: "liability", description: "ადგილობრივ მომწოდებლებზე გადასახდელი",             parentCode: null },
  { code: "3190", name: "კრედიტორები (საზღვარგარეთი)",      type: "liability", description: "საგარეო მომწოდებლებზე გადასახდელი",               parentCode: null },
  { code: "3330", name: "გადასახდელი დღგ",                   type: "liability", description: "დღგ-ს გადასახდელი ბიუჯეტში (შპს-ის გაყიდვები)",  parentCode: null },
  // Revenue
  { code: "6100", name: "გაყიდვების შემოსავალი",            type: "revenue",   description: "საქონლის რეალიზაციით მიღებული შემოსავალი",        parentCode: null },
  // Expenses
  { code: "7100", name: "გაყიდვების თვითღირებულება",        type: "expense",   description: "COGS — გაყიდული საქონლის ღირებულება",            parentCode: null },
  { code: "7200", name: "ოპერაციული ხარჯები",               type: "expense",   description: "ყოველდღიური საოპერაციო ხარჯები",                  parentCode: null },
  { code: "7300", name: "ადმინისტრაციული ხარჯები",          type: "expense",   description: "ადმინ. და საოფისე ხარჯები",                       parentCode: null },
  { code: "7400", name: "სხვა ხარჯები",                     type: "expense",   description: "სხვა კლასიფიცირებული ხარჯები",                   parentCode: null },
] as const;

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS chart_of_accounts (
      id          SERIAL PRIMARY KEY,
      code        TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
      description TEXT,
      parent_id   INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
      is_active   BOOLEAN NOT NULL DEFAULT TRUE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    ALTER TABLE chart_of_accounts
    ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL
  `);

  // ── Migrations ───────────────────────────────────────────────────────────────
  // 1. Rename old 2100 (კრედიტორები/liability) → 3110 if it still exists as liability
  await query(`
    UPDATE chart_of_accounts
    SET code = '3110', name = 'კრედიტორები (ადგილობრივი)'
    WHERE code = '2100' AND type = 'liability'
  `);
  // 2. Rename old 1600 (საქონლის მარაგი) → 1610
  await query(`
    UPDATE chart_of_accounts
    SET code = '1610'
    WHERE code = '1600' AND type = 'asset'
  `);
  // 3. Fix ledger entries that used old codes
  await query(`UPDATE ledger SET account_code = '3110' WHERE account_code = '2100'`);
  await query(`UPDATE ledger SET account_code = '1610' WHERE account_code IN ('1300','1600')`);
  await query(`UPDATE ledger SET account_code = '7200' WHERE account_code = '6100' AND debit_amount > 0 AND credit_amount = 0`);

  // ── Seed — insert parents first, then children ───────────────────────────────
  const parents = SEED_ACCOUNTS.filter((a) => a.parentCode === null);
  const children = SEED_ACCOUNTS.filter((a) => a.parentCode !== null);

  for (const acc of parents) {
    await queryOne(
      `INSERT INTO chart_of_accounts (code, name, type, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO NOTHING`,
      [acc.code, acc.name, acc.type, acc.description],
    );
  }

  for (const acc of children) {
    const parent = await queryOne<{ id: number }>(
      `SELECT id FROM chart_of_accounts WHERE code = $1`,
      [acc.parentCode],
    );
    await queryOne(
      `INSERT INTO chart_of_accounts (code, name, type, description, parent_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO NOTHING`,
      [acc.code, acc.name, acc.type, acc.description, parent?.id ?? null],
    );
  }
}

// GET /api/accounting/chart-of-accounts
export async function GET() {
  try {
    await ensureTable();

    const rows = await query<ChartOfAccount>(
      `SELECT id, code, name, type, description, parent_id, is_active, created_at
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
// Body: { code, name, type, description?, parent_id? }
export async function POST(req: NextRequest) {
  try {
    await ensureTable();

    const body = await req.json();
    const { code, name, type, description, parent_id } = body as {
      code: string;
      name: string;
      type: string;
      description?: string;
      parent_id?: number | null;
    };

    if (!code || !name || !type) {
      return NextResponse.json(
        { error: "code, name, type are required" },
        { status: 400 },
      );
    }

    if (code.trim().length > 20) {
      return NextResponse.json({ error: "code is too long (max 20)" }, { status: 400 });
    }
    if (name.trim().length > 200) {
      return NextResponse.json({ error: "name is too long (max 200)" }, { status: 400 });
    }

    const VALID_TYPES: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];
    if (!VALID_TYPES.includes(type as AccountType)) {
      return NextResponse.json({ error: "invalid type" }, { status: 400 });
    }

    if (parent_id != null) {
      const parent = await queryOne(`SELECT id FROM chart_of_accounts WHERE id = $1`, [parent_id]);
      if (!parent) {
        return NextResponse.json({ error: "მშობელი ანგარიში ვერ მოიძებნა" }, { status: 400 });
      }
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
      `INSERT INTO chart_of_accounts (code, name, type, description, parent_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name, type, description, parent_id, is_active, created_at`,
      [code.trim(), name.trim(), type, description?.trim() ?? null, parent_id ?? null],
    );

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    console.error("[chart-of-accounts] POST error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
