import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";

type Params = Promise<{ id: string }>;

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isFinite(productId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const qty = Number(body.quantity);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
    return NextResponse.json(
      { error: "quantity must be a positive integer" },
      { status: 400 },
    );
  }
  if (!reason) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }

  try {
    await withTransaction(async (client) => {
      const prodRes = await client.query<{
        id: number;
        name: string;
        oem_code: string | null;
        unit_price: string;
      }>(
        "SELECT id, name, oem_code, unit_price FROM products WHERE id = $1 FOR UPDATE",
        [productId],
      );

      const product = prodRes.rows[0];
      if (!product) {
        const err = new Error("not_found") as Error & { code: string };
        err.code = "NOT_FOUND";
        throw err;
      }

      const unitCost = Number(product.unit_price);
      const totalLoss = unitCost * qty;
      const label = product.oem_code ?? product.name;
      const description = `ჩამოწერა [${reason}]: ${label}`;

      await client.query(
        "UPDATE products SET current_stock = current_stock - $1 WHERE id = $2",
        [qty, productId],
      );

      await client.query(
        `INSERT INTO expenses
           (amount, description, category, payment_method,
            is_non_cash, is_paid, vat_amount, is_vat_included, created_at)
         VALUES ($1, $2, 'ჩამოწერა', 'transfer', true, true, 0, false, NOW())`,
        [totalLoss, description],
      );
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err as Error & { code?: string }).code === "NOT_FOUND"
    ) {
      return NextResponse.json(
        { error: "პროდუქტი ვერ მოიძებნა" },
        { status: 404 },
      );
    }
    console.error("[writeoff] POST error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
