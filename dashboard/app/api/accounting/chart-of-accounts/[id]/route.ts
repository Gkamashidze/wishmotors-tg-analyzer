import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import type { AccountType, ChartOfAccount } from "../route";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PUT /api/accounting/chart-of-accounts/[id]
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numId = Number(id);
    if (!Number.isInteger(numId) || numId < 1) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    const body = await req.json();
    const hasParentId = 'parent_id' in body;
    const { code, name, type, description, is_active, parent_id } = body as {
      code?: string;
      name?: string;
      type?: string;
      description?: string;
      is_active?: boolean;
      parent_id?: number | null;
    };

    const VALID_TYPES: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];
    if (type && !VALID_TYPES.includes(type as AccountType)) {
      return NextResponse.json({ error: "invalid type" }, { status: 400 });
    }

    if (hasParentId && parent_id != null) {
      if (parent_id === numId) {
        return NextResponse.json({ error: "ანგარიში ვერ იქნება საკუთარი მშობელი" }, { status: 400 });
      }
      const parent = await queryOne(`SELECT id FROM chart_of_accounts WHERE id = $1`, [parent_id]);
      if (!parent) {
        return NextResponse.json({ error: "მშობელი ანგარიში ვერ მოიძებნა" }, { status: 400 });
      }
    }

    const row = await queryOne<ChartOfAccount>(
      `UPDATE chart_of_accounts
       SET
         code        = COALESCE($1, code),
         name        = COALESCE($2, name),
         type        = COALESCE($3, type),
         description = COALESCE($4, description),
         is_active   = COALESCE($5, is_active),
         parent_id   = CASE WHEN $6::boolean THEN $7::integer ELSE parent_id END
       WHERE id = $8
       RETURNING id, code, name, type, description, parent_id, is_active, created_at`,
      [
        code?.trim() ?? null,
        name?.trim() ?? null,
        type ?? null,
        description?.trim() ?? null,
        is_active ?? null,
        hasParentId,
        parent_id ?? null,
        numId,
      ],
    );

    if (!row) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json(row);
  } catch (err) {
    console.error("[chart-of-accounts/id] PUT error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

// DELETE /api/accounting/chart-of-accounts/[id]
// Soft-deletes by setting is_active = false
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numId = Number(id);
    if (!Number.isInteger(numId) || numId < 1) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    const inLedger = await query(
      `SELECT 1 FROM ledger WHERE account_code = (
         SELECT code FROM chart_of_accounts WHERE id = $1
       ) LIMIT 1`,
      [numId],
    );

    if (inLedger.length > 0) {
      // Has ledger entries — deactivate instead of hard-delete
      await queryOne(
        `UPDATE chart_of_accounts SET is_active = false WHERE id = $1`,
        [numId],
      );
      return NextResponse.json({ deactivated: true });
    }

    const result = await query(
      `DELETE FROM chart_of_accounts WHERE id = $1 RETURNING id`,
      [numId],
    );

    if (result.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("[chart-of-accounts/id] DELETE error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
