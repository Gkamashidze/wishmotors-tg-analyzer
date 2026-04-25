import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { telegramMarkCancelled, telegramMarkUpdated } from "@/lib/telegram";
import { formatTopicExpense } from "@/lib/formatters";

type Params = Promise<{ id: string }>;

interface ExpenseRecord {
  topic_id: number | null;
  topic_message_id: number | null;
  amount: string;
  description: string | null;
  category: string | null;
  payment_method: string;
}

const GROUP_ID = Number(process.env.GROUP_ID ?? "0");

async function fetchExpense(rowId: number): Promise<ExpenseRecord | null> {
  return queryOne<ExpenseRecord>(
    `SELECT topic_id, topic_message_id, amount, description, category, payment_method
     FROM expenses
     WHERE id = $1`,
    [rowId],
  );
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = await req.json() as Record<string, unknown>;
  const {
    amount, description, category, payment_method, created_at,
    vat_amount, is_vat_included, is_paid,
    currency, original_amount, exchange_rate,
  } = body;

  const current = await fetchExpense(rowId);

  await query(
    `UPDATE expenses SET
      amount          = $2,
      description     = $3,
      category        = $4,
      payment_method  = $5,
      created_at      = $6,
      vat_amount      = $7,
      is_vat_included = $8,
      is_paid         = $9,
      currency        = COALESCE($10, currency),
      original_amount = COALESCE($11, original_amount),
      exchange_rate   = COALESCE($12, exchange_rate)
    WHERE id = $1`,
    [
      rowId, amount, description ?? null, category ?? null, payment_method,
      created_at, vat_amount ?? 0, is_vat_included ?? false, is_paid ?? true,
      currency ?? null, original_amount ?? null, exchange_rate ?? null,
    ],
  );

  if (current?.topic_id && current.topic_message_id && GROUP_ID) {
    const newText = formatTopicExpense({
      amount: Number(amount),
      category: (category as string | null) ?? null,
      description: (description as string | null) ?? null,
      expenseId: rowId,
    });
    void telegramMarkUpdated(GROUP_ID, current.topic_message_id, newText);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const current = await fetchExpense(rowId);

  await query("DELETE FROM expenses WHERE id = $1", [rowId]);

  if (current?.topic_id && current.topic_message_id && GROUP_ID) {
    const originalText = formatTopicExpense({
      amount: Number(current.amount),
      category: current.category,
      description: current.description,
      expenseId: rowId,
    });
    void telegramMarkCancelled(GROUP_ID, current.topic_message_id, originalText);
  }

  return NextResponse.json({ ok: true });
}
